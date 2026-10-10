import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { randomKey } from "./lib/shared";
import { publicSiteUrl } from "./lib/publicUrl";
import { providerError } from "./lib/panel";
import {
  INSTAGRAM_AUTHORIZE_URL,
  INSTAGRAM_GRAPH,
  INSTAGRAM_SCOPES,
  INSTAGRAM_TOKEN_URL,
  graphUrl,
  instagramMessage,
  instagramRedirectUri,
  splitForInstagram,
} from "./lib/instagram";
import type { Outbound } from "./lib/whatsappSend";

const STATE_TTL_MS = 15 * 60_000;
const REFRESH_WITHIN_MS = 10 * 24 * 60 * 60_000;
const EVENT_TTL_MS = 3 * 24 * 60 * 60_000;
const UNSUPPORTED =
  "Instagram cannot show that kind of message. Write it out as plain text instead.";

type InstagramConfig = NonNullable<Doc<"channels">["instagram"]>;
type SendResult = { ok: boolean; error?: string; wamid?: string };

function appCredentials() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  return appId && appSecret ? { appId, appSecret } : null;
}

async function graphError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return providerError(response.status, body, text);
}

export const startConnect = action({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    returnTo: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const credentials = appCredentials();
    if (!credentials) {
      console.error(
        "instagram.startConnect: INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET is not set"
      );
      throw new ConvexError("Instagram is not available right now.");
    }

    const state = `${randomKey(16)}${randomKey(16)}`;
    await ctx.runMutation(internal.instagram.putState, {
      state,
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      name: args.name.trim() || "Instagram",
      returnTo: args.returnTo,
    });

    const params = new URLSearchParams({
      client_id: credentials.appId,
      redirect_uri: instagramRedirectUri(publicSiteUrl()),
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      force_reauth: "true",
      state,
    });
    return { url: `${INSTAGRAM_AUTHORIZE_URL}?${params.toString()}` };
  },
});

export const putState = internalMutation({
  args: {
    state: v.string(),
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    returnTo: v.string(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent || agent.workspaceId !== args.workspaceId) {
      throw new ConvexError("Pick the agent that answers here");
    }
    await ctx.db.insert("instagramOAuthStates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const takeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("instagramOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) return null;

    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > STATE_TTL_MS) return null;
    return {
      workspaceId: row.workspaceId,
      agentId: row.agentId,
      name: row.name,
      returnTo: row.returnTo,
    };
  },
});

export const finishConnect = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    error?: string;
    returnTo: string | null;
    username?: string;
  }> => {
    const pending = await ctx.runMutation(internal.instagram.takeState, {
      state: args.state,
    });
    if (!pending) {
      return {
        ok: false,
        returnTo: null,
        error: "This sign-in link has expired. Start again from Channels.",
      };
    }
    const fail = (error: string) => ({
      ok: false,
      error,
      returnTo: pending.returnTo,
    });

    const credentials = appCredentials();
    if (!credentials) return fail("Instagram is not available right now.");

    const exchange = await fetch(INSTAGRAM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
        grant_type: "authorization_code",
        redirect_uri: instagramRedirectUri(publicSiteUrl()),
        code: args.code,
      }),
    });
    if (!exchange.ok) {
      console.error("[instagram] code exchange failed", await graphError(exchange));
      return fail("Instagram did not accept the sign-in. Try again.");
    }
    const exchanged = (await exchange.json()) as {
      access_token?: string;
      data?: Array<{ access_token?: string }>;
    };
    const shortToken = exchanged.access_token ?? exchanged.data?.[0]?.access_token;
    if (!shortToken) return fail("Instagram did not return an access token.");

    const longParams = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: credentials.appSecret,
      access_token: shortToken,
    });
    const long = await fetch(`${INSTAGRAM_GRAPH}/access_token?${longParams}`);
    if (!long.ok) {
      console.error("[instagram] long-lived exchange failed", await graphError(long));
      return fail("Instagram did not issue a long-lived token. Try again.");
    }
    const longLived = (await long.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const accessToken = longLived.access_token;
    const tokenExpiresAt =
      Date.now() + (longLived.expires_in ?? 60 * 24 * 60 * 60) * 1000;

    const me = await fetch(
      graphUrl("me?fields=user_id,username,name,profile_picture_url"),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!me.ok) {
      console.error("[instagram] profile read failed", await graphError(me));
      return fail("Could not read the Instagram account.");
    }
    const profile = (await me.json()) as {
      user_id?: string | number;
      username?: string;
      name?: string;
      profile_picture_url?: string;
    };
    if (!profile.user_id || !profile.username) {
      return fail("Instagram did not say which account signed in.");
    }

    const subscribe = await fetch(
      graphUrl("me/subscribed_apps?subscribed_fields=messages,messaging_postbacks"),
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!subscribe.ok) {
      const error = await graphError(subscribe);
      console.error("[instagram] subscribe failed", error);
      return fail(`Connected, but Instagram would not send its messages here: ${error}`);
    }

    const saved = await ctx.runMutation(internal.instagram.saveConnection, {
      workspaceId: pending.workspaceId,
      agentId: pending.agentId,
      name: pending.name,
      instagram: {
        userId: String(profile.user_id),
        username: profile.username,
        name: profile.name || undefined,
        profilePictureUrl: profile.profile_picture_url || undefined,
        accessToken,
        tokenExpiresAt,
      },
    });
    if (!saved.ok) return fail(saved.error);

    return { ok: true, returnTo: pending.returnTo, username: profile.username };
  },
});

