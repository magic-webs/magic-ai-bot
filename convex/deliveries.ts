import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { deliveryStatus } from "./schema";
import { linkWamids, setDelivery } from "./lib/delivery";

// Receipts and the queue report race each other, so one that finds no message
// yet is tried again a few times before it is dropped.
const RETRY_MS = 4_000;
const MAX_ATTEMPTS = 4;

async function workspaceOf(ctx: MutationCtx, channelKey: string) {
  const channel = await ctx.db
    .query("channels")
    .withIndex("by_channelKey", (q) => q.eq("channelKey", channelKey))
    .unique();
  return channel?.workspaceId ?? null;
}

async function linkFor(ctx: MutationCtx, id: string) {
  return await ctx.db
    .query("whatsappMessageIds")
    .withIndex("by_wamid", (q) => q.eq("wamid", id))
    .first();
}

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
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await workspaceOf(ctx, args.channelKey);
    if (!workspaceId) return;

    const unmatched = [];
    for (const status of args.statuses) {
      const link = await linkFor(ctx, status.wamid);
      if (!link) {
        unmatched.push(status);
        continue;
      }
      if (link.workspaceId !== workspaceId) continue;
      const message = await ctx.db.get("messages", link.messageId);
      if (message) await setDelivery(ctx, message, status.status, status.error);
    }

    const attempt = (args.attempt ?? 0) + 1;
    if (unmatched.length > 0 && attempt < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(RETRY_MS, internal.deliveries.applyStatuses, {
        channelKey: args.channelKey,
        statuses: unmatched,
        attempt,
      });
    }
  },
});

/** Swaps a queued send's `queue_id` for the `wamid` Meta's receipts will carry. */
export const resolveQueued = internalMutation({
  args: {
    channelKey: v.string(),
    queueId: v.string(),
    wamid: v.optional(v.string()),
    failed: v.boolean(),
    error: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.wamid && !args.failed) return;
    const workspaceId = await workspaceOf(ctx, args.channelKey);
    if (!workspaceId) return;

    const link = await linkFor(ctx, args.queueId);
    if (!link) {
      const attempt = (args.attempt ?? 0) + 1;
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(RETRY_MS, internal.deliveries.resolveQueued, {
          ...args,
          attempt,
        });
      }
      return;
    }
    if (link.workspaceId !== workspaceId) return;

    const message = await ctx.db.get("messages", link.messageId);
    if (!message) return;
    if (args.wamid && !(await linkFor(ctx, args.wamid))) {
      await linkWamids(ctx, message, [args.wamid]);
    }
    if (args.failed) {
      await setDelivery(ctx, message, "failed", args.error ?? "WhatsApp did not accept the message.");
    }
  },
});
