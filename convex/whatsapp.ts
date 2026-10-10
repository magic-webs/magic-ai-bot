// Node runtime: this file drives the AI SDK for Whisper transcription, which
// the default V8 runtime is not the place for. Legal here because the module
// exports only actions — Convex requires that of a Node-runtime file, and both
// handleInbound and sendOutbound qualify.
"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  buildMessage,
  providerMessageId,
  summarise,
  type Outbound,
} from "./lib/whatsappSend";
import { categoryOf, type BillingSource } from "./lib/billing";
import { providerError } from "./lib/panel";
import { transcribe as transcribeAudio } from "ai";
import { aiGateway, TRANSCRIPTION_MODEL } from "./lib/gateway";

// WhatsApp caps a text body at 4096 characters, and every part is billed.
const MAX_BODY = 4096;

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
): Promise<{ ok: boolean; error?: string; wamid?: string }> {
  const response = await fetch(messagesUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify(buildMessage(to, message, replyTo)),
  });

  if (response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: true, wamid: providerMessageId(body) };
  }
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: false, error: providerError(response.status, body, text) };
}

/**
 * Charge messages that were just delivered to the workspace's billing ledger.
 *
 * Never throws. The customer already has the message, so a billing write that
 * fails must not turn a delivered reply into a reported failure — the caller
 * would retry, or record it as undelivered, and both are worse than a missing
 * ledger row, which is logged here to be found.
 */
async function bill(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    channelId: Id<"channels">;
    conversationId?: Id<"conversations">;
    to: string;
    source: BillingSource;
    messages: Array<{ message: Outbound; wamid?: string }>;
  }
): Promise<void> {
  const messages = args.messages.flatMap(({ message, wamid }) => {
    const category = categoryOf(message);
    if (!category) return [];
    return [
      {
        category,
        preview: summarise(message),
        wamid,
        templateName: "templateName" in message ? message.templateName : undefined,
      },
    ];
  });
  if (messages.length === 0) return;
  try {
    await ctx.runMutation(internal.billing.recordSent, {
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      conversationId: args.conversationId,
      to: args.to,
      source: args.source,
      messages,
    });
  } catch (error) {
    console.error(
      "[billing] could not record a delivered message",
      error instanceof Error ? error.message : String(error)
    );
  }
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
    /**
     * Who is sending, and on which thread, for the billing ledger. Absent is
     * an agent — the engine's rich-message tools were the first caller.
     */
    source: v.optional(
      v.union(
        v.literal("agent"),
        v.literal("human"),
        v.literal("follow_up"),
        v.literal("system")
      )
    ),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; error?: string; wamid?: string }> => {
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

    const message = args.message as Outbound;
    const result = await send(channel.whatsapp, args.to, message, args.replyTo);
    if (result.ok) {
      await bill(ctx, {
        workspaceId: channel.workspaceId,
        channelId: channel._id,
        conversationId: args.conversationId,
        to: args.to,
        source: args.source ?? "agent",
        messages: [{ message, wamid: result.wamid }],
      });
    }
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
            error: "A voice note could not be transcribed.",
          });
          const apology: Outbound = {
            kind: "text",
            body: "Sorry, I could not make out that voice note. Could you type it instead?",
          };
          const sent = await send(config, from, apology);
          if (sent.ok) {
            await bill(ctx, {
              workspaceId: channel.workspaceId,
              channelId: channel._id,
              to: from,
              source: "system",
              messages: [{ message: apology, wamid: sent.wamid }],
            });
          }
          return { handled: true, reason: "voice_failed" };
        }
      }
    }

    if (!text?.trim()) {
      const hint: Outbound = {
        kind: "text",
        body: "I can read text messages and listen to voice notes. Could you send your question that way?",
      };
      const sent = await send(config, from, hint);
      if (sent.ok) {
        await bill(ctx, {
          workspaceId: channel.workspaceId,
          channelId: channel._id,
          to: from,
          source: "system",
          messages: [{ message: hint, wamid: sent.wamid }],
        });
      }
      return { handled: true, reason: "unsupported_type" };
    }

    // ---- Run the same engine the web playground uses -----------------------
    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: channel.agentId,
      channelType: "whatsapp",
      channelId: channel._id,
      externalId: from,
      contactName,
      contactPhone: from,
      text: text.trim(),
    });

    return await deliverReply(ctx, channel, config, from, result);
  },
});

/** The part of the engine's `TurnResult` sending a reply depends on. */
type TurnOutcome = {
  ok: boolean;
  text: string | null;
  conversationId: Id<"conversations"> | null;
  replyMessageId?: Id<"messages">;
  toolCalls: string[];
  heldForHuman?: boolean;
  answeredWithControl?: boolean;
  error?: string;
};

