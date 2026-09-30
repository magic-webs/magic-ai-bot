// Every call this deployment makes to Razorpay.
//
// Default runtime rather than Node: fetch and Web Crypto are all it needs.
// Each action checks the caller through an internal query first — the guard
// travels with the identity, so `requireOwner` there is a real check — then
// talks to Razorpay, then records what happened through an internal
// mutation. State transitions that Razorpay reports later, by webhook, are
// applied by the same mutations (convex/razorpayEvents.ts).

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { toMicros } from "./lib/billing";
import { toPaise } from "./lib/plans";
import {
  RazorpayError,
  checkoutSignatureValid,
  paymentFields,
  razorpay,
  razorpayConfig,
  requireRazorpay,
  subscriptionFields,
  toSeconds,
  type RazorpayCustomer,
  type RazorpayOrder,
  type RazorpayPayment,
  type RazorpayPlan,
  type RazorpaySubscription,
  type RazorpayToken,
} from "./lib/razorpay";

/**
 * Ten years of months. Razorpay needs a subscription to end, and a price is
 * changed long before this runs out — by a new subscription, not this one.
 */
const TOTAL_COUNT = 120;
const MANDATE_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const BRAND = "Magic Agent";

/** What the browser hands to Razorpay Checkout. */
export type CheckoutOptions = {
  keyId: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
} & (
  | { kind: "subscription"; subscriptionId: string; startAt: number | null }
  | {
      kind: "order";
      orderId: string;
      amountPaise: number;
      currency: string;
      customerId: string | null;
      recurring: boolean;
    }
);

const agents = (count: number) =>
  `${count} extra ${count === 1 ? "agent" : "agents"}`;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------
// The platform fee
// ---------------------------------------------------------------------------

/**
 * Create the subscription for a plan and a number of extra agents, for
 * Checkout to authorise.
 *
 * A Razorpay plan's amount is fixed, so the plan is made to measure — one per
 * distinct price, remembered and reused. When the account is already paid up
 * (a trial, or a month of the plan it is leaving), the subscription starts
 * charging at that date; Razorpay authorises it with a refunded ₹5 until then.
 */
export const startSubscription = action({
  args: {
    workspaceId: v.id("workspaces"),
    planId: v.id("billingPlans"),
    extraAgents: v.number(),
  },
  handler: async (ctx, args): Promise<CheckoutOptions> => {
    const config = requireRazorpay();
    const context = await ctx.runQuery(internal.subscriptions.checkoutContext, {
      ...args,
      now: Date.now(),
    });
    const { quote } = context;
    const extras = quote.extraAgents > 0 ? ` + ${agents(quote.extraAgents)}` : "";
    const description = `${context.plan.name} plan${extras}, monthly`;

    let razorpayPlanId = context.razorpayPlanId;
    if (!razorpayPlanId) {
      const created = await razorpay<RazorpayPlan>(config, "POST", "/plans", {
        period: "monthly",
        interval: 1,
        item: {
          name: `${BRAND} ${context.plan.name}${extras}`,
          amount: toPaise(quote.totalMicros),
          currency: context.currency,
          description: `Platform fee, including ${quote.gstPercent}% GST`,
        },
        notes: { plan: context.plan.code, extraAgents: String(quote.extraAgents) },
      });
      razorpayPlanId = await ctx.runMutation(
        internal.subscriptions.rememberRazorpayPlan,
        { key: context.razorpayPlanKey, razorpayPlanId: created.id }
      );
    }

    // A checkout opened and never finished is withdrawn, so it cannot be
    // authorised later beside this one.
    if (context.abandonedRazorpayId) {
      await razorpay(
        config,
        "POST",
        `/subscriptions/${context.abandonedRazorpayId}/cancel`,
        { cancel_at_cycle_end: false }
      ).catch(() => undefined);
    }

    const subscription = await razorpay<RazorpaySubscription>(
      config,
      "POST",
      "/subscriptions",
      {
        plan_id: razorpayPlanId,
        total_count: TOTAL_COUNT,
        quantity: 1,
        customer_notify: true,
        ...(context.startAt ? { start_at: toSeconds(context.startAt) } : {}),
        notes: {
          workspaceId: args.workspaceId,
          plan: context.plan.code,
          extraAgents: String(quote.extraAgents),
        },
      }
    );

    await ctx.runMutation(internal.subscriptions.recordCreated, {
      workspaceId: args.workspaceId,
      razorpaySubscriptionId: subscription.id,
      razorpayPlanId,
      planId: context.plan._id,
      extraAgents: quote.extraAgents,
      subtotalMicros: quote.subtotalMicros,
      gstMicros: quote.gstMicros,
      totalMicros: quote.totalMicros,
      currency: context.currency,
      startAt: context.startAt ?? undefined,
      shortUrl: subscription.short_url ?? undefined,
      replacesId: context.replacesId ?? undefined,
    });

    return {
      kind: "subscription",
      keyId: config.keyId,
      subscriptionId: subscription.id,
      startAt: context.startAt,
      name: BRAND,
      description,
      prefill: context.prefill,
    };
  },
});

