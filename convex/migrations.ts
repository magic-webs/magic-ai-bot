// One-off data moves. Each is safe to run twice.
//
//   npx convex run migrations:ordersToRecords
//
// ---------------------------------------------------------------------------
// Orders → the Orders record book
//
// Orders stopped being their own thing: every workspace now keeps them in an
// ordinary record book (see convex/lib/ordersBook.ts). This moves what was
// there before, per workspace:
//
// - creates the book;
// - copies every order into it, the order number becoming the reference, so a
//   customer quoting an old number is still found by find_order;
// - takes create_order and lookup_orders off every agent that had them and
//   switches the book on for it instead, so nobody stops taking orders;
// - turns "New order" alerts into "Record filed" alerts on the book, with
//   their placeholders rewritten to the record's paths.
//
// The old `orders` rows are left where they are. Nothing reads them now, and
// deleting data is not something a migration should do on the way past.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { buildSearchBlob } from "./lib/shared";
import { REPLY_PREVIEW_CHARS } from "./lib/agentStats";
import { dayKey } from "./lib/dailyStats";
import { addToUsageDaily } from "./lib/usageDaily";
import {
  deliveryText,
  ensureOrdersBook,
  itemsText,
  stageForStatus,
} from "./lib/ordersBook";
import { loginEmailOf, loginEmailTaken } from "./authDb";

const WORKSPACE_BATCH = 20;
const ORDER_BATCH = 100;

const RETIRED_TOOLS = new Set(["create_order", "lookup_orders"]);

export const ordersToRecords = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });

    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.ordersToRecordsForWorkspace,
        { workspaceId: workspace._id, cursor: null }
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.ordersToRecords, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const ordersToRecordsForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return;

    const bookId = await ensureOrdersBook(ctx, workspace._id);
    const book = await ctx.db.get("recordBooks", bookId);
    if (!book) return;

    // Agents and alerts are a handful of rows, so the first batch does them.
    if (args.cursor === null) {
      await moveAgents(ctx, workspace._id, bookId);
      await moveAlerts(ctx, workspace, bookId);
    }

    // Oldest first, so the records land in the order the orders were placed.
    const page = await ctx.db
      .query("orders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .paginate({ numItems: ORDER_BATCH, cursor: args.cursor });
    for (const order of page.page) await copyOrder(ctx, book, order);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.ordersToRecordsForWorkspace,
        { workspaceId: workspace._id, cursor: page.continueCursor }
      );
    }
  },
});

async function copyOrder(
  ctx: MutationCtx,
  book: Doc<"recordBooks">,
  order: Doc<"orders">
) {
  const already = await ctx.db
    .query("records")
    .withIndex("by_workspace_reference", (q) =>
      q.eq("workspaceId", order.workspaceId).eq("reference", order.orderNumber)
    )
    .first();
  if (already) return;

  const delivery = deliveryText(order.delivery);
  const values = [
    { key: "items", value: itemsText(order.items) },
    ...(delivery ? [{ key: "delivery", value: delivery }] : []),
    ...(order.total !== undefined
      ? [{ key: "total", value: String(order.total) }]
      : []),
  ].filter((pair) => pair.value.trim());

  const person = {
    name: order.customer.name,
    phone: order.customer.phone,
    email: order.customer.email,
    company: order.customer.company,
  };

  await ctx.db.insert("records", {
    workspaceId: order.workspaceId,
    bookId: book._id,
    reference: order.orderNumber,
    agentId: order.agentId,
    conversationId: order.conversationId,
    contactId: order.contactId,
    person,
    values,
    stage: stageForStatus(order.status, book.stages),
    notes: order.notes,
    source: order.source,
    searchBlob: buildSearchBlob([
      order.orderNumber,
      person.name,
      person.phone,
      person.email,
      person.company,
      ...values.map((pair) => pair.value),
    ]),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
}

async function moveAgents(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  bookId: Id<"recordBooks">
) {
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  for (const agent of agents) {
    if (!agent.builtinTools.some((key) => RETIRED_TOOLS.has(key))) continue;
    const books = agent.recordBooks ?? [];
    await ctx.db.patch(agent._id, {
      builtinTools: agent.builtinTools.filter((key) => !RETIRED_TOOLS.has(key)),
      recordBooks: books.includes(bookId) ? books : [...books, bookId],
      updatedAt: Date.now(),
    });
  }
}

/**
 * Where each path an order alert could use lives on a filed record. Anything
 * not here — `contact.*`, `workspace.*` — is the same on both events.
 */
const ORDER_TO_RECORD_PATHS: Record<string, string> = {
  orderNumber: "record.reference",
  "customer.name": "record.person.name",
  "customer.phone": "record.person.phone",
  "customer.email": "record.person.email",
  "customer.company": "record.person.company",
  itemsSummary: "record.details.items",
  items: "record.details.items",
  total: "record.details.total",
  status: "record.stage",
  notes: "record.notes",
  "delivery.address": "record.details.delivery",
  "delivery.requiredDate": "record.details.delivery",
};

/** Rewrites each `{{a | b | "c"}}` alternative that names an order path. */
function rewritePlaceholders(text: string, currency: string): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (_, expression: string) => {
    const options = expression.split("|").map((raw) => {
      const option = raw.trim();
      if (/^".*"$|^'.*'$/.test(option)) return option;
      // A record carries no currency; the workspace's own is what an order
      // was priced in.
      if (option === "currency") return `"${currency}"`;
      return ORDER_TO_RECORD_PATHS[option] ?? option;
    });
    return `{{${options.join(" | ")}}}`;
  });
}