const instagramConfig = v.object({
  userId: v.string(),
  username: v.string(),
  name: v.optional(v.string()),
  profilePictureUrl: v.optional(v.string()),
  accessToken: v.string(),
  tokenExpiresAt: v.number(),
});

export const saveConnection = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    instagram: instagramConfig,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.instagram.userId))
      .take(10);
    const held = existing.filter((channel) => channel.type === "instagram");

    if (held.some((channel) => channel.workspaceId !== args.workspaceId)) {
      return {
        ok: false,
        error: `@${args.instagram.username} is already connected to another workspace.`,
      };
    }

    const now = Date.now();
    const mine = held[0];
    if (mine) {
      await ctx.db.patch(mine._id, {
        instagram: args.instagram,
        status: "active",
        lastError: undefined,
        updatedAt: now,
      });
      return { ok: true };
    }

    await ctx.db.insert("channels", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      type: "instagram",
      name: args.name,
      channelKey: randomKey(28),
      externalId: args.instagram.userId,
      instagram: args.instagram,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true };
  },
});

export const byAccount = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.userId))
      .take(10);
    return channels.find((channel) => channel.type === "instagram") ?? null;
  },
});

/** False when this `mid` was already handled — Meta delivers at least once. */
export const claimEvent = internalMutation({
  args: { mid: v.string() },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("instagramEvents")
      .withIndex("by_mid", (q) => q.eq("mid", args.mid))
      .first();
    if (seen) return false;
    await ctx.db.insert("instagramEvents", { mid: args.mid, createdAt: Date.now() });
    return true;
  },
});

async function sendOne(
  config: InstagramConfig,
  recipient: Record<string, string>,
  body: Record<string, unknown>
): Promise<SendResult> {
  const response = await fetch(graphUrl("me/messages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({ recipient, ...body }),
  });
  if (!response.ok) return { ok: false, error: await graphError(response) };
  const sent = (await response.json().catch(() => null)) as {
    message_id?: string;
  } | null;
  return { ok: true, wamid: sent?.message_id };
}

async function send(
  config: InstagramConfig,
  to: string,
  message: Outbound
): Promise<SendResult> {
  if (message.kind === "text") {
    let last: SendResult = { ok: false, error: "Nothing to send." };
    for (const part of splitForInstagram(message.body)) {
      last = await sendOne(config, { id: to }, { message: { text: part } });
      if (!last.ok) return last;
    }
    return last;
  }
  const payload = instagramMessage(message);
  if (!payload) return { ok: false, error: UNSUPPORTED };
  return await sendOne(config, { id: to }, { message: payload });
}

