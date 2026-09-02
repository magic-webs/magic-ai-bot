// The public surface of the embedded website widget.
//
// Everything here is called by an anonymous visitor on someone else's website,
// so unlike the rest of the app there is no principal to check. Two things
// stand in for one:
//
//   channelKey — 28 unguessable characters in the embed snippet. It selects
//                the channel, and with it the workspace and the agent. No
//                workspace id, agent id or conversation id is ever accepted
//                from the caller.
//   sessionId  — a random id the browser keeps in localStorage. It is the
//                visitor's identity, so it may only ever address its own
//                contact and its own conversation.
//
// Replies are filtered on the way out: tool traces, internal handoff notes and
// engine errors never reach the page.

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveGreeting } from "./lib/prompt";

const MAX_SESSION_ID_CHARS = 64;
const MAX_FIELD_CHARS = 120;

// The widget mints these as `web-<random>`. Anything else is a caller that
// wrote its own id, and it is rejected rather than trusted.
function normalizeSessionId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 6 || trimmed.length > MAX_SESSION_ID_CHARS) return null;
  if (!/^web-[a-z0-9]+$/i.test(trimmed)) return null;
  return trimmed;
}

async function channelByKey(
  ctx: QueryCtx | MutationCtx,
  channelKey: string
): Promise<Doc<"channels"> | null> {
  if (!channelKey || channelKey.length > 64) return null;
  const channel = await ctx.db
    .query("channels")
    .withIndex("by_channelKey", (q) => q.eq("channelKey", channelKey))
    .unique();
  if (!channel || channel.type !== "web") return null;
  return channel;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Everything the page needs before the first message: who the bot is, and how
 * to render itself. Returns null for an unknown, deleted or paused widget so
 * the page can say so rather than hanging.
 */
export const bootstrap = query({
  args: { channelKey: v.string() },
  handler: async (ctx, args) => {
    const channel = await channelByKey(ctx, args.channelKey);
    if (!channel || channel.status !== "active") return null;

    const agent = await ctx.db.get("agents", channel.agentId);
    const workspace = await ctx.db.get("workspaces", channel.workspaceId);
    if (!agent || !workspace) return null;

    return {
      channelName: channel.name,
      workspaceName: workspace.name,
      // The entry agent — normally the workspace's front desk. Whoever it
      // routes to answers under their own name, which `session` reports.
      agent: {
        botName: agent.botName,
        role: agent.role,
        // Resolved here rather than in the page: the fallback wording needs
        // the workspace name, and the page has no business reading the agent
        // document to work it out.
        greeting: resolveGreeting(agent, workspace.name),
      },
    };
  },
});

/**
 * The visitor's own conversation: whether they have introduced themselves yet,
 * who is currently answering, and the customer-visible transcript.
 *
 * Registration state is read from the database rather than from localStorage,
 * so clearing one flag in the browser cannot skip the form and a returning
 * visitor is not asked twice.
 */
export const session = query({
  args: { channelKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const channel = await channelByKey(ctx, args.channelKey);
    const sessionId = normalizeSessionId(args.sessionId);
    if (!channel || !sessionId) {
      return {
        registered: false,
        messages: [],
        agentBotName: null,
        agentRole: null,
      };
    }

    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("externalId", sessionId)
      )
      .unique();
    if (!contact) {
      return {
        registered: false,
        messages: [],
        agentBotName: null,
        agentRole: null,
      };
    }

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_contact_agent", (q) =>
        q.eq("contactId", contact._id).eq("agentId", channel.agentId)
      )
      .unique();

    if (!conversation) {
      return {
        registered: true,
        contactName: contact.name ?? null,
        messages: [],
        agentBotName: null,
        agentRole: null,
      };
    }

    const rows = (
      await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id)
        )
        // Newest first, then reversed: taking 200 in ascending order would pin
        // the widget to the beginning of a long conversation and never show the
        // reply the visitor is waiting for.
        .order("desc")
        .take(200)
    ).reverse();

    // Only what the customer is allowed to see. Tool traces, handoff notes and
    // engine errors are internal, and a handoff note in particular would name
    // the agents behind the curtain.