/**
 * Sends the agent's reply to one turn and bills it. Shared by an inbound
 * message and a Magic app's result, so both reach the customer — and the
 * channel's error log — the same way.
 */
async function deliverReply(
  ctx: ActionCtx,
  channel: { _id: Id<"channels">; workspaceId: Id<"workspaces"> },
  config: WhatsAppConfig,
  to: string,
  result: TurnOutcome
): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> {
  // Nothing to send, and nothing wrong: a colleague has the thread. Kept
  // above the error branch so a deliberate silence is not logged on the
  // channel as a failure to reply.
  if (result.heldForHuman) {
    return { handled: true, reason: "human_handling" };
  }

  // Also nothing to send, also nothing wrong: the reply was a menu or a set
  // of buttons, which the rich-message tool has already sent over the Cloud
  // API. There is deliberately no prose to follow it.
  if (result.answeredWithControl) {
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
    });
    return { handled: true, reason: "answered_with_control" };
  }

  if (!result.text) {
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
      error: result.error ?? "The agent produced no reply.",
    });
    return { handled: false, reason: result.error ?? "no_reply" };
  }

  // Billed together once the loop ends: a long reply is several WhatsApp
  // messages and each one is charged, but only the ones that went out.
  const delivered: Array<{ message: Outbound; wamid?: string }> = [];
  for (const part of splitForWhatsApp(result.text)) {
    const message: Outbound = { kind: "text", body: part };
    const sent = await send(config, to, message);
    if (result.replyMessageId) {
      await ctx.runMutation(internal.deliveries.markSent, {
        messageId: result.replyMessageId,
        wamids: sent.wamid ? [sent.wamid] : [],
        error: sent.ok ? undefined : (sent.error ?? "WhatsApp rejected the message."),
      });
    }
    if (!sent.ok) {
      console.error("[whatsapp] send failed", sent.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: sent.error,
      });
      break;
    }
    delivered.push({ message, wamid: sent.wamid });
  }
  await bill(ctx, {
    workspaceId: channel.workspaceId,
    channelId: channel._id,
    conversationId: result.conversationId ?? undefined,
    to,
    source: "agent",
    messages: delivered,
  });

  return { handled: true, toolCalls: result.toolCalls };
}

/**
 * A Magic app's result, answered by the agent as the customer's next turn.
 *
 * Here rather than in convex/apps.ts because the reply has to go out over the
 * same Cloud API call an inbound message's does. The web widget needs nothing
 * sent: the turn's recorded reply is its delivery, as everywhere else.
 *
 * When the agent cannot answer — the channel is paused, the entry agent is
 * paused — the result is still filed in the thread. It happened whether or
 * not anybody replies to it.
 */
export const respondToEvent = internalAction({
  args: { conversationId: v.id("conversations"), text: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> => {
    const context = await ctx.runQuery(internal.conversations.eventContext, {
      conversationId: args.conversationId,
    });
    if (!context) return { handled: false, reason: "no_conversation" };
    if (context.channelType === "instagram") {
      return await ctx.runAction(internal.instagram.respondToEvent, args);
    }

    const fileOnly = async (reason: string) => {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
      return { handled: false, reason };
    };

    let whatsapp: {
      channel: { _id: Id<"channels">; workspaceId: Id<"workspaces"> };
      config: WhatsAppConfig;
    } | null = null;
    if (context.channelType === "whatsapp") {
      const resolved = context.channelId
        ? await ctx.runQuery(internal.channels.resolveById, {
            channelId: context.channelId,
          })
        : null;
      const channel = resolved?.channel;
      if (
        !channel ||
        channel.type !== "whatsapp" ||
        !channel.whatsapp ||
        channel.status !== "active"
      ) {
        return await fileOnly("channel_unavailable");
      }
      whatsapp = { channel, config: channel.whatsapp };
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: context.agentId,
      channelType: context.channelType,
      channelId: context.channelId ?? undefined,
      externalId: context.externalId,
      contactName: context.contactName ?? undefined,
      contactPhone: context.contactPhone ?? undefined,
      text: args.text,
    });

    // The turn never started, so the result is not in the thread yet.
    if (!result.conversationId) {
      return await fileOnly(result.error ?? "turn_not_started");
    }
    if (!whatsapp) return { handled: true, toolCalls: result.toolCalls };

    return await deliverReply(
      ctx,
      whatsapp.channel,
      whatsapp.config,
      context.externalId,
      result
    );
  },
});