async function senderAction(
  config: InstagramConfig,
  to: string,
  action: "mark_seen" | "typing_on"
): Promise<void> {
  await sendOne(config, { id: to }, { sender_action: action }).catch(() => undefined);
}

async function senderName(
  config: InstagramConfig,
  senderId: string
): Promise<string | undefined> {
  const response = await fetch(graphUrl(`${senderId}?fields=name,username`), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const profile = (await response.json().catch(() => null)) as {
    name?: string;
    username?: string;
  } | null;
  return profile?.name || (profile?.username ? `@${profile.username}` : undefined);
}

export const sendOutbound = internalAction({
  args: {
    channelId: v.id("channels"),
    to: v.string(),
    message: v.any(),
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
  handler: async (ctx, args): Promise<SendResult> => {
    const resolved = await ctx.runQuery(internal.channels.resolveById, {
      channelId: args.channelId,
    });
    const channel = resolved?.channel;
    if (!channel || channel.type !== "instagram" || !channel.instagram?.accessToken) {
      return { ok: false, error: "This conversation is not on a connected Instagram account." };
    }

    const result = await send(channel.instagram, args.to, args.message as Outbound);
    if (!result.ok && result.error !== UNSUPPORTED) {
      console.error("[instagram] outbound failed", result.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: result.error,
      });
    }
    return result;
  },
});

type InboundEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: Array<{ type?: string }>;
  };
  postback?: { mid?: string; title?: string; payload?: string };
};

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

async function deliverReply(
  ctx: ActionCtx,
  channel: Doc<"channels">,
  config: InstagramConfig,
  to: string,
  result: TurnOutcome
): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> {
  if (result.heldForHuman) return { handled: true, reason: "human_handling" };
  if (result.answeredWithControl) {
    return { handled: true, reason: "answered_with_control" };
  }
  if (!result.text) {
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
      error: result.error ?? "The agent produced no reply.",
    });
    return { handled: false, reason: result.error ?? "no_reply" };
  }

  const sent = await send(config, to, { kind: "text", body: result.text });
  if (result.replyMessageId) {
    await ctx.runMutation(internal.deliveries.markSent, {
      messageId: result.replyMessageId,
      wamids: [],
      error: sent.ok ? undefined : (sent.error ?? "Instagram rejected the message."),
    });
  }
  if (!sent.ok) {
    console.error("[instagram] send failed", sent.error);
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
      error: sent.error,
    });
  }
  return { handled: true, toolCalls: result.toolCalls };
}

export const handleInbound = internalAction({
  args: { userId: v.string(), event: v.any() },
  handler: async (
    ctx,
    args
  ): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> => {
    const channel = await ctx.runQuery(internal.instagram.byAccount, {
      userId: args.userId,
    });
    if (!channel?.instagram?.accessToken) {
      return { handled: false, reason: "unknown_account" };
    }
    const config = channel.instagram;

    const event = args.event as InboundEvent;
    const from = event.sender?.id;
    const message = event.message;
    if (!from || from === args.userId || message?.is_echo) {
      return { handled: false, reason: "own_message" };
    }
    if (message?.is_deleted) return { handled: false, reason: "deleted" };

    const mid = message?.mid ?? event.postback?.mid;
    if (!mid) return { handled: false, reason: "no_message" };
    if (!(await ctx.runMutation(internal.instagram.claimEvent, { mid }))) {
      return { handled: false, reason: "duplicate" };
    }

    await ctx.runMutation(internal.channels.touchInbound, { channelId: channel._id });
    if (channel.status !== "active") {
      return { handled: false, reason: "channel_paused" };
    }

    await senderAction(config, from, "mark_seen");

    const text = (message?.text ?? event.postback?.title ?? "").trim();
    if (!text) {
      await send(config, from, {
        kind: "text",
        body: "I can only read text messages here. Could you type your question?",
      });
      return { handled: true, reason: "unsupported_type" };
    }

    await senderAction(config, from, "typing_on");
    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: channel.agentId,
      channelType: "instagram",
      channelId: channel._id,
      externalId: from,
      contactName: await senderName(config, from),
      text,
    });

    return await deliverReply(ctx, channel, config, from, result);
  },
});