/**
 * Checkout says the subscription is authorised. Checked against the secret,
 * then read back from Razorpay rather than taken from the browser.
 */
export const confirmSubscription = action({
  args: {
    workspaceId: v.id("workspaces"),
    razorpayPaymentId: v.string(),
    razorpaySubscriptionId: v.string(),
    razorpaySignature: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const config = requireRazorpay();
    const known = await ctx.runQuery(internal.subscriptions.confirmContext, {
      workspaceId: args.workspaceId,
      razorpaySubscriptionId: args.razorpaySubscriptionId,
    });
    if (!known) throw new Error("That subscription does not belong to this workspace.");
    const valid = await checkoutSignatureValid(
      config,
      `${args.razorpayPaymentId}|${known.razorpaySubscriptionId}`,
      args.razorpaySignature
    );
    if (!valid) {
      throw new Error(
        "Razorpay's confirmation did not verify. If you were charged, the plan shows here as soon as Razorpay reports it."
      );
    }
    const entity = await razorpay<RazorpaySubscription>(
      config,
      "GET",
      `/subscriptions/${known.razorpaySubscriptionId}`
    );
    await ctx.runMutation(internal.razorpayEvents.syncSubscription, {
      subscription: subscriptionFields(entity),
    });
    return { status: entity.status };
  },
});

/**
 * Stop the plan. A month already charged runs to its end; a subscription
 * that has not charged yet — authorised during a trial — ends at once, which
 * leaves the trial as it was. `immediately` ends a charged one now too, and
 * is how one already set to end at the period's close is brought forward.
 */
export const cancelSubscription = action({
  args: {
    workspaceId: v.id("workspaces"),
    immediately: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ atCycleEnd: boolean }> => {
    const config = requireRazorpay();
    const live = await ctx.runQuery(internal.subscriptions.cancelContext, {
      workspaceId: args.workspaceId,
    });
    if (!live) throw new Error("There is no subscription to cancel.");
    const path = `/subscriptions/${live.razorpaySubscriptionId}/cancel`;

    let atCycleEnd = !args.immediately && live.charged && live.status === "active";
    try {
      await razorpay(config, "POST", path, { cancel_at_cycle_end: atCycleEnd });
    } catch (error) {
      // Razorpay refuses a cycle-end cancel in a subscription's final cycle.
      if (!atCycleEnd || !(error instanceof RazorpayError) || error.status !== 400) {
        throw error;
      }
      await razorpay(config, "POST", path, { cancel_at_cycle_end: false });
      atCycleEnd = false;
    }
    if (atCycleEnd) {
      await ctx.runMutation(internal.subscriptions.markCancelAtCycleEnd, {
        subscriptionId: live.subscriptionId,
      });
    }

    const entity = await razorpay<RazorpaySubscription>(
      config,
      "GET",
      `/subscriptions/${live.razorpaySubscriptionId}`
    );
    await ctx.runMutation(internal.razorpayEvents.syncSubscription, {
      subscription: subscriptionFields(entity),
    });
    return { atCycleEnd };
  },
});

/**
 * Read the account's subscriptions back from Razorpay. For when a webhook
 * went astray — the page offers it when a checkout looks stuck.
 */
export const refresh = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ refreshed: number }> => {
    const config = requireRazorpay();
    const ids = await ctx.runQuery(internal.subscriptions.refreshContext, args);
    for (const id of ids) {
      const entity = await razorpay<RazorpaySubscription>(
        config,
        "GET",
        `/subscriptions/${id}`
      );
      await ctx.runMutation(internal.razorpayEvents.syncSubscription, {
        subscription: subscriptionFields(entity),
      });
    }
    return { refreshed: ids.length };
  },
});

