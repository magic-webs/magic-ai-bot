import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { interpretEvent } from "./lib/apps";
import { verifyDelivery } from "./lib/appWebhooks";

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
    // `challange` is not a typo here. The MagicXBot panel spells it that way
    // on the wire — its own failure notice reads "Failed to verify challange"
    // — and printly-ai-bot has always had to read that spelling first. Miss it
    // and verification fails with no other symptom.
    //
    // Nothing is authenticated here and nothing needs to be. The unguessable
    // channelKey in the path is what selects the channel, and this response
    // discloses only the caller's own challenge string.
    const challenge =
      params.get("challange") ??
      params.get("hub.challange") ??
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
      const challenge =
        shape["challange"] ?? shape["challenge"] ?? shape["hub.challenge"];
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

// ---------------------------------------------------------------------------
// Google integrations.
//
// Both halves live on the Convex deployment rather than the Next app. The
// refresh token and the OAuth client secret never leave Convex, the callback
// URL is stable per deployment (so it can be whitelisted once in the Google
// console and works in local development with no tunnel), and the engine
// reaches the tool endpoints without the web app being deployed at all.
//
//   https://<deployment>.convex.site/integrations/google/callback
//   https://<deployment>.convex.site/integrations/google/<action>?token=…
// ---------------------------------------------------------------------------

/** A page for the browser, since the callback is the only route a human sees. */
function callbackPage(title: string, detail: string, backTo?: string): Response {
  const escape = (text: string) =>
    text.replace(/[<>&]/g, (char) =>
      char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&amp;"
    );

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escape(title)}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6">` +
      `<h1 style="font-size:1.25rem">${escape(title)}</h1>` +
      `<p style="color:#555">${escape(detail)}</p>` +
      (backTo
        ? `<p><a href="${escape(backTo)}">Back to Integrations</a></p>`
        : "") +
      `</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

http.route({
  path: "/integrations/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "";
    const code = params.get("code");
    const denied = params.get("error");

    // Somebody who pressed Cancel on the consent screen. Burn the state so it
    // cannot be reused, then send them back without an alarming page.
    if (denied || !code) {
      const pending = state
        ? await ctx.runMutation(internal.integrations.takeState, { state })
        : null;
      if (pending?.returnTo) {
        return Response.redirect(
          `${pending.returnTo}?integration_error=${encodeURIComponent(
            denied === "access_denied"
              ? "Google sign-in was cancelled."
              : denied ?? "Google did not return an authorisation code."
          )}`,
          302
        );
      }
      return callbackPage(
        "Nothing was connected",
        denied === "access_denied"
          ? "Google sign-in was cancelled. You can close this tab."
          : "Google did not return an authorisation code."
      );
    }

    const result = await ctx.runAction(internal.integrations.finishGoogleConnect, {
      code,
      state,
      siteUrl: process.env.CONVEX_SITE_URL ?? "",
    });

    if (!result.returnTo) {
      return callbackPage(
        result.ok ? "Connected" : "Could not connect",
        result.error ?? "You can close this tab."
      );
    }

    const query = result.ok
      ? `?connected=${encodeURIComponent(result.integration ?? "")}`
      : `?integration_error=${encodeURIComponent(result.error ?? "Could not connect.")}`;
    return Response.redirect(`${result.returnTo}${query}`, 302);
  }),
});

// --- Incoming webhooks for alerts --------------------------------------------
//
//   https://<deployment>.convex.site/notify/<inboundKey>
//
// Another system — a website form, a payment gateway, a booking tool — posts
// here and the alert that owns the key sends its template. The key is the
// credential, as a channel's is: unguessable, one per alert, and rotated from
// the app when it leaks.

const MAX_INBOUND_BYTES = 64_000;

function inboundResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

http.route({
  pathPrefix: "/notify/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/notify\//, "").replace(/\/+$/, "");
    if (!key || key.includes("/")) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const text = await request.text();
    if (text.length > MAX_INBOUND_BYTES) {
      return inboundResponse(413, { ok: false, error: "Body too large." });
    }

    // JSON is what nearly everything sends; form posts are what website
    // builders send. Anything else is refused rather than guessed at.
    let body: unknown = {};
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return inboundResponse(400, { ok: false, error: "Send JSON or a form post." });
      }
    }
    // Placeholders address fields by name, so the payload has to be an object.
    const data: Record<string, unknown> =
      body && typeof body === "object" && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>) }
        : Array.isArray(body)
          ? { items: body }
          : { value: body };
    const query = Object.fromEntries(url.searchParams);
    if (Object.keys(query).length > 0) data.query = query;

    const status = await ctx.runMutation(internal.notifications.acceptInbound, {
      inboundKey: key,
      payload: JSON.stringify(data),
    });
    if (status === "unknown") {
      return inboundResponse(404, { ok: false, error: "No alert has this address." });
    }
    return inboundResponse(status === "queued" ? 202 : 200, {
      ok: true,
      queued: status === "queued",
      ...(status === "disabled" ? { reason: "The alert is switched off." } : {}),
    });
  }),
});

// --- Results from the Magic apps ---------------------------------------------
//
//   https://<deployment>.convex.site/apps/<inboundKey>
//
// Magic Forms and Magic Reward post here — a submission, a spin — on the
// webhook `apps.connect` registered with them. The key picks the connection
// and the signature proves the sender; both are checked before anything is
// read. Anything that is not an agent's own link is acknowledged and dropped,
// with a 200, so the app does not retry what will never match.

const MAX_APP_EVENT_BYTES = 256_000;

http.route({
  pathPrefix: "/apps/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/apps\//, "").replace(/\/+$/, "");
    if (!key || key.includes("/")) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const raw = await request.text();
    if (raw.length > MAX_APP_EVENT_BYTES) {
      return inboundResponse(413, { ok: false, error: "Body too large." });
    }

    const connection = await ctx.runQuery(internal.apps.byInboundKey, {
      inboundKey: key,
    });
    if (!connection) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const verified = await verifyDelivery(
      connection.app,
      request.headers,
      raw,
      connection.webhookSecret,
      Date.now()
    );
    if (!verified.ok) {
      return inboundResponse(401, { ok: false, error: verified.error });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return inboundResponse(400, { ok: false, error: "Invalid JSON." });
    }
    const envelopeEvent =
      payload && typeof payload === "object"
        ? (payload as { event?: unknown }).event
        : undefined;
    const event =
      verified.delivery.event ||
      (typeof envelopeEvent === "string" ? envelopeEvent : "");

    const meaning = interpretEvent(connection.app, event, payload);
    if (meaning.kind === "ignore") {
      return inboundResponse(200, { ok: true, ignored: true });
    }
    if (meaning.kind === "catalogue") {
      await ctx.scheduler.runAfter(0, internal.apps.refreshItems, {
        connectionId: connection.connectionId,
      });
      return inboundResponse(200, { ok: true });
    }

    const status = await ctx.runMutation(internal.apps.acceptResult, {
      connectionId: connection.connectionId,
      deliveryId: verified.delivery.deliveryId,
      ref: meaning.ref ?? undefined,
      text: meaning.text,
      data: meaning.data,
    });
    return inboundResponse(200, { ok: true, status });
  }),
});

http.route({
  pathPrefix: "/integrations/google/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\/integrations\/google\//, "");
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing token." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // The engine sends the tool's parameters as the whole JSON body; a body
    // that will not parse is a bug on our side, not something to pass on.
    let input: unknown = {};
    try {
      input = await request.json();
    } catch {
      input = {};
    }

    const result = await ctx.runAction(internal.integrations.runToolCall, {
      callToken: token,
      action,
      input,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