async function moveAlerts(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  bookId: Id<"recordBooks">
) {
  const rules = await ctx.db
    .query("notificationRules")
    .withIndex("by_workspace_event", (q) =>
      q.eq("workspaceId", workspace._id).eq("event", "order_created")
    )
    .collect();

  for (const rule of rules) {
    await ctx.db.patch(rule._id, {
      event: "record_filed",
      bookId,
      params: rule.params.map((pair) => ({
        key: pair.key,
        value: rewritePlaceholders(pair.value, workspace.currency),
      })),
      recipients: rule.recipients.map((recipient) =>
        rewritePlaceholders(recipient, workspace.currency)
      ),
      updatedAt: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Reply stats
//
//   npx convex run migrations:backfillReplyStats
//
// Fills agentStats and each team member's last reply from the messages already
// there. Only messages from before the run are counted, so replies arriving
// meanwhile, which count themselves, are not counted twice.
// ---------------------------------------------------------------------------

const STATS_MESSAGE_BATCH = 100;

export const backfillReplyStats = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });

    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillReplyStatsForWorkspace,
        { workspaceId: workspace._id, cursor: null }
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillReplyStats, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const backfillReplyStatsForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    startedAt: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const startedAt = args.startedAt ?? Date.now();
    if (args.cursor === null) {
      const stale = await ctx.db
        .query("agentStats")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);
    }

    const page = await ctx.db
      .query("messages")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", args.workspaceId).lt("_creationTime", startedAt)
      )
      .paginate({ numItems: STATS_MESSAGE_BATCH, cursor: args.cursor });

    type Delta = {
      replies: number;
      latencyTotalMs: number;
      latencyCount: number;
      last?: { text: string; at: number };
    };
    const agents = new Map<Id<"agents">, Delta>();
    const members = new Map<Id<"teamMembers">, { text: string; at: number }>();

    for (const message of page.page) {
      const text = message.text?.trim();
      if (message.sentByHuman) {
        if (message.teamMemberId && text) {
          members.set(message.teamMemberId, {
            text: text.slice(0, REPLY_PREVIEW_CHARS),
            at: message.createdAt,
          });
        }
        continue;
      }
      if (!message.agentId || message.role !== "assistant") continue;
      if (message.kind !== "text" && message.kind !== "rich") continue;

      const delta = agents.get(message.agentId) ?? {
        replies: 0,
        latencyTotalMs: 0,
        latencyCount: 0,
      };
      delta.replies += 1;
      if (typeof message.latencyMs === "number") {
        delta.latencyTotalMs += message.latencyMs;
        delta.latencyCount += 1;
      }
      if (message.kind === "text" && text) {
        delta.last = { text: text.slice(0, REPLY_PREVIEW_CHARS), at: message.createdAt };
      }
      agents.set(message.agentId, delta);
    }

    for (const [agentId, delta] of agents) {
      if (!(await ctx.db.get("agents", agentId))) continue;
      const stats = await ctx.db
        .query("agentStats")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .unique();
      const newer = (at?: number) => delta.last && delta.last.at >= (at ?? 0);
      if (!stats) {
        await ctx.db.insert("agentStats", {
          workspaceId: args.workspaceId,
          agentId,
          replies: delta.replies,
          latencyTotalMs: delta.latencyTotalMs,
          latencyCount: delta.latencyCount,
          lastReplyText: delta.last?.text,
          lastReplyAt: delta.last?.at,
        });
        continue;
      }
      await ctx.db.patch(stats._id, {
        replies: stats.replies + delta.replies,
        latencyTotalMs: stats.latencyTotalMs + delta.latencyTotalMs,
        latencyCount: stats.latencyCount + delta.latencyCount,
        ...(newer(stats.lastReplyAt)
          ? { lastReplyText: delta.last!.text, lastReplyAt: delta.last!.at }
          : {}),
      });
    }

    for (const [memberId, last] of members) {
      const member = await ctx.db.get("teamMembers", memberId);
      if (!member || last.at < (member.lastReplyAt ?? 0)) continue;
      await ctx.db.patch(memberId, { lastReplyText: last.text, lastReplyAt: last.at });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillReplyStatsForWorkspace,
        { workspaceId: args.workspaceId, startedAt, cursor: page.continueCursor }
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Daily message totals
//
//   npx convex run migrations:backfillDailyStats
//
// Fills dailyStats from the messages already there, with the same cut-off as
// backfillReplyStats so a message is counted once.
// ---------------------------------------------------------------------------

export const backfillDailyStats = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });
    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillDailyStatsForWorkspace,
        { workspaceId: workspace._id, cursor: null }
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillDailyStats, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const backfillDailyStatsForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    startedAt: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const startedAt = args.startedAt ?? Date.now();
    if (args.cursor === null) {
      const stale = await ctx.db
        .query("dailyStats")
        .withIndex("by_workspace_day", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);
    }

    const page = await ctx.db
      .query("messages")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", args.workspaceId).lt("_creationTime", startedAt)
      )
      .paginate({ numItems: STATS_MESSAGE_BATCH, cursor: args.cursor });

    const days = new Map<
      string,
      { messages: number; latencyTotalMs: number; latencyCount: number }
    >();
    for (const message of page.page) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      if (message.kind !== "text" && message.kind !== "rich") continue;
      const day = dayKey(message.createdAt);
      const delta = days.get(day) ?? { messages: 0, latencyTotalMs: 0, latencyCount: 0 };
      delta.messages += 1;
      if (typeof message.latencyMs === "number") {
        delta.latencyTotalMs += message.latencyMs;
        delta.latencyCount += 1;
      }
      days.set(day, delta);
    }

    for (const [day, delta] of days) {
      const row = await ctx.db
        .query("dailyStats")
        .withIndex("by_workspace_day", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("day", day)
        )
        .unique();
      if (!row) {
        await ctx.db.insert("dailyStats", { workspaceId: args.workspaceId, day, ...delta });
        continue;
      }
      await ctx.db.patch(row._id, {
        messages: row.messages + delta.messages,
        latencyTotalMs: row.latencyTotalMs + delta.latencyTotalMs,
        latencyCount: row.latencyCount + delta.latencyCount,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillDailyStatsForWorkspace,
        { workspaceId: args.workspaceId, startedAt, cursor: page.continueCursor }
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Daily usage rollup
//
//   npx convex run migrations:backfillUsageDaily
//
// Rebuilds usageDaily from usageEvents. The clear and the cut-off happen in
// the same mutation, so an event recorded meanwhile is counted once.
// ---------------------------------------------------------------------------

const USAGE_BATCH = 500;

export const backfillUsageDaily = internalMutation({
  args: {
    startedAt: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    let startedAt = args.startedAt;
    if (startedAt === undefined) {
      for (const row of await ctx.db.query("usageDaily").collect()) {
        await ctx.db.delete(row._id);
      }
      startedAt = Date.now();
    }

    const page = await ctx.db
      .query("usageEvents")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", startedAt))
      .paginate({ numItems: USAGE_BATCH, cursor: args.cursor ?? null });
    for (const event of page.page) await addToUsageDaily(ctx, event);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillUsageDaily, {
        startedAt,
        cursor: page.continueCursor,
      });
    }
    return { events: page.page.length, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Human agents' login emails
//
//   bunx convex run migrations:memberLoginEmails
//
// Gives each human agent's login the email on their roster entry, so it signs
// in with that as well as the username. An email that is not valid, or already
// belongs to another login, is left off.
// ---------------------------------------------------------------------------

const LOGIN_BATCH = 100;

export const memberLoginEmails = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("memberCredentials")
      .paginate({ numItems: LOGIN_BATCH, cursor: args.cursor ?? null });

    let filled = 0;
    const clashes: string[] = [];
    for (const login of page.page) {
      if (login.email) continue;
      const member = await ctx.db.get("teamMembers", login.memberId);
      const email = loginEmailOf(member?.email);
      if (!email) continue;
      if (await loginEmailTaken(ctx, email, login._id)) {
        clashes.push(login.username);
        continue;
      }
      await ctx.db.patch(login._id, { email });
      filled++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.memberLoginEmails, {
        cursor: page.continueCursor,
      });
    }
    return { filled, clashes, done: page.isDone };
  },
});
