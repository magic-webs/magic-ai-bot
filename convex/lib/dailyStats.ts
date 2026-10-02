import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function countMessage(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  at: number,
  latencyMs?: number
) {
  const day = dayKey(at);
  const timed = typeof latencyMs === "number";
  const row = await ctx.db
    .query("dailyStats")
    .withIndex("by_workspace_day", (q) =>
      q.eq("workspaceId", workspaceId).eq("day", day)
    )
    .unique();
  if (!row) {
    await ctx.db.insert("dailyStats", {
      workspaceId,
      day,
      messages: 1,
      latencyTotalMs: timed ? latencyMs : 0,
      latencyCount: timed ? 1 : 0,
    });
    return;
  }
  await ctx.db.patch(row._id, {
    messages: row.messages + 1,
    ...(timed
      ? {
          latencyTotalMs: row.latencyTotalMs + latencyMs,
          latencyCount: row.latencyCount + 1,
        }
      : {}),
  });
}
