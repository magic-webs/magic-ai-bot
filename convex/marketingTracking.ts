import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { noteClick } from "./lib/marketingStats";

async function sendFor(ctx: QueryCtx, code: string) {
  return await ctx.db
    .query("marketingSends")
    .withIndex("by_linkCode", (q) => q.eq("linkCode", code))
    .unique();
}

export const target = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => (await sendFor(ctx, args.code))?.linkTarget ?? null,
});

export const click = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const send = await sendFor(ctx, args.code);
    if (!send?.linkTarget) return null;
    await noteClick(ctx, send._id, Date.now());
    return send.linkTarget;
  },
});