const visible = rows.filter(
      (row) =>
        (row.kind === "text" || row.kind === "rich") &&
        (row.role === "user" || row.role === "assistant") &&
        ((row.text ?? "").trim().length > 0 || Boolean(row.payload))
    );

    // Assistant messages are attributed, so the widget can show the customer
    // that they are now talking to a named specialist.
    const agentIds = new Set<Id<"agents">>();
    for (const row of visible) if (row.agentId) agentIds.add(row.agentId);
    const holderId = conversation.activeAgentId ?? conversation.agentId;
    agentIds.add(holderId);

    const botNames = new Map<string, string>();
    const roles = new Map<string, string>();
    for (const agentId of agentIds) {
      const agent = await ctx.db.get("agents", agentId);
      if (!agent) continue;
      botNames.set(agentId, agent.botName);
      roles.set(agentId, agent.role);
    }

    return {
      registered: true,
      contactName: contact.name ?? null,
      agentBotName: botNames.get(holderId) ?? null,
      agentRole: roles.get(holderId) ?? null,
      messages: visible.map((row) => ({
        id: row._id as string,
        role: row.role as "user" | "assistant",
        text: row.text ?? "",
        // The chat renders buttons, lists, media and cards from this. Still
        // only what the customer was shown — tool traces, handoff notes and
        // engine errors are filtered out above, as they always were.
        payload: row.kind === "rich" ? (row.payload ?? null) : null,
        botName: row.agentId ? botNames.get(row.agentId) ?? null : null,
        createdAt: row.createdAt,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Introduces the visitor. The workspace comes from the channel, never from the
 * caller, so a widget key can only ever create contacts in its own workspace.
 */
export const register = mutation({
  args: {
    channelKey: v.string(),
    sessionId: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const channel = await channelByKey(ctx, args.channelKey);
    if (!channel || channel.status !== "active") {
      throw new Error("This chat widget is no longer available.");
    }
    const sessionId = normalizeSessionId(args.sessionId);
    if (!sessionId) throw new Error("Invalid chat session.");

    const name = args.name?.trim().slice(0, MAX_FIELD_CHARS) || undefined;
    const phone = args.phone?.trim().slice(0, MAX_FIELD_CHARS) || undefined;
    const now = Date.now();

    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("externalId", sessionId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        // Only fill blanks: a visitor cannot overwrite details the team has
        // since corrected in the dashboard.
        name: existing.name ?? name,
        phone: existing.phone ?? phone,
        lastSeenAt: now,
      });
      return { contactId: existing._id };
    }

    const contactId = await ctx.db.insert("contacts", {
      workspaceId: channel.workspaceId,
      externalId: sessionId,
      channelType: "web",
      name,
      phone,
      attributes: [],
      lastSeenAt: now,
      createdAt: now,
    });
    return { contactId };
  },
});

// ---------------------------------------------------------------------------
// Internal — used by engine.respondFromWidget, which is a Node action and so
// cannot touch the database itself.
// ---------------------------------------------------------------------------

export const resolveForSend = internalQuery({
  args: { channelKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const channel = await channelByKey(ctx, args.channelKey);
    if (!channel) return { ok: false as const, reason: "unknown_channel" };
    if (channel.status !== "active") {
      return { ok: false as const, reason: "channel_paused" };
    }

    const sessionId = normalizeSessionId(args.sessionId);
    if (!sessionId) return { ok: false as const, reason: "bad_session" };

    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("externalId", sessionId)
      )
      .unique();
    // The page collects a name before it opens the composer; enforcing it here
    // too means a hand-rolled caller cannot skip the form.
    if (!contact) return { ok: false as const, reason: "not_registered" };

    return {
      ok: true as const,
      sessionId,
      channelId: channel._id,
      agentId: channel.agentId,
      contactName: contact.name,
      contactPhone: contact.phone,
    };
  },
});
