import { v } from "convex/values";
import { query } from "./_generated/server";
import { orderStatus } from "./schema";
import { requireWorkspace } from "./lib/auth";
import { orderRecords, recordAsOrder } from "./lib/ordersBook";

/**
 * The workspace's orders, in the shape they always had.
 *
 * Orders now live in the workspace's Orders record book — see
 * convex/lib/ordersBook.ts — and are filed with `file_order` like any other
 * record. This stays for the readers written against the old table: the
 * mobile app's Orders tab and list_orders over MCP. Each record comes back
 * with its reference as the order number and its stage as the old status.
 */
export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(orderStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return [];

    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));
    // A status filter is applied after the read, because a book's stages are
    // the workspace's own words and only map onto a status here.
    const rows = await orderRecords(
      ctx,
      args.workspaceId,
      args.status ? 300 : limit
    );
    const orders = rows
      .map((record) => recordAsOrder(record, workspace.currency))
      .sort((a, b) => b.createdAt - a.createdAt);
    return (args.status
      ? orders.filter((order) => order.status === args.status)
      : orders
    ).slice(0, limit);
  },
});
