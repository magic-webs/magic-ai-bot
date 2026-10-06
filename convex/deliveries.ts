import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { deliveryStatus } from "./schema";
import { linkWamids, setDelivery } from "./lib/delivery";
import { billingEventFor, refund, settle } from "./lib/charge";

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
        pricing: v.optional(
          v.object({
            billable: v.optional(v.boolean()),
            category: v.optional(v.string()),
            type: v.optional(v.string()),
          })
        ),
      })
    ),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await workspaceOf(ctx, args.channelKey);
    if (!workspaceId) return;

    const unmatched = [];
    for (const status of args.statuses) {
      const event = await billingEventFor(ctx, status.wamid);
      if (event && event.workspaceId === workspaceId) {
        if (status.status === "failed") await refund(ctx, event);
        else if (status.pricing) await settle(ctx, event, status.pricing);
      }
      const link = await linkFor(ctx, status.wamid);
      // A message can be billed before it is linked, or linked before it is
      // billed, so a receipt that found only one half waits for the other.
      if (!link || !event) unmatched.push(status);
      if (!link || link.workspaceId !== workspaceId) continue;
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

    const event = await billingEventFor(ctx, args.queueId);
    if (event && event.workspaceId === workspaceId) {
      if (args.wamid) await ctx.db.patch("billingEvents", event._id, { wamid: args.wamid });
      if (args.failed) await refund(ctx, event);
    }

    const link = await linkFor(ctx, args.queueId);
    if (link && link.workspaceId === workspaceId) {
      const message = await ctx.db.get("messages", link.messageId);
      if (message && args.wamid && !(await linkFor(ctx, args.wamid))) {
        await linkWamids(ctx, message, [args.wamid]);
      }
      if (message && args.failed) {
        await setDelivery(ctx, message, "failed", args.error ?? "WhatsApp did not accept the message.");
      }
    }

    const attempt = (args.attempt ?? 0) + 1;
    if ((!link || !event) && attempt < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(RETRY_MS, internal.deliveries.resolveQueued, {
        ...args,
        attempt,
      });
    }
  },
});
