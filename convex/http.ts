import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey,
    });
    if (!resolved) {
      return new Response("Unknown channel", { status: 404 });
    }

    if (mode !== "subscribe" || token !== resolved.channel.verifyToken) {
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
