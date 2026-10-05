import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Delivery } from "./delivery";

// Receipts for one send land within seconds of each other, so the counters are
// spread over shards to keep them from contending on a single document.
const SHARDS = 8;
const REPLY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const OPT_OUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type MarketingCounts = {
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  optedOut: number;
};

export const EMPTY_COUNTS: MarketingCounts = {
  sent: 0,
  failed: 0,
  delivered: 0,
  read: 0,
  replied: 0,
  clicked: 0,
  optedOut: 0,
};

export async function bumpStats(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  key: string,
  delta: Partial<MarketingCounts>
) {
  const shard = Math.floor(Math.random() * SHARDS);
  const row = await ctx.db
    .query("marketingStats")
    .withIndex("by_key_and_shard", (q) => q.eq("key", key).eq("shard", shard))
    .unique();
  if (!row) {
    await ctx.db.insert("marketingStats", {
      workspaceId,
      key,
      shard,
      ...EMPTY_COUNTS,
      ...delta,
    });
    return;
  }
  const patch: Partial<MarketingCounts> = {};
  for (const [field, value] of Object.entries(delta) as Array<[keyof MarketingCounts, number]>) {
    patch[field] = row[field] + value;
  }
  await ctx.db.patch("marketingStats", row._id, patch);
}

export async function statsFor(ctx: QueryCtx, key: string): Promise<MarketingCounts> {
  const rows = await ctx.db
    .query("marketingStats")
    .withIndex("by_key_and_shard", (q) => q.eq("key", key))
    .take(SHARDS);
  const total = { ...EMPTY_COUNTS };
  for (const row of rows) {
    for (const field of Object.keys(total) as Array<keyof MarketingCounts>) {
      total[field] += row[field];
    }
  }
  return total;
}

export function eventKey(eventId: Id<"marketingEvents">) {
  return `event:${eventId}`;
}

export async function noteSendDelivery(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  delivery: Delivery,
  at: number,
  error?: string
) {
  const send = await ctx.db
    .query("marketingSends")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .first();
  if (!send || send.status !== "sent") return;

  const patch: Partial<Doc<"marketingSends">> = { delivery };
  const delta: Partial<MarketingCounts> = {};
  if (delivery === "failed") {
    delta.failed = 1;
    delta.sent = -1;
    patch.error = error?.slice(0, 300);
  }
  if ((delivery === "delivered" || delivery === "read") && !send.deliveredAt) {
    patch.deliveredAt = at;
    delta.delivered = 1;
  }
  if (delivery === "read" && !send.readAt) {
    patch.readAt = at;
    delta.read = 1;
  }
  await ctx.db.patch("marketingSends", send._id, patch);
  if (Object.keys(delta).length > 0) {
    await bumpStats(ctx, send.workspaceId, send.key, delta);
  }
}

async function latestSend(ctx: MutationCtx, contactId: Id<"contacts">, since: number) {
  return await ctx.db
    .query("marketingSends")
    .withIndex("by_contactId_and_createdAt", (q) =>
      q.eq("contactId", contactId).gte("createdAt", since)
    )
    .order("desc")
    .filter((q) => q.eq(q.field("status"), "sent"))
    .first();
}

export async function noteReply(ctx: MutationCtx, contactId: Id<"contacts">, at: number) {
  const send = await latestSend(ctx, contactId, at - REPLY_WINDOW_MS);
  if (!send || send.repliedAt) return;
  const delta: Partial<MarketingCounts> = { replied: 1 };
  const patch: Partial<Doc<"marketingSends">> = { repliedAt: at };
  if (!send.readAt) {
    patch.readAt = at;
    delta.read = 1;
  }
  if (!send.deliveredAt) {
    patch.deliveredAt = at;
    delta.delivered = 1;
  }
  await ctx.db.patch("marketingSends", send._id, patch);
  await bumpStats(ctx, send.workspaceId, send.key, delta);
}

export async function noteOptOut(ctx: MutationCtx, contactId: Id<"contacts">, at: number) {
  const send = await latestSend(ctx, contactId, at - OPT_OUT_WINDOW_MS);
  if (!send || send.optedOutAt) return;
  await ctx.db.patch("marketingSends", send._id, { optedOutAt: at });
  await bumpStats(ctx, send.workspaceId, send.key, { optedOut: 1 });
}

export async function noteClick(ctx: MutationCtx, sendId: Id<"marketingSends">, at: number) {
  const send = await ctx.db.get("marketingSends", sendId);
  if (!send || send.clickedAt) return send;
  await ctx.db.patch("marketingSends", send._id, { clickedAt: at });
  await bumpStats(ctx, send.workspaceId, send.key, { clicked: 1 });
  return send;
}

export async function sentRecently(
  ctx: QueryCtx,
  contactId: Id<"contacts">,
  since: number
): Promise<number> {
  const rows = await ctx.db
    .query("marketingSends")
    .withIndex("by_contactId_and_createdAt", (q) =>
      q.eq("contactId", contactId).gte("createdAt", since)
    )
    .take(50);
  return rows.filter((row) => row.status === "sent" && !row.key.startsWith("birthday:"))
    .length;
}
