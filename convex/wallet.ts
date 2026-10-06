// The wallet, from the account's side: what it holds, what it has been
// spending, how it is refilled, and the log of every rupee put in.
//
// The debit itself is in convex/lib/wallet.ts, called by every charge; the
// Razorpay calls behind a top-up or a recharge are in convex/razorpay.ts.

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin, requireOwner, requireWorkspace } from "./lib/auth";
import {
  accountFor,
  billingContact,
  billingSettings,
  billingTermsFor,
  ensureAccount,
} from "./lib/account";
import { homeMarket, metaRatesFor, toMicros } from "./lib/billing";
import { razorpayConfig } from "./lib/razorpay";
import {
  APPROVAL_LIMIT_MICROS,
  MAX_TOPUP_MICROS,
  defaultRechargeIn,
  toPaise,
  withGst,
} from "./lib/plans";
import { creditWallet, walletFor } from "./lib/wallet";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Enough to average a week of spend; a busier week reads as a floor. */
const SPEND_SCAN_CAP = 5000;
/**
 * The authorisation payment for a mandate. A card mandate must be
 * authorised with exactly ₹1, so both methods are, and it is credited.
 */
const MANDATE_AUTH_MICROS = toMicros(1);
/** The ceiling a mandate is authorised for. See APPROVAL_LIMIT_MICROS. */
const MANDATE_CAP_MICROS = APPROVAL_LIMIT_MICROS;

export const summary = query({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    const settings = (await billingTermsFor(ctx, args.workspaceId))?.settings;
    if (!settings) return null;

    const account = await accountFor(ctx, args.workspaceId);
    const wallet = await walletFor(ctx, args.workspaceId);
    const rates = await metaRatesFor(
      ctx,
      await homeMarket(ctx, args.workspaceId),
      settings.currency
    );
    const balanceMicros = wallet?.balanceMicros ?? 0;
    const thresholdMicros =
      account?.lowBalanceThresholdMicros ?? settings.defaultThresholdMicros;

    // A week of spend in the wallet's currency, for "about N days left".
    const recent = await ctx.db
      .query("billingEvents")
      .withIndex("by_workspace_createdAt", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("createdAt", args.now - 7 * DAY_MS)
      )
      .take(SPEND_SCAN_CAP);
    const spent7dMicros = recent
      .filter((row) => row.currency === settings.currency)
      .reduce((sum, row) => sum + row.amountMicros, 0);

    const inFlight = account?.rechargeInFlight
      ? await ctx.db.get("billingPayments", account.rechargeInFlight.paymentId)
      : null;
    const recharge = account?.autoRecharge;
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    const contact = workspace ? billingContact(account, workspace) : null;

    return {
      isOwner: principal.role !== "member",
      razorpayKeyId: razorpayConfig()?.keyId ?? null,
      currency: settings.currency,
      gstPercent: settings.gstPercent,
      minTopUpMicros: settings.minTopUpMicros,
      balanceMicros,
      thresholdMicros,
      lowBalance: balanceMicros < thresholdMicros,
      spent7dMicros,
      spendTruncated: recent.length === SPEND_SCAN_CAP,
      // Rates in another currency cannot come off a rupee balance.
      rateCurrency: rates?.currency ?? null,
      autoRecharge: {
        enabled: recharge?.enabled ?? false,
        amountMicros: recharge?.amountMicros ?? defaultRechargeIn(settings),
        method: recharge?.method ?? null,
        tokenStatus: account?.mandateTokenId
          ? (recharge?.tokenStatus ?? null)
          : null,
        maxAmountMicros: recharge?.maxAmountMicros ?? null,
        lastError: recharge?.lastError ?? null,
        lastChargedAt: recharge?.lastChargedAt ?? null,
      },
      hasMandate: Boolean(account?.mandateTokenId),
      inFlight: inFlight
        ? {
            startedAt: account!.rechargeInFlight!.startedAt,
            totalMicros: inFlight.totalMicros,
            status: inFlight.status,
          }
        : null,
      profileReady: Boolean(contact?.email && contact.phone),
    };
  },
});

/** Money in, newest first. Money out is the message ledger. */
export const transactions = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("walletTransactions")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * The low-balance line, and whether and by how much to recharge when the
 * balance crosses it. Amounts in whole rupees.
 */
