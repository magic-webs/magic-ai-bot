import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// ---------------------------------------------------------------------------
// OIDC discovery + JWKS for our own session JWTs.
//
// convex/auth.config.ts points `domain` at this deployment's .convex.site, so
// Convex fetches these two routes to learn how to verify the tokens it is
// handed. Keeping the issuer inside Convex means auth works in local
// development with no tunnel and no third-party identity provider.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => {
    const issuer = process.env.CONVEX_SITE_URL ?? "";
    return jsonResponse({
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }),
});

http.route({
  path: "/.well-known/jwks.json",
  method: "GET",
  handler: httpAction(async () => {
    const raw = process.env.JWT_PUBLIC_JWK;
    if (!raw) return jsonResponse({ keys: [] });
    return jsonResponse({ keys: [JSON.parse(raw)] });
  }),
});

// Meta's webhook lives on the Convex deployment rather than the Next app: the
// URL is public without a tunnel (so local development works against a real
// number), and the channel's access token never leaves Convex.
//
//   https://<deployment>.convex.site/whatsapp/<channelKey>

function channelKeyFrom(url: string): string | null {
  const path = new URL(url).pathname;
  const key = path.replace(/^\/whatsapp\//, "").replace(/\/+$/, "");
  return key && !key.includes("/") ? key : null;
}

// --- Verification handshake --------------------------------------------------
http.route({
  pathPrefix: "/whatsapp/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const channelKey = channelKeyFrom(request.url);
    if (!channelKey) {
      return new Response("Not found", { status: 404 });
    }

    const params = new URL(request.url).searchParams;
    const mode = params.get("hub.mode");
    const challenge = params.get("hub.challenge");

    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey,
    });
    if (!resolved) {
      return new Response("Unknown channel", { status: 404 });
    }

    // hub.verify_token is not checked. Meta makes you type one into its
    // dashboard, but it adds nothing here: the unguessable channelKey in the
    // path is what identifies the channel, and the handshake only echoes a
    // challenge back. One less string to copy between two consoles.
    if (mode !== "subscribe") {
      return new Response("Verification failed", { status: 403 });
    }

    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// --- Inbound messages --------------------------------------------------------
http.route({
  pathPrefix: "/whatsapp/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const channelKey = channelKeyFrom(request.url);
    if (!channelKey) {
      return new Response("Not found", { status: 404 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Meta retries anything that is slow or non-2xx, so acknowledge straight
    // away and do the model work in a scheduled action.
    await ctx.scheduler.runAfter(0, internal.whatsapp.handleInbound, {
      channelKey,
      payload,
    });

    return new Response(JSON.stringify({ status: "accepted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
