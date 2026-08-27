import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspace } from "./lib/auth";

// Messages are the highest-volume table; cap what one dashboard read scans.
const MESSAGE_SCAN_CAP = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Everything the workspace dashboard plots, in one read.
 *
 * `now` is an argument rather than a `Date.now()` call: Convex queries are not
 * re-run just because time passed, so a wall-clock read inside one would go
 * stale and would also poison the query cache. The client passes a value
 * rounded to the hour, which keeps the cache key stable.
 */
export const dashboard = query({
  args: {
    workspaceId: v.id("workspaces"),
    days: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const days = Math.max(1, Math.min(Math.floor(args.days), 90));
    // Bucket boundaries are UTC midnights; `now` decides which day is "today".
    const todayStart = Date.UTC(
      new Date(args.now).getUTCFullYear(),
      new Date(args.now).getUTCMonth(),
      new Date(args.now).getUTCDate()
    );
    const windowStart = todayStart - (days - 1) * DAY_MS;
    const previousStart = windowStart - days * DAY_MS;

    const [conversations, orders, tools, messages] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db
        .query("tools")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(MESSAGE_SCAN_CAP),
    ]);

    // --- daily series -----------------------------------------------------
    const buckets = new Map<
      string,
      {
        date: string;
        conversations: number;
        orders: number;
        messages: number;
        /** Mean assistant reply time that day, in seconds. Null on quiet days. */
        replySeconds: number | null;
      }
    >();
    // Latencies are collected per day first, then averaged.
    const latencyByDay = new Map<string, number[]>();
    for (let i = 0; i < days; i++) {
      const key = dayKey(windowStart + i * DAY_MS);
      buckets.set(key, {
        date: key,
        conversations: 0,
        orders: 0,
        messages: 0,
        replySeconds: null,
      });
      latencyByDay.set(key, []);
    }

    const bump = (
      timestamp: number,
      field: "conversations" | "orders" | "messages"
    ) => {
      const bucket = buckets.get(dayKey(timestamp));
      if (bucket) bucket[field] += 1;
    };

    for (const row of conversations) bump(row.createdAt, "conversations");
    for (const row of orders) bump(row.createdAt, "orders");
    for (const row of messages) {
      bump(row.createdAt, "messages");
      if (typeof row.latencyMs === "number") {
        latencyByDay.get(dayKey(row.createdAt))?.push(row.latencyMs);
      }
    }

    for (const [key, values] of latencyByDay) {
      const bucket = buckets.get(key);
      if (!bucket || values.length === 0) continue;
      const total = values.reduce((sum, value) => sum + value, 0);
      bucket.replySeconds =
        Math.round((total / values.length / 1000) * 10) / 10;
    }

    // --- window vs the window before it, for the stat deltas --------------
    const inWindow = (timestamp: number) => timestamp >= windowStart;
    const inPrevious = (timestamp: number) =>
      timestamp >= previousStart && timestamp < windowStart;

    const count = <T extends { createdAt: number }>(
      rows: T[],
      predicate: (timestamp: number) => boolean
    ) => rows.filter((row) => predicate(row.createdAt)).length;

    // Only assistant turns carry a latency, and only inside the window.
    const latencies = messages
      .filter((m) => inWindow(m.createdAt) && typeof m.latencyMs === "number")
      .map((m) => m.latencyMs as number);
    const previousLatencies = messages
      .filter((m) => inPrevious(m.createdAt) && typeof m.latencyMs === "number")
      .map((m) => m.latencyMs as number);
    const mean = (values: number[]) =>
      values.length
        ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
        : null;

    // --- breakdowns -------------------------------------------------------
    const statusOrder = [
      "new",
      "quoted",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
    ] as const;
    const statusCounts = new Map<string, number>(
      statusOrder.map((status) => [status, 0])
    );
    for (const order of orders) {
      statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
    }

    let whatsapp = 0;
    let web = 0;
    for (const conversation of conversations) {
      if (conversation.channelType === "whatsapp") whatsapp += 1;
      else web += 1;
    }

    return {
      windowDays: days,
      // The chart is honest about the cap: if we hit it, the earliest days of
      // the message series may be short.
      messagesTruncated: messages.length === MESSAGE_SCAN_CAP,
      daily: [...buckets.values()],
      totals: {
        conversations: count(conversations, inWindow),
        orders: count(orders, inWindow),
        messages: messages.filter((m) => inWindow(m.createdAt)).length,
        escalated: conversations.filter(
          (c) => c.status === "escalated" && inWindow(c.createdAt)
        ).length,
        avgLatencyMs: mean(latencies),
      },
      previous: {
        conversations: count(conversations, inPrevious),
        orders: count(orders, inPrevious),
        messages: messages.filter((m) => inPrevious(m.createdAt)).length,
        escalated: conversations.filter(
          (c) => c.status === "escalated" && inPrevious(c.createdAt)
        ).length,
        avgLatencyMs: mean(previousLatencies),
      },
      ordersByStatus: statusOrder.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      channels: { whatsapp, web },
      toolUsage: tools
        .filter((tool) => tool.callCount > 0)
        .sort((a, b) => b.callCount - a.callCount)
        .slice(0, 6)
        .map((tool) => ({ name: tool.name, calls: tool.callCount })),
    };
  },
});
