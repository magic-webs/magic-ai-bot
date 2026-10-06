/**
 * Charging one sent WhatsApp message: the ledger row, and the wallet debit.
 *
 * Its own file rather than a function in ./billing because that file is
 * imported by React for labels and formatting, and this one reaches the
 * wallet — and through it the scheduler and the generated API.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  metaCategory,
  quote,
  type BillingSource,
  type MessageCategory,
} from "./billing";
import { marketOf } from "./markets";
import { debitWallet, refundWallet } from "./wallet";

/** Clamped to what the ledger shows, so one long reply is not a long row. */
const PREVIEW_MAX = 140;

/**
 * Charge one sent message to its workspace, at the estimate.
 *
 * Called only after the provider accepted the message. The estimate assumes
 * Meta bills it; a message with a provider id is held as pending until the
 * status webhook says what Meta actually charged (`settle`), and one without
 * can never be matched, so it is settled at the estimate there and then.
 *
 * The amount comes off the wallet in the same transaction, so the balance and
 * the ledger cannot disagree about a message.
 */
export async function charge(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    conversationId?: Id<"conversations">;
    channelId?: Id<"channels">;
    to: string;
    category: MessageCategory;
    source: BillingSource;
    preview?: string;
    templateName?: string;
    wamid?: string;
  }
): Promise<Id<"billingEvents">> {
  const now = Date.now();
  const priced = await quote(ctx, {
    workspaceId: args.workspaceId,
    market: marketOf(args.to),
    category: args.category,
    at: now,
  });
  let currency = priced.currency;
  if (!currency) {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    currency = workspace?.currency ?? "INR";
  }

  const preview = args.preview?.replace(/\s+/g, " ").trim();
  const eventId = await ctx.db.insert("billingEvents", {
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    channelId: args.channelId,
    to: args.to,
    category: args.category,
    source: args.source,
    preview: preview ? preview.slice(0, PREVIEW_MAX) : undefined,
    templateName: args.templateName,
    currency,
    amountMicros: priced.amountMicros,
    rated: priced.rated,
    market: priced.market,
    metaCostMicros: priced.metaCostMicros,
    markupMicros: priced.markupMicros,
    wamid: args.wamid,
    status: args.wamid ? "pending" : "settled",
    createdAt: now,
  });

  await debitWallet(ctx, {
    workspaceId: args.workspaceId,
    currency,
    amountMicros: priced.amountMicros,
  });
  return eventId;
}

export async function billingEventFor(
  ctx: MutationCtx,
  wamid: string
): Promise<Doc<"billingEvents"> | null> {
  return await ctx.db
    .query("billingEvents")
    .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
    .first();
}

/** Move the wallet by what a repriced message changed by. */
async function rebill(
  ctx: MutationCtx,
  event: Doc<"billingEvents">,
  currency: string,
  amountMicros: number
) {
  if (currency === event.currency) {
    const delta = amountMicros - event.amountMicros;
    if (delta > 0) {
      await debitWallet(ctx, { workspaceId: event.workspaceId, currency, amountMicros: delta });
    } else if (delta < 0) {
      await refundWallet(ctx, { workspaceId: event.workspaceId, currency, amountMicros: -delta });
    }
    return;
  }
  await refundWallet(ctx, {
    workspaceId: event.workspaceId,
    currency: event.currency,
    amountMicros: event.amountMicros,
  });
  await debitWallet(ctx, { workspaceId: event.workspaceId, currency, amountMicros });
}

/**
 * Reprice a held message by Meta's `pricing` on its status webhook: the
 * category Meta billed, at the rates in force when it was sent, or only the
 * free-message fee when Meta did not bill it at all.
 */
export async function settle(
  ctx: MutationCtx,
  event: Doc<"billingEvents">,
  pricing: { billable?: boolean; category?: string; type?: string }
): Promise<void> {
  if (event.status !== "pending") return;
  const meta = metaCategory(pricing.category);
  const category = meta?.category ?? event.category;
  const priced = await quote(ctx, {
    workspaceId: event.workspaceId,
    market: event.market ?? marketOf(event.to),
    category,
    billable: pricing.billable !== false,
    international: meta?.international,
    at: event.createdAt,
  });
  const currency = priced.currency ?? event.currency;
  await rebill(ctx, event, currency, priced.amountMicros);
  await ctx.db.patch("billingEvents", event._id, {
    category,
    currency,
    amountMicros: priced.amountMicros,
    rated: priced.rated,
    metaCostMicros: priced.metaCostMicros,
    markupMicros: priced.markupMicros,
    status: "settled",
    billable: pricing.billable !== false,
    pricingCategory: pricing.category,
    pricingType: pricing.type,
    settledAt: Date.now(),
  });
}

/** Meta does not charge for a message that was never delivered. */
export async function refund(
  ctx: MutationCtx,
  event: Doc<"billingEvents">
): Promise<void> {
  if (event.status === "refunded" || event.status === undefined) return;
  await refundWallet(ctx, {
    workspaceId: event.workspaceId,
    currency: event.currency,
    amountMicros: event.amountMicros,
  });
  await ctx.db.patch("billingEvents", event._id, {
    amountMicros: 0,
    metaCostMicros: 0,
    markupMicros: 0,
    status: "refunded",
    billable: false,
    settledAt: Date.now(),
  });
}