/** The subscription a new one replaced. Scheduled by razorpayEvents. */
export const cancelRemote = internalAction({
  args: { razorpaySubscriptionId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const config = razorpayConfig();
    if (!config) return null;
    try {
      await razorpay(
        config,
        "POST",
        `/subscriptions/${args.razorpaySubscriptionId}/cancel`,
        { cancel_at_cycle_end: false }
      );
    } catch (error) {
      // Already cancelled is the usual reason, and the fetch below says so.
      console.warn("[razorpay] cancel", args.razorpaySubscriptionId, message(error));
    }
    const entity = await razorpay<RazorpaySubscription>(
      config,
      "GET",
      `/subscriptions/${args.razorpaySubscriptionId}`
    );
    await ctx.runMutation(internal.razorpayEvents.syncSubscription, {
      subscription: subscriptionFields(entity),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------

/** An order for a top-up — the amount plus GST — for Checkout to pay. */
export const startTopUp = action({
  args: { workspaceId: v.id("workspaces"), amount: v.number() },
  handler: async (ctx, args): Promise<CheckoutOptions> => {
    const config = requireRazorpay();
    const filed = await ctx.runMutation(internal.wallet.createTopUp, {
      workspaceId: args.workspaceId,
      amountMicros: toMicros(args.amount),
    });
    const order = await razorpay<RazorpayOrder>(config, "POST", "/orders", {
      amount: filed.amountPaise,
      currency: filed.currency,
      receipt: filed.paymentId,
      notes: { workspaceId: args.workspaceId, purpose: "wallet_topup" },
    });
    await ctx.runMutation(internal.wallet.attachOrder, {
      paymentId: filed.paymentId,
      orderId: order.id,
    });
    return {
      kind: "order",
      keyId: config.keyId,
      orderId: order.id,
      amountPaise: filed.amountPaise,
      currency: filed.currency,
      customerId: null,
      recurring: false,
      name: BRAND,
      description: "Wallet top-up",
      prefill: filed.customer,
    };
  },
});

/**
 * The ₹1 authorisation that leaves a mandate behind for auto-recharge.
 *
 * The mandate is "as presented" — charged when the wallet runs low, not on a
 * calendar — up to a ceiling fixed now. The ₹1 is credited to the wallet.
 */
export const startMandate = action({
  args: {
    workspaceId: v.id("workspaces"),
    method: v.union(v.literal("upi"), v.literal("card")),
    rechargeAmount: v.number(),
    threshold: v.number(),
  },
  handler: async (ctx, args): Promise<CheckoutOptions> => {
    const config = requireRazorpay();
    const filed = await ctx.runMutation(internal.wallet.createTopUp, {
      workspaceId: args.workspaceId,
      amountMicros: 0,
      mandate: {
        method: args.method,
        rechargeAmountMicros: toMicros(args.rechargeAmount),
        thresholdMicros: toMicros(Math.max(0, args.threshold)),
      },
    });

    let customerId = filed.customerId;
    if (!customerId) {
      const name = filed.customer.name.trim();
      const customer = await razorpay<RazorpayCustomer>(config, "POST", "/customers", {
        // Razorpay wants 3 to 50 characters.
        name: (name.length >= 3 ? name : `${name} account`).slice(0, 50),
        email: filed.customer.email,
        contact: filed.customer.contact,
        fail_existing: "0",
        ...(filed.customer.gstin ? { gstin: filed.customer.gstin } : {}),
        notes: { workspaceId: args.workspaceId },
      });
      customerId = customer.id;
      await ctx.runMutation(internal.wallet.saveCustomer, {
        workspaceId: args.workspaceId,
        customerId,
      });
    }

    const order = await razorpay<RazorpayOrder>(config, "POST", "/orders", {
      amount: filed.amountPaise,
      currency: filed.currency,
      customer_id: customerId,
      method: args.method,
      receipt: filed.paymentId,
      notes: { workspaceId: args.workspaceId, purpose: "auto_recharge_mandate" },
      token: {
        max_amount: filed.maxAmountPaise,
        expire_at: toSeconds(Date.now() + MANDATE_LIFETIME_MS),
        frequency: "as_presented",
      },
    });
    await ctx.runMutation(internal.wallet.attachOrder, {
      paymentId: filed.paymentId,
      orderId: order.id,
    });
    return {
      kind: "order",
      keyId: config.keyId,
      orderId: order.id,
      amountPaise: filed.amountPaise,
      currency: filed.currency,
      customerId,
      recurring: true,
      name: BRAND,
      description: "Authorise wallet auto-recharge",
      prefill: filed.customer,
    };
  },
});

/**
 * Checkout says an order was paid. Verified, read back, captured if the
 * account captures by hand, and settled — the webhook will say the same
 * thing shortly and be ignored.
 */
export const confirmPayment = action({
  args: {
    workspaceId: v.id("workspaces"),
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    razorpaySignature: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const config = requireRazorpay();
    const known = await ctx.runQuery(internal.wallet.confirmContext, {
      workspaceId: args.workspaceId,
      razorpayOrderId: args.razorpayOrderId,
    });
    if (!known) throw new Error("That payment does not belong to this workspace.");
    const valid = await checkoutSignatureValid(
      config,
      `${known.razorpayOrderId}|${args.razorpayPaymentId}`,
      args.razorpaySignature
    );
    if (!valid) {
      throw new Error(
        "Razorpay's confirmation did not verify. If you were charged, it shows here as soon as Razorpay reports it."
      );
    }

    let payment = await razorpay<RazorpayPayment>(
      config,
      "GET",
      `/payments/${args.razorpayPaymentId}`
    );
    if (payment.order_id !== known.razorpayOrderId) {
      throw new Error("That payment is for a different order.");
    }
    if (payment.status === "authorized") {
      payment = await razorpay<RazorpayPayment>(
        config,
        "POST",
        `/payments/${payment.id}/capture`,
        { amount: payment.amount, currency: payment.currency }
      );
    }

    // UPI mandates confirm a while after checkout; a card's usually has.
    let tokenStatus: string | undefined;
    const customerId = payment.customer_id ?? known.customerId;
    if (known.mandate && payment.token_id && customerId) {
      try {
        const token = await razorpay<RazorpayToken>(
          config,
          "GET",
          `/customers/${customerId}/tokens/${payment.token_id}`
        );
        tokenStatus = token.recurring_details?.status ?? undefined;
      } catch (error) {
        console.warn("[razorpay] token status", message(error));
      }
    }

    await ctx.runMutation(internal.razorpayEvents.syncPayment, {
      payment: paymentFields(payment),
      tokenStatus,
    });
    return { status: payment.status };
  },
});

/**
 * Debit the saved mandate for one recharge. Scheduled by the wallet the
 * moment the balance drops below its line (convex/lib/wallet.ts).
 *
 * Asking is all this does: the bank sends the customer its pre-debit notice
 * and takes the money a day or so later, and that arrives as a webhook.
 */
export const chargeMandate = internalAction({
  args: { paymentId: v.id("billingPayments") },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.wallet.rechargeContext, args);
    if (!context) return null;
    const fail = async (error: string): Promise<null> => {
      await ctx.runMutation(internal.wallet.markRechargeFailed, {
        paymentId: args.paymentId,
        error,
      });
      return null;
    };

    const config = razorpayConfig();
    if (!config) return await fail("Payments are not set up on the platform.");
    if (!context.ready || !context.customerId || !context.tokenId) {
      return await fail("There is no confirmed mandate to charge.");
    }
    if (!context.email || !context.contact) {
      return await fail(
        "Add a billing email and phone number — Razorpay needs both to charge a mandate."
      );
    }

    try {
      const order = await razorpay<RazorpayOrder>(config, "POST", "/orders", {
        amount: context.amountPaise,
        currency: context.currency,
        payment_capture: true,
        receipt: args.paymentId,
        notes: { workspaceId: context.workspaceId, purpose: "auto_recharge" },
      });
      // Filed against the order before the debit is asked for, so a webhook
      // that beats the response below still finds its row.
      await ctx.runMutation(internal.wallet.markRechargeRequested, {
        paymentId: args.paymentId,
        orderId: order.id,
      });
      const created = await razorpay<{ razorpay_payment_id?: string }>(
        config,
        "POST",
        "/payments/create/recurring",
        {
          email: context.email,
          contact: context.contact,
          amount: context.amountPaise,
          currency: context.currency,
          order_id: order.id,
          customer_id: context.customerId,
          token: context.tokenId,
          recurring: "1",
          description: `${BRAND} wallet auto-recharge`,
          notes: { workspaceId: context.workspaceId, purpose: "auto_recharge" },
        }
      );
      await ctx.runMutation(internal.wallet.markRechargeRequested, {
        paymentId: args.paymentId,
        orderId: order.id,
        razorpayPaymentId: created.razorpay_payment_id,
      });
    } catch (error) {
      await fail(message(error));
    }
    return null;
  },
});

/**
 * Read a mandate's status back. Scheduled when a webhook settles the
 * authorisation, since for a card nothing else will ever report it.
 */
export const syncToken = internalAction({
  args: { customerId: v.string(), tokenId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const config = razorpayConfig();
    if (!config) return null;
    try {
      const token = await razorpay<RazorpayToken>(
        config,
        "GET",
        `/customers/${args.customerId}/tokens/${args.tokenId}`
      );
      await ctx.runMutation(internal.razorpayEvents.syncTokenStatus, {
        token: {
          tokenId: args.tokenId,
          status: token.recurring_details?.status ?? undefined,
          failureReason: token.recurring_details?.failure_reason ?? undefined,
        },
      });
    } catch (error) {
      console.warn("[razorpay] token status", message(error));
    }
    return null;
  },
});

/** Withdraw a mandate at the bank. Scheduled when the company removes it. */
export const cancelMandate = internalAction({
  args: { customerId: v.string(), tokenId: v.string() },
  handler: async (_ctx, args): Promise<null> => {
    const config = razorpayConfig();
    if (!config) return null;
    try {
      await razorpay(
        config,
        "PUT",
        `/customers/${args.customerId}/tokens/${args.tokenId}/cancel`
      );
    } catch (error) {
      console.warn("[razorpay] mandate cancel", message(error));
    }
    return null;
  },
});
