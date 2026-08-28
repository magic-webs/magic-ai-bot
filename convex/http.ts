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

    const url = new URL(request.url);
    const params = url.searchParams;

    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey,
    });
    if (!resolved) {
      return new Response("Unknown channel", { status: 404 });
    }

    // Logged because the handshake is the step that goes wrong, and the only
    // way to know what a provider actually sent is to have recorded it.
    console.log(
      `[whatsapp] verify GET channel=${channelKey} query=${url.search || "(none)"}`
    );

    // Providers disagree about this handshake. Meta sends hub.mode,
    // hub.verify_token and hub.challenge; the reseller panels built on the
    // Cloud API often just GET the URL bare and want a 200, or send the
    // challenge under a different name. So: echo a challenge if one is
    // offered, otherwise answer OK.
    //
    // Nothing is authenticated here and nothing needs to be. The unguessable
    // channelKey in the path is what selects the channel, and this response
    // discloses only the caller's own challenge string.
    const challenge =
      params.get("hub.challenge") ??
      params.get("challenge") ??
      params.get("hub_challenge");

    return new Response(challenge ?? "OK", {
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

    const shape =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    console.log(
      `[whatsapp] POST channel=${channelKey} keys=${Object.keys(shape).join(",") || "(none)"}`
    );

    // Some panels verify with a POST rather than a GET. Echo the challenge and
    // do not treat it as a message: a verification ping has no entry array.
    if (!("entry" in shape)) {
      const challenge = shape["challenge"] ?? shape["hub.challenge"];
      if (typeof challenge === "string") {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
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
