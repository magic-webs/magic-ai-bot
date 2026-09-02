// Node runtime: this file drives the AI SDK for Whisper transcription, which
// the default V8 runtime is not the place for. Legal here because the module
// exports only actions — Convex requires that of a Node-runtime file, and both
// handleInbound and sendOutbound qualify.
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildMessage, type Outbound } from "./lib/whatsappSend";
import { experimental_transcribe as transcribeAudio } from "ai";
import { aiGateway, TRANSCRIPTION_MODEL } from "./lib/gateway";

// WhatsApp caps a text body at 4096 characters.
const MAX_BODY = 3900;

type WhatsAppConfig = {
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
};

function messagesUrl(config: WhatsAppConfig): string {
  return `${config.apiBaseUrl.replace(/\/$/, "")}/${config.apiVersion}/${config.phoneNumberId}/messages`;
}

async function send(
  config: WhatsAppConfig,
  to: string,
  message: Outbound,
  replyTo?: string
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(messagesUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify(buildMessage(to, message, replyTo)),
  });

  if (response.ok) return { ok: true };
  const text = await response.text().catch(() => "");
  return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
}

// Long replies are split on paragraph, then sentence, then hard boundaries.
function splitForWhatsApp(text: string): string[] {
  if (text.length <= MAX_BODY) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_BODY) {
    const window = remaining.slice(0, MAX_BODY);
    let cut = window.lastIndexOf("\n\n");
    if (cut < MAX_BODY * 0.5) cut = window.lastIndexOf(". ");
    if (cut < MAX_BODY * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = MAX_BODY;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function markReadAndTyping(
  config: WhatsAppConfig,
  messageId: string
): Promise<void> {
  // Marking read with typing_indicator shows the "typing…" state in the client.
  await fetch(messagesUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    }),
  }).catch(() => undefined);
}

