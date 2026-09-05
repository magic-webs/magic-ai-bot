import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireWorkspace } from "./lib/auth";

/**
 * The data half of the operator assistant.
 *
 * Split from `assistant.ts` because that module is `"use node"` — which may
 * only export actions — and this is a query. Same split, same reason, as
 * `auth.ts` and `authDb.ts`.
 */

/** Enough to answer from, small enough not to cost a fortune per question. */
const RECENT_CONVERSATIONS = 30;
const RECENT_ORDERS = 20;
const PREVIEW_CHARS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Everything the assistant is allowed to know, read in one query.
 *
 * Internal, and it re-checks the caller owns the workspace — an action's
 * arguments are client-supplied, so the id cannot be trusted on its own.
 */
export const snapshot = internalQuery({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;

    const dayAgo = args.now - DAY_MS;
    const weekAgo = args.now - 7 * DAY_MS;

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(100);

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const stages = await ctx.db
      .query("leadStages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const agentName = new Map(agents.map((a) => [a._id as string, a.botName]));

    // Contact labels for the recent rows only — resolving 200 would be 200
    // point reads to name conversations nobody asked about.
    const recent = conversations.slice(0, RECENT_CONVERSATIONS);
    const contacts = await Promise.all(
      recent.map((row) => ctx.db.get("contacts", row.contactId))
    );

    return {
      workspace: {
        name: workspace.name,
        timezone: workspace.timezone,
        currency: workspace.currency,
        ownerName: workspace.ownerName ?? null,
      },
      totals: {
        conversationsToday: conversations.filter((c) => c.lastMessageAt >= dayAgo)
          .length,
        conversationsWeek: conversations.filter((c) => c.lastMessageAt >= weekAgo)
          .length,
        openNow: conversations.filter((c) => c.status === "open").length,
        escalatedNow: conversations.filter((c) => c.status === "escalated").length,
        ordersToday: orders.filter((o) => o.createdAt >= dayAgo).length,
        ordersWeek: orders.filter((o) => o.createdAt >= weekAgo).length,
        revenueToday: orders
          .filter((o) => o.createdAt >= dayAgo)
          .reduce((sum, o) => sum + (o.total ?? 0), 0),
      },
      agents: agents.map((a) => ({
        name: a.botName,
        role: a.role,
        kind: a.kind ?? "specialist",
        status: a.status,
      })),
      stages: stages.map((s) => ({
        name: s.name,
        outcome: s.outcome,
      })),
      conversations: recent.map((row, index) => ({
        contact: contacts[index]?.name ?? contacts[index]?.externalId ?? "Unknown",
        agent: agentName.get((row.activeAgentId ?? row.agentId) as string) ?? "—",
        channel: row.channelType,
        status: row.status,
        messages: row.messageCount,
        minutesAgo: Math.round((args.now - row.lastMessageAt) / 60_000),
        preview: truncate(row.lastMessagePreview, PREVIEW_CHARS),
      })),
      orders: orders.slice(0, RECENT_ORDERS).map((o) => ({
        number: o.orderNumber,
        customer: o.customer.name,
        total: o.total ?? null,
        status: o.status,
        minutesAgo: Math.round((args.now - o.createdAt) / 60_000),
        items: o.items.map((i) => `${i.quantity} x ${i.productName}`).slice(0, 5),
      })),
    };
  },
});



// ------------------------------------------------------------------ history

/** How much of the thread the model is given as context. */
export const CONTEXT_TURNS = 8;

/** How much of it the screen renders. */
const HISTORY_LIMIT = 100;

/** The operator's thread with one agent, oldest first. */
export const history = query({
  args: { workspaceId: v.id("workspaces"), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("assistantMessages")
      .withIndex("by_agent", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("agentId", args.agentId)
      )
      .order("desc")
      .take(HISTORY_LIMIT);

    // Taken newest-first so the cap keeps the *recent* end, then flipped:
    // a thread reads oldest at the top.
    return rows.reverse().map((row) => ({
      _id: row._id,
      role: row.role,
      text: row.text,
      createdAt: row.createdAt,
    }));
  },
});

export const clearHistory = mutation({
  args: { workspaceId: v.id("workspaces"), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("assistantMessages")
      .withIndex("by_agent", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("agentId", args.agentId)
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { cleared: rows.length };
  },
});

/** Written by the action, one row per turn. */
export const append = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("assistantMessages", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      role: args.role,
      text: args.text,
      createdAt: Date.now(),
    });
  },
});

/**
 * The last few turns, for the model.
 *
 * Read here rather than sent by the client: the client's copy is whatever is
 * on its screen, and context the server bills for should not be something a
 * caller can rewrite.
 */
export const recent = internalQuery({
  args: { workspaceId: v.id("workspaces"), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("assistantMessages")
      .withIndex("by_agent", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("agentId", args.agentId)
      )
      .order("desc")
      .take(CONTEXT_TURNS);
    return rows.reverse().map((row) => ({ role: row.role, text: row.text }));
  },
});