export const updatePreferences = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    threshold: v.number(),
    autoRechargeEnabled: v.boolean(),
    rechargeAmount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const settings = (await billingTermsFor(ctx, args.workspaceId))?.settings;
    if (!settings) throw new Error("Billing is not switched on yet.");
    if (!Number.isFinite(args.threshold) || args.threshold < 0) {
      throw new Error("The low-balance line must be zero or more.");
    }
    const amountMicros = toMicros(args.rechargeAmount);
    if (
      !(amountMicros >= settings.minTopUpMicros) ||
      amountMicros > MAX_TOPUP_MICROS
    ) {
      throw new Error(
        "Pick a recharge amount between the minimum top-up and ₹5,00,000."
      );
    }

    const account = await ensureAccount(ctx, args.workspaceId);
    const ceiling = account.autoRecharge.maxAmountMicros;
    if (
      args.autoRechargeEnabled &&
      ceiling !== undefined &&
      withGst(amountMicros, settings.gstPercent).totalMicros > ceiling
    ) {
      throw new Error(
        "That is more than the saved mandate allows in one debit. Remove it and authorise auto-recharge again for the higher amount."
      );
    }
    if (args.autoRechargeEnabled && !account.mandateTokenId) {
      throw new Error("Authorise a payment method for auto-recharge first.");
    }

    await ctx.db.patch("billingAccounts", account._id, {
      lowBalanceThresholdMicros: toMicros(args.threshold),
      autoRecharge: {
        ...account.autoRecharge,
        enabled: args.autoRechargeEnabled,
        amountMicros,
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Stop auto-recharge for good: the mandate is cancelled at Razorpay, so the
 * bank stops honouring it, and forgotten here.
 */
export const removeMandate = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const account = await accountFor(ctx, args.workspaceId);
    if (!account?.mandateTokenId) return null;
    if (account.razorpayCustomerId) {
      await ctx.scheduler.runAfter(0, internal.razorpay.cancelMandate, {
        customerId: account.razorpayCustomerId,
        tokenId: account.mandateTokenId,
      });
    }
    await ctx.db.patch("billingAccounts", account._id, {
      mandateTokenId: undefined,
      autoRecharge: {
        enabled: false,
        amountMicros: account.autoRecharge.amountMicros,
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * An administrator's correction: a goodwill credit, a refund made outside
 * Razorpay, or a charge taken back. Signed, in whole rupees, and logged with
 * who made it.
 */
export const adminAdjust = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    amount: v.number(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (!(await billingSettings(ctx)))
      throw new Error("Switch billing on first.");
    const amountMicros = toMicros(args.amount);
    if (!Number.isFinite(args.amount) || amountMicros === 0) {
      throw new Error("Enter an amount to add or take off.");
    }
    if (Math.abs(amountMicros) > MAX_TOPUP_MICROS) {
      throw new Error("That adjustment looks too large.");
    }
    const note = args.note.trim();
    if (!note) throw new Error("Say why, so the account can see it.");
    if (!(await ctx.db.get("workspaces", args.workspaceId))) {
      throw new Error("Workspace not found");
    }
    return await creditWallet(ctx, {
      workspaceId: args.workspaceId,
      kind: "adjustment",
      amountMicros,
      note: note.slice(0, 200),
      by: admin.label,
    });
  },
});

// ---------------------------------------------------------------------------
// For convex/razorpay.ts
// ---------------------------------------------------------------------------

/**
 * File a wallet payment before Razorpay is asked for its order, so every
 * order we create has a row to settle against.
 *
 * A top-up is its amount plus GST. A mandate's authorisation is ₹1, credited
 * as it is — what it buys is the mandate.
 */
export const createTopUp = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    amountMicros: v.number(),
    mandate: v.optional(
      v.object({
        method: v.union(v.literal("upi"), v.literal("card")),
        rechargeAmountMicros: v.number(),
        thresholdMicros: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const settings = (await billingTermsFor(ctx, args.workspaceId))?.settings;
    if (!settings) throw new Error("Billing is not switched on yet.");
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const account = await ensureAccount(ctx, args.workspaceId);
    const now = Date.now();

    if (args.mandate) {
      const recharge = args.mandate.rechargeAmountMicros;
      if (!(recharge >= settings.minTopUpMicros)) {
        throw new Error("The recharge amount is below the minimum top-up.");
      }
      const rechargeTotal = withGst(recharge, settings.gstPercent).totalMicros;
      if (rechargeTotal > MANDATE_CAP_MICROS) {
        throw new Error(
          "An automatic debit can be at most ₹15,000 with GST. Pick a smaller recharge amount."
        );
      }
      const contact = billingContact(account, workspace);
      if (!contact.email || !contact.phone) {
        throw new Error(
          "Add a billing email and phone number first — Razorpay needs both."
        );
      }
      // Headroom over one recharge, so raising the amount a little later does
      // not mean authorising again.
      const maxAmountMicros = Math.min(MANDATE_CAP_MICROS, rechargeTotal * 2);
      await ctx.db.patch("billingAccounts", account._id, {
        lowBalanceThresholdMicros: args.mandate.thresholdMicros,
        autoRecharge: { ...account.autoRecharge, amountMicros: recharge },
        updatedAt: now,
      });
      const paymentId = await ctx.db.insert("billingPayments", {
        workspaceId: args.workspaceId,
        purpose: "wallet_topup",
        status: "created",
        description: "Auto-recharge authorisation",
        currency: settings.currency,
        subtotalMicros: MANDATE_AUTH_MICROS,
        gstMicros: 0,
        totalMicros: MANDATE_AUTH_MICROS,
        creditMicros: MANDATE_AUTH_MICROS,
        mandate: { method: args.mandate.method, maxAmountMicros },
        createdAt: now,
        updatedAt: now,
      });
      return {
        paymentId,
        amountPaise: toPaise(MANDATE_AUTH_MICROS),
        maxAmountPaise: toPaise(maxAmountMicros),
        currency: settings.currency,
        customerId: account.razorpayCustomerId ?? null,
        customer: {
          name: contact.name,
          email: contact.email,
          contact: contact.phone,
          gstin: account.gstin,
        },
      };
    }

    if (!(args.amountMicros >= settings.minTopUpMicros)) {
      throw new Error("That is below the minimum top-up.");
    }
    if (args.amountMicros > MAX_TOPUP_MICROS) {
      throw new Error("A single top-up can be at most ₹5,00,000.");
    }
    const amounts = withGst(args.amountMicros, settings.gstPercent);
    const paymentId = await ctx.db.insert("billingPayments", {
      workspaceId: args.workspaceId,
      purpose: "wallet_topup",
      status: "created",
      description: "Wallet top-up",
      currency: settings.currency,
      ...amounts,
      creditMicros: amounts.subtotalMicros,
      createdAt: now,
      updatedAt: now,
    });
    const contact = billingContact(account, workspace);
    return {
      paymentId,
      amountPaise: toPaise(amounts.totalMicros),
      maxAmountPaise: null,
      currency: settings.currency,
      customerId: account.razorpayCustomerId ?? null,
      customer: {
        name: contact.name,
        email: contact.email,
        contact: contact.phone,
        gstin: account.gstin,
      },
    };
  },
});

export const attachOrder = internalMutation({
  args: { paymentId: v.id("billingPayments"), orderId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("billingPayments", args.paymentId, {
      razorpayOrderId: args.orderId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const saveCustomer = internalMutation({
  args: { workspaceId: v.id("workspaces"), customerId: v.string() },
  handler: async (ctx, args) => {
    const account = await ensureAccount(ctx, args.workspaceId);
    await ctx.db.patch("billingAccounts", account._id, {
      razorpayCustomerId: args.customerId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** A wallet payment Checkout just finished, if it is this workspace's own. */
export const confirmContext = internalQuery({
  args: { workspaceId: v.id("workspaces"), razorpayOrderId: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const row = await ctx.db
      .query("billingPayments")
      .withIndex("by_order", (q) =>
        q.eq("razorpayOrderId", args.razorpayOrderId)
      )
      .unique();
    if (!row || row.workspaceId !== args.workspaceId) return null;
    const account = await accountFor(ctx, args.workspaceId);
    return {
      razorpayOrderId: args.razorpayOrderId,
      totalPaise: toPaise(row.totalMicros),
      currency: row.currency,
      mandate: row.mandate !== undefined,
      customerId: account?.razorpayCustomerId ?? null,
    };
  },
});

/** What a recharge debit needs. No caller to check: the scheduler asked. */
export const rechargeContext = internalQuery({
  args: { paymentId: v.id("billingPayments") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("billingPayments", args.paymentId);
    if (!row || row.status !== "created") return null;
    const account = await accountFor(ctx, row.workspaceId);
    const workspace = await ctx.db.get("workspaces", row.workspaceId);
    if (!account || !workspace) return null;
    const contact = billingContact(account, workspace);
    return {
      workspaceId: row.workspaceId,
      amountPaise: toPaise(row.totalMicros),
      currency: row.currency,
      customerId: account.razorpayCustomerId ?? null,
      tokenId: account.mandateTokenId ?? null,
      email: contact.email || null,
      contact: contact.phone || null,
      ready:
        account.autoRecharge.enabled &&
        account.autoRecharge.tokenStatus === "confirmed",
    };
  },
});

/** Razorpay has the debit; the pre-debit notice is on its way to the bank. */
export const markRechargeRequested = internalMutation({
  args: {
    paymentId: v.id("billingPayments"),
    orderId: v.string(),
    razorpayPaymentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("billingPayments", args.paymentId);
    if (!row || row.status === "paid" || row.status === "failed") return null;
    await ctx.db.patch("billingPayments", args.paymentId, {
      status: "pending",
      razorpayOrderId: args.orderId,
      razorpayPaymentId: args.razorpayPaymentId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** The recharge could not even be asked for. Frees the slot for the next dip. */
export const markRechargeFailed = internalMutation({
  args: { paymentId: v.id("billingPayments"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("billingPayments", args.paymentId);
    if (!row || row.status === "paid") return null;
    const now = Date.now();
    await ctx.db.patch("billingPayments", args.paymentId, {
      status: "failed",
      error: args.error.slice(0, 300),
      updatedAt: now,
    });
    const account = await accountFor(ctx, row.workspaceId);
    if (account) {
      await ctx.db.patch("billingAccounts", account._id, {
        rechargeInFlight:
          account.rechargeInFlight?.paymentId === args.paymentId
            ? undefined
            : account.rechargeInFlight,
        autoRecharge: {
          ...account.autoRecharge,
          lastError: args.error.slice(0, 300),
        },
        updatedAt: now,
      });
    }
    return null;
  },
});
