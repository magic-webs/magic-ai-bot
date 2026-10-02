import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const REPLY_PREVIEW_CHARS = 280;

export async function recordAgentReply(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  agentId: Id<"agents"> | undefined,
  reply: { at: number; text?: string; latencyMs?: number }
) {
  if (!agentId) return;
  const text = reply.text?.trim();
  const latency =
    typeof reply.latencyMs === "number"
      ? { latencyTotalMs: reply.latencyMs, latencyCount: 1 }
      : { latencyTotalMs: 0, latencyCount: 0 };
  const last = text
    ? { lastReplyText: text.slice(0, REPLY_PREVIEW_CHARS), lastReplyAt: reply.at }
    : {};

  const stats = await ctx.db
    .query("agentStats")
    .withIndex("by_agent", (q) => q.eq("agentId", agentId))
    .unique();
  if (!stats) {
    await ctx.db.insert("agentStats", {
      workspaceId,
      agentId,
      replies: 1,
      ...latency,
      ...last,
    });
    return;
  }
  await ctx.db.patch(stats._id, {
    replies: stats.replies + 1,
    latencyTotalMs: stats.latencyTotalMs + latency.latencyTotalMs,
    latencyCount: stats.latencyCount + latency.latencyCount,
    ...last,
  });
}
