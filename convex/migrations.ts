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
import {
  deliveryText,
  ensureOrdersBook,
  itemsText,
  stageForStatus,
} from "./lib/ordersBook";

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
