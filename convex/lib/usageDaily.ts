import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { dayKey } from "./dailyStats";

type UsageKey = Pick<
  Doc<"usageEvents">,
  "workspaceId" | "model" | "kind" | "source" | "channelType" | "priced" | "createdAt"
>;
type UsageAmounts = Pick<
  Doc<"usageDaily">,
  "calls" | "inputTokens" | "outputTokens" | "totalTokens" | "costNanoUsd"
>;

/** Adds one usage event to its day's bucket, or takes it away with `sign: -1`. */
export async function addToUsageDaily(
  ctx: MutationCtx,
  event: UsageKey & Omit<UsageAmounts, "calls">,
  sign: 1 | -1 = 1
) {
  const day = dayKey(event.createdAt);
  const rows = await ctx.db
    .query("usageDaily")
    .withIndex("by_workspace_day", (q) =>
      q.eq("workspaceId", event.workspaceId).eq("day", day)
    )
    .collect();
  const row = rows.find(
    (r) =>
      r.model === event.model &&
      r.source === event.source &&
      r.channelType === event.channelType &&
      r.priced === event.priced
  );
  const amounts: UsageAmounts = {
    calls: sign,
    inputTokens: sign * event.inputTokens,
    outputTokens: sign * event.outputTokens,
    totalTokens: sign * event.totalTokens,
    costNanoUsd: sign * event.costNanoUsd,
  };

  if (!row) {
    if (sign > 0) {
      await ctx.db.insert("usageDaily", {
        day,
        workspaceId: event.workspaceId,
        model: event.model,
        kind: event.kind,
        source: event.source,
        channelType: event.channelType,
        priced: event.priced,
        ...amounts,
      });
    }
    return;
  }
  if (row.calls + amounts.calls <= 0) {
    await ctx.db.delete(row._id);
    return;
  }
  await ctx.db.patch(row._id, {
    calls: row.calls + amounts.calls,
    inputTokens: row.inputTokens + amounts.inputTokens,
    outputTokens: row.outputTokens + amounts.outputTokens,
    totalTokens: row.totalTokens + amounts.totalTokens,
    costNanoUsd: row.costNanoUsd + amounts.costNanoUsd,
  });
}
