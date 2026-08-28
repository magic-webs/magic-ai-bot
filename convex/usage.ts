import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireAdmin, requireWorkspace } from "./lib/auth";
import { costNanoUsd, MODEL_PRICES } from "./lib/pricing";

const DAY_MS = 24 * 60 * 60 * 1000;
// The dashboard reads rows, not a rollup, so one read is capped.
const SCAN_CAP = 20_000;

const sourceValidator = v.union(
  v.literal("chat"),
  v.literal("retrieval"),
  v.literal("ingest"),
  v.literal("draft_agent"),
  v.literal("draft_tool"),
  v.literal("draft_catalogue")
);

/**
 * Record one model call.
 *
 * Internal: only the actions that made the call can report it, and they pass
 * the token counts the provider returned rather than any estimate. Pricing is
 * applied here so every row is costed by the same table.
 */
export const record = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    conversationId: v.optional(v.id("conversations")),
    source: sourceValidator,
    channelType: v.optional(v.union(v.literal("whatsapp"), v.literal("web"))),
    model: v.string(),
    kind: v.union(v.literal("chat"), v.literal("embedding")),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const inputTokens = Math.max(0, Math.round(args.inputTokens || 0));
    const outputTokens = Math.max(0, Math.round(args.outputTokens || 0));
    // A call that reported nothing is not worth a row.
    if (inputTokens === 0 && outputTokens === 0) return null;

    const { costNanoUsd: cost, priced } = costNanoUsd(
      args.model,
      inputTokens,
      outputTokens
    );

    return await ctx.db.insert("usageEvents", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      conversationId: args.conversationId,
      source: args.source,
      channelType: args.channelType,
      model: args.model,
      kind: args.kind,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costNanoUsd: cost,
      priced,
      createdAt: Date.now(),
    });
  },
});

type Totals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costNanoUsd: number;
};

const emptyTotals = (): Totals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costNanoUsd: 0,
});

function add(into: Totals, row: Totals | Doc) {
  into.calls += 1;
  into.inputTokens += row.inputTokens;
  into.outputTokens += row.outputTokens;
  into.totalTokens += row.totalTokens;
  into.costNanoUsd += row.costNanoUsd;
}

type Doc = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costNanoUsd: number;
};

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Every dimension the admin usage tab plots, in one read.
 *
 * `now` is an argument for the same reason analytics.dashboard takes one:
 * a Convex query is not re-run because time passed, so a wall-clock read
 * inside it goes stale and poisons the cache key.
 */
export const adminSummary = query({
  args: { days: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const days = Math.max(1, Math.min(Math.floor(args.days), 90));
    const todayStart = Date.UTC(
      new Date(args.now).getUTCFullYear(),
      new Date(args.now).getUTCMonth(),
      new Date(args.now).getUTCDate()
    );
    const windowStart = todayStart - (days - 1) * DAY_MS;
    const previousStart = windowStart - days * DAY_MS;

    // Both windows in one scan, so the comparison cannot straddle two reads.
    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", previousStart))
      .take(SCAN_CAP);

    const workspaces = await ctx.db.query("workspaces").collect();
    const workspaceName = new Map(workspaces.map((w) => [w._id, w.name]));

    const totals = emptyTotals();
    const previous = emptyTotals();
    const daily = new Map<string, Totals & { date: string }>();
    for (let i = 0; i < days; i++) {
      const key = dayKey(windowStart + i * DAY_MS);
      daily.set(key, { date: key, ...emptyTotals() });
    }

    const byWorkspace = new Map<string, Totals & { name: string }>();
    const byModel = new Map<string, Totals & { kind: string; priced: boolean }>();
    const bySource = new Map<string, Totals>();
    const byChannel = new Map<string, Totals>();
    const unpriced = new Set<string>();

    for (const row of rows) {
      if (row.createdAt < windowStart) {
        add(previous, row);
        continue;
      }
      add(totals, row);
      if (!row.priced) unpriced.add(row.model);

      const bucket = daily.get(dayKey(row.createdAt));
      if (bucket) add(bucket, row);

      const wsKey = row.workspaceId as string;
      if (!byWorkspace.has(wsKey)) {
        byWorkspace.set(wsKey, {
          name: workspaceName.get(row.workspaceId) ?? "Deleted workspace",
          ...emptyTotals(),
        });
      }
      add(byWorkspace.get(wsKey)!, row);

      if (!byModel.has(row.model)) {
        byModel.set(row.model, {
          kind: row.kind,
          priced: row.priced,
          ...emptyTotals(),
        });
      }
      add(byModel.get(row.model)!, row);

      if (!bySource.has(row.source)) bySource.set(row.source, emptyTotals());
      add(bySource.get(row.source)!, row);

      const channel = row.channelType ?? "internal";
      if (!byChannel.has(channel)) byChannel.set(channel, emptyTotals());
      add(byChannel.get(channel)!, row);
    }

    const rank = <T extends Totals>(map: Map<string, T>) =>
      [...map.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.costNanoUsd - a.costNanoUsd || b.totalTokens - a.totalTokens);

    return {
      windowDays: days,
      // True when the cap was hit, so the page can say the figures are partial
      // instead of presenting a floor as a total.
      truncated: rows.length === SCAN_CAP,
      totals,
      previous,
      daily: [...daily.values()],
      byWorkspace: rank(byWorkspace),
      byModel: rank(byModel),
      bySource: rank(bySource),
      byChannel: rank(byChannel),
      unpricedModels: [...unpriced],
      pricedModels: Object.keys(MODEL_PRICES).length,
    };
  },
});

/** The same shape, scoped to one workspace, for a company's own view. */
export const workspaceSummary = query({
  args: {
    workspaceId: v.id("workspaces"),
    days: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const days = Math.max(1, Math.min(Math.floor(args.days), 90));
    const todayStart = Date.UTC(
      new Date(args.now).getUTCFullYear(),
      new Date(args.now).getUTCMonth(),
      new Date(args.now).getUTCDate()
    );
    const windowStart = todayStart - (days - 1) * DAY_MS;

    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("createdAt", windowStart)
      )
      .take(SCAN_CAP);

    const totals = emptyTotals();
    const bySource = new Map<string, Totals>();
    for (const row of rows) {
      add(totals, row);
      if (!bySource.has(row.source)) bySource.set(row.source, emptyTotals());
      add(bySource.get(row.source)!, row);
    }

    return {
      windowDays: days,
      truncated: rows.length === SCAN_CAP,
      totals,
      bySource: [...bySource.entries()].map(([key, value]) => ({ key, ...value })),
    };
  },
});