/** A Magic app's result on an Instagram thread. See `whatsapp.respondToEvent`. */
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

    const resolved = context.channelId
      ? await ctx.runQuery(internal.channels.resolveById, {
          channelId: context.channelId,
        })
      : null;
    const channel = resolved?.channel;
    if (
      !channel ||
      channel.type !== "instagram" ||
      !channel.instagram?.accessToken ||
      channel.status !== "active"
    ) {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
      return { handled: false, reason: "channel_unavailable" };
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: context.agentId,
      channelType: "instagram",
      channelId: channel._id,
      externalId: context.externalId,
      contactName: context.contactName ?? undefined,
      text: args.text,
    });
    if (!result.conversationId) {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
      return { handled: false, reason: result.error ?? "turn_not_started" };
    }
    return await deliverReply(
      ctx,
      channel,
      channel.instagram,
      context.externalId,
      result
    );
  },
});

export const unsubscribe = internalAction({
  args: { accessToken: v.string() },
  handler: async (_ctx, args) => {
    await fetch(graphUrl("me/subscribed_apps"), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${args.accessToken}` },
    }).catch(() => undefined);
  },
});

/** Meta's deauthorize and data-deletion callbacks: the account took its access back. */
export const revokeAccount = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.userId))
      .take(10);
    for (const channel of channels) {
      if (channel.type !== "instagram" || !channel.instagram) continue;
      await ctx.db.patch(channel._id, {
        instagram: { ...channel.instagram, accessToken: "" },
        status: "error",
        lastError: "Access was removed from Instagram. Reconnect to resume.",
        updatedAt: Date.now(),
      });
    }
  },
});

export const tokensDue = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_type", (q) => q.eq("type", "instagram"))
      .take(500);
    return channels
      .filter(
        (channel) =>
          channel.instagram?.accessToken &&
          channel.instagram.tokenExpiresAt < args.before
      )
      .map((channel) => ({
        channelId: channel._id,
        accessToken: channel.instagram!.accessToken,
        tokenExpiresAt: channel.instagram!.tokenExpiresAt,
      }));
  },
});

export const saveToken = internalMutation({
  args: {
    channelId: v.id("channels"),
    accessToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel?.instagram) return;
    if (args.accessToken && args.tokenExpiresAt) {
      await ctx.db.patch(channel._id, {
        instagram: {
          ...channel.instagram,
          accessToken: args.accessToken,
          tokenExpiresAt: args.tokenExpiresAt,
        },
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(channel._id, {
      status: "error",
      lastError: args.error?.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

export const refreshTokens = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.instagram.tokensDue, {
      before: now + REFRESH_WITHIN_MS,
    });

    for (const row of due) {
      const params = new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: row.accessToken,
      });
      const response = await fetch(
        `${INSTAGRAM_GRAPH}/refresh_access_token?${params}`
      ).catch(() => null);

      if (response?.ok) {
        const body = (await response.json()) as {
          access_token: string;
          expires_in?: number;
        };
        await ctx.runMutation(internal.instagram.saveToken, {
          channelId: row.channelId,
          accessToken: body.access_token,
          tokenExpiresAt: now + (body.expires_in ?? 60 * 24 * 60 * 60) * 1000,
        });
        continue;
      }

      const error = response ? await graphError(response) : "network error";
      console.error("[instagram] token refresh failed", row.channelId, error);
      if (row.tokenExpiresAt < now) {
        await ctx.runMutation(internal.instagram.saveToken, {
          channelId: row.channelId,
          error: "Instagram access expired. Reconnect to resume.",
        });
      }
    }

    await ctx.runMutation(internal.instagram.sweep, {});
  },
});

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const events = await ctx.db
      .query("instagramEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", now - EVENT_TTL_MS))
      .take(1000);
    for (const event of events) await ctx.db.delete(event._id);

    const states = await ctx.db.query("instagramOAuthStates").take(500);
    for (const state of states) {
      if (now - state.createdAt > STATE_TTL_MS) await ctx.db.delete(state._id);
    }
  },
});
