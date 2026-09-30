/**
 * Charging one sent WhatsApp message: the ledger row, and the wallet debit.
 *
 * Its own file rather than a function in ./billing because that file is
 * imported by React for labels and formatting, and this one reaches the
 * wallet — and through it the scheduler and the generated API.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  effectiveRates,
  rateFor,
  type BillingSource,
  type MessageCategory,
} from "./billing";
import { debitWallet } from "./wallet";

/** Clamped to what the ledger shows, so one long reply is not a long row. */
const PREVIEW_MAX = 140;

/**
 * Charge one sent message to its workspace.
 *
 * Called only after the provider accepted the message: a send that failed is
 * not a message the account received, and must not be billed as one. With no
 * rate card anywhere the message is still recorded, at zero and marked
 * unrated, so the count is right and the gap is visible.
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
  }
): Promise<Id<"billingEvents">> {
  const { card } = await effectiveRates(ctx, args.workspaceId);
  let currency = card?.currency;
  if (!currency) {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    currency = workspace?.currency ?? "USD";
  }

  const amountMicros = card ? rateFor(card, args.category) : 0;
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
    amountMicros,
    rated: card !== null,
    createdAt: Date.now(),
  });

  await debitWallet(ctx, {
    workspaceId: args.workspaceId,
    currency,
    amountMicros,
  });
  return eventId;
}
