// What Razorpay tells us, applied: subscriptions moving between states,
// payments settling, mandates confirming.
//
// Two ways in, one set of transitions. Checkout's handler hands the browser a
// payment the moment it succeeds, and convex/razorpay.ts fetches it and
// syncs it here so the page updates at once; the webhook (convex/http.ts)
// reports the same thing a few seconds later, and everything after the first
// checkout — renewals, failed retries, a mandate the bank confirms a day
// later — only ever arrives that way. Each transition is therefore written to
// be applied twice, in either order, with the second a no-op.

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { accountFor, ensureAccount } from "./lib/account";
import { formatMoney } from "./lib/billing";
import { PLATFORM_LOCALE, fromPaise, roundToPaise } from "./lib/plans";
import { creditWallet } from "./lib/wallet";

export const subscriptionEntity = v.object({
  razorpaySubscriptionId: v.string(),
  status: v.string(),
  currentStart: v.optional(v.number()),
  currentEnd: v.optional(v.number()),
  chargeAt: v.optional(v.number()),
  startAt: v.optional(v.number()),
  paidCount: v.optional(v.number()),
  shortUrl: v.optional(v.string()),
});

export const paymentEntity = v.object({
  razorpayPaymentId: v.string(),
  status: v.string(),
  amountPaise: v.number(),
  currency: v.string(),
  orderId: v.optional(v.string()),
  invoiceId: v.optional(v.string()),
  method: v.optional(v.string()),
  customerId: v.optional(v.string()),
  tokenId: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const tokenEntity = v.object({
  tokenId: v.string(),
  status: v.optional(v.string()),
  failureReason: v.optional(v.string()),
});

type SubscriptionEntity = typeof subscriptionEntity.type;
type PaymentEntity = typeof paymentEntity.type;
type TokenEntity = typeof tokenEntity.type;

/** Statuses a subscription is being charged in. */
const LIVE = new Set(["authenticated", "active"]);
/** Statuses it never leaves. */
const ENDED = new Set(["cancelled", "completed", "expired"]);
/** Kept long enough to refuse Razorpay's retries, which stop after a day. */
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

async function applySubscription(
  ctx: MutationCtx,
  entity: SubscriptionEntity
): Promise<Doc<"billingSubscriptions"> | null> {
  const subscription = await ctx.db
    .query("billingSubscriptions")
    .withIndex("by_razorpay_id", (q) =>
      q.eq("razorpaySubscriptionId", entity.razorpaySubscriptionId)
    )
    .unique();
  // Not one of ours: the same Razorpay account may bill for other things.
  if (!subscription) return null;

  const now = Date.now();
  const previous = subscription.status;
  // Razorpay sends nulls for periods that have not started; those must not
  // wipe out what an earlier event told us.
  await ctx.db.patch("billingSubscriptions", subscription._id, {
    status: entity.status,
    currentStart: entity.currentStart ?? subscription.currentStart,
    currentEnd: entity.currentEnd ?? subscription.currentEnd,
    chargeAt: entity.chargeAt ?? subscription.chargeAt,
    startAt: entity.startAt ?? subscription.startAt,
    paidCount: entity.paidCount ?? subscription.paidCount,
    shortUrl: entity.shortUrl ?? subscription.shortUrl,
    updatedAt: now,
  });

  const account = await accountFor(ctx, subscription.workspaceId);
  if (!account) return subscription;

  // Authorised: this becomes the subscription the account is on. Either it
  // is the replacement the company just checked out, or there is nothing
  // live for it to displace — an old subscription reviving must not take
  // over from a newer one.
  if (LIVE.has(entity.status) && account.subscriptionId !== subscription._id) {
    const isPending = account.pendingSubscriptionId === subscription._id;
    const current = account.subscriptionId
      ? await ctx.db.get("billingSubscriptions", account.subscriptionId)
      : null;
    if (isPending || !current || !LIVE.has(current.status)) {
      await ctx.db.patch("billingAccounts", account._id, {
        subscriptionId: subscription._id,
        pendingSubscriptionId: isPending ? undefined : account.pendingSubscriptionId,
        planId: subscription.planId,
        extraAgents: subscription.extraAgents,
        mode: "razorpay",
        updatedAt: now,
      });
      // The one it replaces stops now. Its period is already paid for, and
      // the replacement starts charging where that period ends, so nothing
      // is charged twice and nothing is refunded.
      if (current && !ENDED.has(current.status)) {
        await ctx.scheduler.runAfter(0, internal.razorpay.cancelRemote, {
          razorpaySubscriptionId: current.razorpaySubscriptionId,
        });
      }
    }
  }

  // A renewal that failed is worth a push the first time it happens.
  const failing = entity.status === "pending" || entity.status === "halted";
  if (failing && previous !== entity.status && account.subscriptionId === subscription._id) {
    await ctx.scheduler.runAfter(0, internal.push.notify, {
      workspaceId: subscription.workspaceId,
      event: "subscription_payment_failed",
      data: {
        message:
          entity.status === "pending"
            ? "Your Magic Agent plan payment did not go through. Razorpay will retry it."
            : "Your Magic Agent plan payment failed. Update your payment method on the Billing page.",
      },
    });
  }
  return subscription;
}

/** A month paid: one row in the payment history, GST split back out. */
async function recordSubscriptionCharge(
  ctx: MutationCtx,
  subscription: Doc<"billingSubscriptions">,
  payment: PaymentEntity
): Promise<void> {
  const existing = await ctx.db
    .query("billingPayments")
    .withIndex("by_razorpay_payment", (q) =>
      q.eq("razorpayPaymentId", payment.razorpayPaymentId)
    )
    .first();
  if (existing) return;

  const totalMicros = fromPaise(payment.amountPaise);
  // At the rate the subscription was priced at, which is the rate its plan
  // amount was built from.
  const gstMicros =
    subscription.totalMicros > 0
      ? roundToPaise((totalMicros * subscription.gstMicros) / subscription.totalMicros)
      : 0;
  const plan = await ctx.db.get("billingPlans", subscription.planId);
  const extras =
    subscription.extraAgents > 0
      ? ` + ${subscription.extraAgents} extra ${subscription.extraAgents === 1 ? "agent" : "agents"}`
      : "";
  const fresh = await ctx.db.get("billingSubscriptions", subscription._id);
  const now = Date.now();
  await ctx.db.insert("billingPayments", {
    workspaceId: subscription.workspaceId,
    purpose: "subscription",
    status: "paid",
    description: `${plan?.name ?? "Platform"} plan${extras}`,
    currency: payment.currency,
    subtotalMicros: totalMicros - gstMicros,
    gstMicros,
    totalMicros,
    razorpayPaymentId: payment.razorpayPaymentId,
    razorpayInvoiceId: payment.invoiceId,
    subscriptionId: subscription._id,
    periodStart: fresh?.currentStart,
    periodEnd: fresh?.currentEnd,
    method: payment.method,
    paidAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Payments against our own orders: top-ups, recharges, mandate authorisations
// ---------------------------------------------------------------------------

async function settlePayment(
  ctx: MutationCtx,
  payment: PaymentEntity,
  tokenStatus?: string
): Promise<void> {
  if (!payment.orderId) return;
  const row = await ctx.db
    .query("billingPayments")
    .withIndex("by_order", (q) => q.eq("razorpayOrderId", payment.orderId))
    .unique();
  // An order that is not ours — a subscription invoice, or another product.
  if (!row) return;
  if (row.status === "paid") {
    // Checkout and the webhook race, and whichever is second lands here. A
    // card mandate's status only ever arrives from Checkout's side — Razorpay
    // sends token webhooks for UPI alone — so it is kept even now.
    if (row.mandate && payment.tokenId && tokenStatus) {
      await applyToken(ctx, { tokenId: payment.tokenId, status: tokenStatus });
    }
    return;
  }

  const now = Date.now();
  // A workspace deleted with a payment in flight: the payment is still
  // recorded, and there is no account left to credit.
  const workspace = await ctx.db.get("workspaces", row.workspaceId);
  if (!workspace) {
    await ctx.db.patch("billingPayments", row._id, {
      status: payment.status === "captured" ? "paid" : row.status,
      razorpayPaymentId: payment.razorpayPaymentId,
      updatedAt: now,
    });
    return;
  }
  const account = await ensureAccount(ctx, row.workspaceId);
  const ownsRecharge = account.rechargeInFlight?.paymentId === row._id;

  if (payment.status === "captured") {
    await ctx.db.patch("billingPayments", row._id, {
      status: "paid",
      razorpayPaymentId: payment.razorpayPaymentId,
      method: payment.method ?? row.method,
      error: undefined,
      paidAt: now,
      updatedAt: now,
    });
    if (row.creditMicros) {
      await creditWallet(ctx, {
        workspaceId: row.workspaceId,
        kind: row.purpose === "auto_recharge" ? "auto_recharge" : "topup",
        amountMicros: row.creditMicros,
        paymentId: row._id,
        note: row.mandate ? "Credited from the auto-recharge authorisation" : undefined,
      });
    }

    const patch: Partial<Doc<"billingAccounts">> = { updatedAt: now };
    if (row.purpose === "auto_recharge") {
      if (ownsRecharge) patch.rechargeInFlight = undefined;
      patch.autoRecharge = {
        ...account.autoRecharge,
        lastChargedAt: now,
        lastError: undefined,
      };
    }
    // The authorisation left a mandate behind: this is what auto-recharge
    // charges from now on.
    if (row.mandate && payment.tokenId) {
      const sameToken = account.mandateTokenId === payment.tokenId;
      const customerId = payment.customerId ?? account.razorpayCustomerId;
      patch.mandateTokenId = payment.tokenId;
      patch.razorpayCustomerId = customerId;
      patch.autoRecharge = {
        ...account.autoRecharge,
        enabled: true,
        method: row.mandate.method,
        maxAmountMicros: row.mandate.maxAmountMicros,
        tokenStatus:
          tokenStatus ??
          (sameToken ? account.autoRecharge.tokenStatus : undefined) ??
          "initiated",
        lastError: undefined,
      };
      // Settled by the webhook, which does not say whether the mandate took.
      // Ask — a card's will not be announced any other way.
      if (!tokenStatus && customerId) {
        await ctx.scheduler.runAfter(0, internal.razorpay.syncToken, {
          customerId,
          tokenId: payment.tokenId,
        });
      }
    }
    await ctx.db.patch("billingAccounts", account._id, patch);
    return;
  }

  if (payment.status === "failed") {
    await ctx.db.patch("billingPayments", row._id, {
      status: "failed",
      razorpayPaymentId: payment.razorpayPaymentId,
      error: payment.error ?? "The payment failed.",
      updatedAt: now,
    });
    if (row.purpose === "auto_recharge") {
      await ctx.db.patch("billingAccounts", account._id, {
        rechargeInFlight: ownsRecharge ? undefined : account.rechargeInFlight,
        autoRecharge: {
          ...account.autoRecharge,
          lastError: payment.error ?? "The last auto-recharge failed.",
        },
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.push.notify, {
        workspaceId: row.workspaceId,
        event: "wallet_recharge_failed",
        data: {
          message: `The wallet auto-recharge of ${formatMoney(row.totalMicros, row.currency, PLATFORM_LOCALE)} failed. Top up on the Billing page.`,
        },
      });
    }
    return;
  }

  // Authorised but not captured yet, or created and waiting on the debit.
  if (row.status === "created") {
    await ctx.db.patch("billingPayments", row._id, {
      status: "pending",
      razorpayPaymentId: payment.razorpayPaymentId,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Mandates
// ---------------------------------------------------------------------------

async function applyToken(ctx: MutationCtx, token: TokenEntity): Promise<void> {
  const account = await ctx.db
    .query("billingAccounts")
    .withIndex("by_mandate_token", (q) => q.eq("mandateTokenId", token.tokenId))
    .unique();
  if (!account || !token.status) return;

  const usable = token.status === "confirmed";
  await ctx.db.patch("billingAccounts", account._id, {
    autoRecharge: {
      ...account.autoRecharge,
      tokenStatus: token.status,
      lastError: usable
        ? undefined
        : token.status === "initiated"
          ? account.autoRecharge.lastError
          : token.failureReason ||
            `The saved mandate was ${token.status}. Set up auto-recharge again.`,
    },
    updatedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** One webhook delivery. Deduplicated on Razorpay's event id. */
export const apply = internalMutation({
  args: {
    eventId: v.string(),
    event: v.string(),
    subscription: v.optional(subscriptionEntity),
    payment: v.optional(paymentEntity),
    token: v.optional(tokenEntity),
  },
  handler: async (ctx, args) => {
    if (args.eventId) {
      const seen = await ctx.db
        .query("razorpayEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
        .first();
      if (seen) return { applied: false };
      await ctx.db.insert("razorpayEvents", {
        eventId: args.eventId,
        event: args.event,
        receivedAt: Date.now(),
      });
    }

    if (args.subscription) {
      const subscription = await applySubscription(ctx, args.subscription);
      if (subscription && args.event === "subscription.charged" && args.payment) {
        await recordSubscriptionCharge(ctx, subscription, args.payment);
      }
    } else if (args.payment) {
      await settlePayment(ctx, args.payment);
    }
    if (args.token) await applyToken(ctx, args.token);
    return { applied: true };
  },
});

/** A subscription the browser has just authorised, fetched fresh. */
export const syncSubscription = internalMutation({
  args: { subscription: subscriptionEntity },
  handler: async (ctx, args) => {
    const subscription = await applySubscription(ctx, args.subscription);
    return subscription ? { status: args.subscription.status } : null;
  },
});

/** A payment the browser has just made, fetched fresh. */
export const syncPayment = internalMutation({
  args: { payment: paymentEntity, tokenStatus: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await settlePayment(ctx, args.payment, args.tokenStatus);
    return null;
  },
});

/** A mandate's status, read back from Razorpay. */
export const syncTokenStatus = internalMutation({
  args: { token: tokenEntity },
  handler: async (ctx, args) => {
    await applyToken(ctx, args.token);
    return null;
  },
});

/** Housekeeping, from convex/crons.ts. */
export const pruneEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("razorpayEvents")
      .withIndex("by_receivedAt", (q) =>
        q.lt("receivedAt", Date.now() - EVENT_TTL_MS)
      )
      .take(500);
    for (const row of old) await ctx.db.delete("razorpayEvents", row._id);
    if (old.length === 500) {
      await ctx.scheduler.runAfter(0, internal.razorpayEvents.pruneEvents, {});
    }
    return null;
  },
});