async function downloadMedia(
  config: WhatsAppConfig,
  mediaId: string
): Promise<{ blob: Blob; mimeType: string }> {
  const metaResponse = await fetch(
    `${config.apiBaseUrl.replace(/\/$/, "")}/${config.apiVersion}/${mediaId}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } }
  );
  if (!metaResponse.ok) {
    throw new Error(
      `Could not read media metadata: HTTP ${metaResponse.status}`
    );
  }

  const contentType = metaResponse.headers.get("content-type") ?? "";
  // Some BSP proxies stream the bytes directly instead of returning metadata.
  if (!contentType.includes("application/json")) {
    return {
      blob: await metaResponse.blob(),
      mimeType: contentType.split(";")[0].trim() || "application/octet-stream",
    };
  }

  const meta = (await metaResponse.json()) as {
    url?: string;
    mime_type?: string;
  };
  if (!meta.url) throw new Error("Media metadata did not include a URL");

  const binaryResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!binaryResponse.ok) {
    throw new Error(`Could not download media: HTTP ${binaryResponse.status}`);
  }

  return {
    blob: await binaryResponse.blob(),
    mimeType: meta.mime_type ?? "audio/ogg",
  };
}

async function transcribe(blob: Blob): Promise<string> {
  const result = await transcribeAudio({
    model: aiGateway().transcription(TRANSCRIPTION_MODEL),
    audio: new Uint8Array(await blob.arrayBuffer()),
  });
  return result.text.trim();
}

// The subset of Meta's inbound message shape this app reads.
type InboundMessage = {
  type?: string;
  from?: string;
  id?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
    nfm_reply?: { response_json?: string };
  };
  audio?: { id?: string };
  voice?: { id?: string };
};

// Pulls the user-visible text out of the several shapes an inbound message
// can take. Returns null when there is nothing textual to work with.
function extractText(message: InboundMessage): string | null {
  switch (message.type) {
    case "text":
      return message.text?.body ?? null;
    case "button":
      return message.button?.text ?? null;
    case "interactive": {
      const interactive = message.interactive;
      return (
        interactive?.button_reply?.title ??
        interactive?.list_reply?.title ??
        interactive?.nfm_reply?.response_json ??
        null
      );
    }
    default:
      return null;
  }
}

/**
 * Send one message on a channel.
 *
 * The engine's WhatsApp tools call this. They know which channel the
 * conversation arrived on and the customer's number; the access token stays
 * inside Convex, which is the same reason the inbound webhook lives here.
 */
export const sendOutbound = internalAction({
  args: {
    channelId: v.id("channels"),
    to: v.string(),
    // The Outbound union is enforced by TypeScript at the tool that builds it,
    // not restated here: a v.union of seventeen message shapes would be a
    // second description of the same thing, free to drift from the first.
    message: v.any(),
    replyTo: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const resolved = await ctx.runQuery(internal.channels.resolveById, {
      channelId: args.channelId,
    });
    const channel = resolved?.channel;
    if (!channel || channel.type !== "whatsapp" || !channel.whatsapp) {
      return {
        ok: false,
        error: "This conversation is not on a WhatsApp channel.",
      };
    }

    const result = await send(
      channel.whatsapp,
      args.to,
      args.message as Outbound,
      args.replyTo
    );
    if (!result.ok) {
      // Surfaced on the Channels page, which is where someone looks when a
      // rich message silently fails to arrive.
      console.error("[whatsapp] outbound failed", result.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: result.error,
      });
    }
    return result;
  },
});

export const handleInbound = internalAction({
  args: {
    channelKey: v.string(),
    payload: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    handled: boolean;
    reason?: string;
    toolCalls?: string[];
  }> => {
    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey: args.channelKey,
    });
    if (!resolved) {
      console.warn("[whatsapp] unknown channel key", args.channelKey);
      return { handled: false, reason: "unknown_channel" };
    }

    const { channel } = resolved;
    if (channel.type !== "whatsapp" || !channel.whatsapp) {
      return { handled: false, reason: "not_a_whatsapp_channel" };
    }
    const config: WhatsAppConfig = channel.whatsapp;

    const value = args.payload?.entry?.[0]?.changes?.[0]?.value as
      | {
          messages?: InboundMessage[];
          contacts?: Array<{ profile?: { name?: string } }>;
        }
      | undefined;

    const message = value?.messages?.[0];
    if (!message?.from || !message.id) {
      // Delivery receipts and status updates arrive on the same webhook.
      return { handled: false, reason: "no_message" };
    }

    const from = message.from;
    const messageId = message.id;
    const contactName = value?.contacts?.[0]?.profile?.name;

    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
    });

    if (channel.status !== "active") {
      console.log("[whatsapp] channel is not active, ignoring", channel._id);
      return { handled: false, reason: "channel_paused" };
    }

    await markReadAndTyping(config, messageId);

    // ---- Work out what the customer actually said --------------------------
    let text = extractText(message);

    if (!text && (message.type === "audio" || message.type === "voice")) {
      const apiKey = process.env.AI_GATEWAY_API_KEY;
      const mediaId = message.audio?.id ?? message.voice?.id;
      if (apiKey && mediaId) {
        try {
          const { blob } = await downloadMedia(config, mediaId);
          text = await transcribe(blob);
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : String(error);
          console.error("[whatsapp] voice handling failed", reason);
          await ctx.runMutation(internal.channels.touchInbound, {
            channelId: channel._id,
            error: reason,
          });
          await send(config, from, {
            kind: "text",
            body: "Sorry, I could not make out that voice note. Could you type it instead?",
          });
          return { handled: true, reason: "voice_failed" };
        }
      }
    }

    if (!text?.trim()) {
      await send(config, from, {
        kind: "text",
        body: "I can read text messages and listen to voice notes. Could you send your question that way?",
      });
      return { handled: true, reason: "unsupported_type" };
    }

    // ---- Run the same engine the web playground uses -----------------------
    const result: {
      ok: boolean;
      text: string | null;
      toolCalls: string[];
      error?: string;
    } = await ctx.runAction(internal.engine.respond, {
      agentId: channel.agentId,
      channelType: "whatsapp",
      channelId: channel._id,
      externalId: from,
      contactName,
      contactPhone: from,
      text: text.trim(),
    });

    if (!result.text) {
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: result.error ?? "The agent produced no reply.",
      });
      return { handled: false, reason: result.error ?? "no_reply" };
    }

    for (const part of splitForWhatsApp(result.text)) {
      const sent = await send(config, from, { kind: "text", body: part });
      if (!sent.ok) {
        console.error("[whatsapp] send failed", sent.error);
        await ctx.runMutation(internal.channels.touchInbound, {
          channelId: channel._id,
          error: sent.error,
        });
        break;
      }
    }

    return { handled: true, toolCalls: result.toolCalls };
  },
});
