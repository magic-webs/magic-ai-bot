import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { deliveryStatus } from "./schema";
import { linkWamids, setDelivery } from "./lib/delivery";

/** After the provider accepted (or refused) a reply that was already in the thread. */
export const markSent = internalMutation({
  args: {
    messageId: v.id("messages"),
    wamids: v.array(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message) return;
    await linkWamids(ctx, message, args.wamids);
    if (args.error) await setDelivery(ctx, message, "failed", args.error);
    else await setDelivery(ctx, message, "sent");
  },
});

export const applyStatuses = internalMutation({
  args: {
    channelKey: v.string(),
    statuses: v.array(
      v.object({
        wamid: v.string(),
        status: deliveryStatus,
        error: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_channelKey", (q) => q.eq("channelKey", args.channelKey))
      .unique();
    if (!channel) return;

    for (const status of args.statuses) {
      const link = await ctx.db
        .query("whatsappMessageIds")
        .withIndex("by_wamid", (q) => q.eq("wamid", status.wamid))
        .first();
      if (!link || link.workspaceId !== channel.workspaceId) continue;
      const message = await ctx.db.get("messages", link.messageId);
      if (!message) continue;
      await setDelivery(ctx, message, status.status, status.error);
    }
  },
});
