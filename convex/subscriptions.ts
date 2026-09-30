// The platform fee, from the account's side: which plan a workspace is on,
// how many extra agents it pays for, whether its dashboard is open, and what
// an administrator has arranged for it.
//
// Talking to Razorpay happens in convex/razorpay.ts, which calls the internal
// functions at the bottom of this file; what Razorpay reports back is applied
// in convex/razorpayEvents.ts.

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireOwner, requireWorkspace } from "./lib/auth";
import {
  accountFor,
  allPlans,
  billingContact,
  billingSettings,
  ensureAccount,
  liveSubscription,
  standingOf,
} from "./lib/account";
import { toMicros } from "./lib/billing";
import { logoSrcFor } from "./lib/branding";
import { razorpayConfig } from "./lib/razorpay";
import {
  MAX_EXTRA_AGENTS,
  accessOf,
  isLiveStatus,
  isValidGstin,
  nextStartAt,
  quote,
  toPaise,
  type Quote,
} from "./lib/plans";
import { walletFor } from "./lib/wallet";

const LIVE = new Set(["authenticated", "active"]);
/** Statuses in which Razorpay may still take a payment. */
const CHARGEABLE = new Set(["authenticated", "active", "pending", "halted"]);

function subscriptionView(row: Doc<"billingSubscriptions"> | null) {
  if (!row) return null;
  return {
    _id: row._id,
    status: row.status,
    planId: row.planId,
    extraAgents: row.extraAgents,
    subtotalMicros: row.subtotalMicros,
    gstMicros: row.gstMicros,
    totalMicros: row.totalMicros,
    currency: row.currency,
    startAt: row.startAt ?? null,
    currentStart: row.currentStart ?? null,
    currentEnd: row.currentEnd ?? null,
    chargeAt: row.chargeAt ?? null,
    paidCount: row.paidCount ?? 0,
    cancelAtCycleEnd: row.cancelAtCycleEnd ?? false,
    createdAt: row.createdAt,
  };
}

function pricingOf(settings: Doc<"billingSettings">) {
  return {
    currency: settings.currency,
    gstPercent: settings.gstPercent,
    extraAgentListMicros: settings.extraAgentListMicros,
    extraAgentPriceMicros: settings.extraAgentPriceMicros,
    minTopUpMicros: settings.minTopUpMicros,
    trialDays: settings.trialDays,
    graceDays: settings.graceDays,
  };
}

// ---------------------------------------------------------------------------
// The workspace's own view
// ---------------------------------------------------------------------------

/**
 * Just enough for the shell: whether to lock the dashboard, and whether to
 * show a banner above it. On every page, so it reads no seats and no plans.
 */
export const access = query({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    const settings = await billingSettings(ctx);
    if (!settings) return null;
    const account = await accountFor(ctx, args.workspaceId);
    const subscription = await liveSubscription(ctx, account);
    const wallet = await walletFor(ctx, args.workspaceId);
    const threshold =
      account?.lowBalanceThresholdMicros ?? settings.defaultThresholdMicros;
    return {
      access: accessOf({
        settings,
        account,
        subscription,
        workspaceCreatedAt: workspace.createdAt,
        now: args.now,
      }),
      currency: settings.currency,
      balanceMicros: wallet?.balanceMicros ?? 0,
      lowBalance: (wallet?.balanceMicros ?? 0) < threshold,
      rechargeInFlight: account?.rechargeInFlight !== undefined,
    };
  },
});

/** The Plan tab: where the account stands, and everything the picker needs. */
export const overview = query({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const standing = await standingOf(ctx, workspace, args.now);
    const { settings, account, plan, subscription } = standing;
    if (!settings) {
      return { enabled: false as const, isOwner: principal.role !== "member" };
    }

    const pending = account?.pendingSubscriptionId
      ? await ctx.db.get("billingSubscriptions", account.pendingSubscriptionId)
      : null;
    const plans = await allPlans(ctx);
    const config = razorpayConfig();

    const pricing = {
      discountPercent: account?.discountPercent,
      extraAgentPriceMicros: account?.extraAgentPriceMicros,
    };
    const extraAgents = account?.extraAgents ?? 0;
    const contact = billingContact(account, workspace);

    return {
      enabled: true as const,
      isOwner: principal.role !== "member",
      isAdmin: principal.role === "admin",
      razorpayKeyId: config?.keyId ?? null,
      pricing: pricingOf(settings),
      access: standing.access,
      plan,
      // On sale, plus whatever this account is on even if it is now hidden.
      plans: plans.filter(
        (row) => row.status === "active" || row._id === plan?._id
      ),
      account: {
        mode: account?.mode ?? ("trial" as const),
        extraAgents,
        discountPercent: account?.discountPercent ?? 0,
        extraAgentPriceMicros: account?.extraAgentPriceMicros ?? null,
        trialEndsAt: standing.access.state === "trial" ? standing.access.until : null,
        manualPaidThrough: account?.manualPaidThrough ?? null,
        billingName: contact.name,
        gstin: account?.gstin ?? "",
        billingEmail: contact.email,
        billingPhone: contact.phone,
        billingAddress: account?.billingAddress ?? workspace.address ?? "",
        billingState: account?.billingState ?? "",
      },
      accountPricing: pricing,
      subscription: subscriptionView(subscription),
      pending: pending && pending.status === "created" ? subscriptionView(pending) : null,
      // What the account's plan and extras come to at today's prices —
      // what the next checkout would be created at.
      quote: plan
        ? quote({ plan, extraAgents, settings, account: pricing })
        : null,
      used: standing.used,
      seats: standing.seats,
      // Where a checkout made now would start charging — the date the page
      // promises before Razorpay is asked.
      nextStartAt: nextStartAt({
        live: subscription && isLiveStatus(subscription.status) ? subscription : null,
        access: standing.access,
        now: args.now,
      }),
    };
  },
});

/** Every platform-fee and wallet payment, newest first. */
export const payments = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("billingPayments")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/** Who the tax invoice is made out to. The company's own call. */
export const updateBillingProfile = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    billingName: v.string(),
    gstin: v.string(),
    billingEmail: v.string(),
    billingPhone: v.string(),
    billingAddress: v.string(),
    billingState: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const gstin = args.gstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) {
      throw new Error("That GSTIN is not 15 characters in the right pattern.");
    }
    const email = args.billingEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a billing email address.");
    }
    const phone = args.billingPhone.replace(/[\s-]/g, "");
    if (phone && !/^\+?[0-9]{8,15}$/.test(phone)) {
      throw new Error("Enter a phone number with its country code, e.g. +919876543210.");
    }

    const account = await ensureAccount(ctx, args.workspaceId);
    await ctx.db.patch("billingAccounts", account._id, {
      billingName: args.billingName.trim() || undefined,
      gstin: gstin || undefined,
      billingEmail: email || undefined,
      billingPhone: phone || undefined,
      billingAddress: args.billingAddress.trim() || undefined,
      billingState: args.billingState.trim() || undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// The platform's view — administrators only
// ---------------------------------------------------------------------------

/** Every account: plan, standing, seats, what it pays and what it holds. */
export const adminAccounts = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const settings = await billingSettings(ctx);
    const workspaces = await ctx.db.query("workspaces").order("desc").take(1000);

    const rows = await Promise.all(
      workspaces.map(async (workspace) => {
        const standing = await standingOf(ctx, workspace, args.now, { settings });
        const { account, plan, subscription } = standing;
        const wallet = await walletFor(ctx, workspace._id);
        const monthly: Quote | null =
          settings && plan
            ? quote({
                plan,
                extraAgents: account?.extraAgents ?? 0,
                settings,
                account,
              })
            : null;
        return {
          workspaceId: workspace._id,
          name: workspace.name,
          slug: workspace.slug,
          status: workspace.status,
          logoSrc: await logoSrcFor(ctx, workspace),
          access: standing.access,
          mode: account?.mode ?? ("trial" as const),
          planId: plan?._id ?? null,
          /** Set only when the account was put on a plan, not trialling one. */
          ownPlanId: account?.planId ?? null,
          planName: plan?.name ?? null,
          extraAgents: account?.extraAgents ?? 0,
          discountPercent: account?.discountPercent ?? 0,
          extraAgentPriceMicros: account?.extraAgentPriceMicros ?? null,
          trialEndsAt:
            standing.access.state === "trial"
              ? standing.access.until
              : (account?.trialEndsAt ?? null),
          manualPaidThrough: account?.manualPaidThrough ?? null,
          adminNote: account?.adminNote ?? "",
          subscription: subscriptionView(subscription),
          // What it is charged: the live subscription's fixed amount, or what
          // it would be charged at today's prices.
          monthlyMicros: subscription && LIVE.has(subscription.status)
            ? subscription.totalMicros
            : (monthly?.totalMicros ?? null),
          used: standing.used,
          seats: standing.seats,
          balanceMicros: wallet?.balanceMicros ?? 0,
          autoRecharge:
            account?.autoRecharge.enabled === true &&
            account.autoRecharge.tokenStatus === "confirmed",
        };
      })
    );

    return {
      enabled: settings !== null,
      currency: settings?.currency ?? "INR",
      gstPercent: settings?.gstPercent ?? null,
      extraAgentPriceMicros: settings?.extraAgentPriceMicros ?? null,
      plans: settings ? await allPlans(ctx) : [],
      accounts: rows,
    };
  },
});

/**
 * An administrator's arrangement for one account: its plan and extra agents,
 * its discount, how long its trial runs, or a manual billing period.
 *
 * Only the fields passed change; `null` clears an override. Moving an
 * account to manual billing is refused while Razorpay is still charging it —
 * it would be billed twice — so cancel the subscription first.
 */
export const adminUpdateAccount = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    planId: v.optional(v.id("billingPlans")),
    extraAgents: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("trial"), v.literal("manual"))),
    trialEndsAt: v.optional(v.number()),
    manualPaidThrough: v.optional(v.union(v.number(), v.null())),
    discountPercent: v.optional(v.number()),
    extraAgentPrice: v.optional(v.union(v.number(), v.null())),
    adminNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!(await billingSettings(ctx))) throw new Error("Switch billing on first.");
    const account = await ensureAccount(ctx, args.workspaceId);
    const live = await liveSubscription(ctx, account);
    // Retrying and halted count too: either can still take a payment, and
    // an account relabelled underneath one would be billed twice.
    const charging = live !== null && CHARGEABLE.has(live.status);

    const patch: Partial<Doc<"billingAccounts">> = { updatedAt: Date.now() };
    if (args.planId !== undefined) {
      if (!(await ctx.db.get("billingPlans", args.planId))) {
        throw new Error("Plan not found");
      }
      patch.planId = args.planId;
    }
    if (args.extraAgents !== undefined) {
      if (!Number.isInteger(args.extraAgents) || args.extraAgents < 0 || args.extraAgents > MAX_EXTRA_AGENTS) {
        throw new Error(`Extra agents must be a whole number from 0 to ${MAX_EXTRA_AGENTS}.`);
      }
      patch.extraAgents = args.extraAgents;
    }
    if (args.mode !== undefined && charging) {
      throw new Error(
        args.mode === "manual"
          ? "Razorpay is still charging this account. Cancel its subscription before billing it by arrangement."
          : "Razorpay is still charging this account, so it is not on a trial. Cancel its subscription first."
      );
    }
    if (args.mode !== undefined) {
      patch.mode = args.mode;
    } else if (charging) {
      patch.mode = "razorpay";
    }
    if (args.trialEndsAt !== undefined) patch.trialEndsAt = args.trialEndsAt;
    if (args.manualPaidThrough !== undefined) {
      patch.manualPaidThrough = args.manualPaidThrough ?? undefined;
    }
    if (args.discountPercent !== undefined) {
      if (!Number.isFinite(args.discountPercent) || args.discountPercent < 0 || args.discountPercent > 100) {
        throw new Error("A discount is a percentage from 0 to 100.");
      }
      patch.discountPercent = args.discountPercent || undefined;
    }
    if (args.extraAgentPrice !== undefined) {
      if (args.extraAgentPrice !== null && (!Number.isFinite(args.extraAgentPrice) || args.extraAgentPrice < 0)) {
        throw new Error("An extra agent's price must be zero or more.");
      }
      patch.extraAgentPriceMicros =
        args.extraAgentPrice === null ? undefined : toMicros(args.extraAgentPrice);
    }
    if (args.adminNote !== undefined) {
      patch.adminNote = args.adminNote.trim() || undefined;
    }
    await ctx.db.patch("billingAccounts", account._id, patch);
    return null;
  },
});

// ---------------------------------------------------------------------------
// For convex/razorpay.ts
// ---------------------------------------------------------------------------

/**
 * Everything a checkout needs, once the caller is known to be the company:
 * the plan, the price, and when the new subscription should start charging.
 *
 * A new subscription starts where the one before it is paid up to — the end
 * of a trial, or of the month already paid — so changing plan or adding an
 * agent never charges twice for the same days. The new limits apply as soon
 * as it is authorised.
 */
export const checkoutContext = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    planId: v.id("billingPlans"),
    extraAgents: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const standing = await standingOf(ctx, workspace, args.now);
    const { settings, account, subscription } = standing;
    if (!settings) throw new Error("Billing is not switched on yet.");
    if (account?.mode === "manual") {
      throw new Error(
        "Your plan is billed by arrangement with us. Get in touch to change it."
      );
    }

    // A hidden plan is still sold to whoever is on it — by choice, or as the
    // plan their trial runs on.
    const plan = await ctx.db.get("billingPlans", args.planId);
    if (!plan || (plan.status !== "active" && plan._id !== standing.plan?._id)) {
      throw new Error("That plan is not available.");
    }
    if (!Number.isInteger(args.extraAgents) || args.extraAgents < 0 || args.extraAgents > MAX_EXTRA_AGENTS) {
      throw new Error(`Extra agents must be a whole number from 0 to ${MAX_EXTRA_AGENTS}.`);
    }

    const live = subscription && LIVE.has(subscription.status) ? subscription : null;
    if (
      live &&
      !live.cancelAtCycleEnd &&
      live.planId === plan._id &&
      live.extraAgents === args.extraAgents
    ) {
      throw new Error("That is the plan you are already on.");
    }

    const priced = quote({
      plan,
      extraAgents: args.extraAgents,
      settings,
      account,
    });
    if (toPaise(priced.totalMicros) < 100) {
      throw new Error("A subscription must come to at least ₹1 a month.");
    }

    const startAt = nextStartAt({ live, access: standing.access, now: args.now });

    const razorpayPlanKey = `${plan.code}:${args.extraAgents}:${toPaise(priced.totalMicros)}:${settings.currency}`;
    const cached = await ctx.db
      .query("razorpayPlans")
      .withIndex("by_key", (q) => q.eq("key", razorpayPlanKey))
      .unique();

    const pending = account?.pendingSubscriptionId
      ? await ctx.db.get("billingSubscriptions", account.pendingSubscriptionId)
      : null;

    return {
      workspaceName: workspace.name,
      plan: { _id: plan._id, code: plan.code, name: plan.name },
      quote: priced,
      currency: settings.currency,
      startAt,
      replacesId: live?._id ?? null,
      razorpayPlanKey,
      razorpayPlanId: cached?.razorpayPlanId ?? null,
      // An unfinished checkout from before, to be withdrawn at Razorpay.
      abandonedRazorpayId:
        pending && pending.status === "created" ? pending.razorpaySubscriptionId : null,
      prefill: (({ name, email, phone }) => ({ name, email, contact: phone }))(
        billingContact(account, workspace)
      ),
    };
  },
});

export const rememberRazorpayPlan = internalMutation({
  args: { key: v.string(), razorpayPlanId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("razorpayPlans")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) return existing.razorpayPlanId;
    await ctx.db.insert("razorpayPlans", {
      key: args.key,
      razorpayPlanId: args.razorpayPlanId,
      createdAt: Date.now(),
    });
    return args.razorpayPlanId;
  },
});

/** A subscription created at Razorpay, waiting for the company to authorise it. */
export const recordCreated = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    razorpaySubscriptionId: v.string(),
    razorpayPlanId: v.string(),
    planId: v.id("billingPlans"),
    extraAgents: v.number(),
    subtotalMicros: v.number(),
    gstMicros: v.number(),
    totalMicros: v.number(),
    currency: v.string(),
    startAt: v.optional(v.number()),
    shortUrl: v.optional(v.string()),
    replacesId: v.optional(v.id("billingSubscriptions")),
  },
  handler: async (ctx, args) => {
    const account = await ensureAccount(ctx, args.workspaceId);
    const now = Date.now();

    // The checkout it supersedes is withdrawn at Razorpay by the caller;
    // here it simply stops being the one the page offers.
    if (account.pendingSubscriptionId) {
      const previous = await ctx.db.get(
        "billingSubscriptions",
        account.pendingSubscriptionId
      );
      if (previous && previous.status === "created") {
        await ctx.db.patch("billingSubscriptions", previous._id, {
          status: "cancelled",
          updatedAt: now,
        });
      }
    }

    const subscriptionId = await ctx.db.insert("billingSubscriptions", {
      ...args,
      status: "created",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("billingAccounts", account._id, {
      pendingSubscriptionId: subscriptionId,
      updatedAt: now,
    });
    return subscriptionId;
  },
});

/**
 * The subscription Checkout just authorised, if it is this workspace's own.
 * The Razorpay id is checked against what we stored, so a browser cannot
 * confirm somebody else's.
 */
export const confirmContext = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    razorpaySubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const row = await ctx.db
      .query("billingSubscriptions")
      .withIndex("by_razorpay_id", (q) =>
        q.eq("razorpaySubscriptionId", args.razorpaySubscriptionId)
      )
      .unique();
    if (!row || row.workspaceId !== args.workspaceId) return null;
    return { razorpaySubscriptionId: row.razorpaySubscriptionId };
  },
});

/** The subscription a cancel is about. The company, or an administrator. */
export const cancelContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const account = await accountFor(ctx, args.workspaceId);
    const live = await liveSubscription(ctx, account);
    if (!live) return null;
    return {
      subscriptionId: live._id,
      razorpaySubscriptionId: live.razorpaySubscriptionId,
      status: live.status,
      charged: (live.paidCount ?? 0) > 0,
    };
  },
});

/** The Razorpay ids worth reading back: the live subscription and a pending one. */
export const refreshContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const account = await accountFor(ctx, args.workspaceId);
    const ids: string[] = [];
    for (const id of [account?.subscriptionId, account?.pendingSubscriptionId]) {
      if (!id) continue;
      const row = await ctx.db.get("billingSubscriptions", id);
      if (row) ids.push(row.razorpaySubscriptionId);
    }
    return ids;
  },
});

export const markCancelAtCycleEnd = internalMutation({
  args: { subscriptionId: v.id("billingSubscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.patch("billingSubscriptions", args.subscriptionId, {
      cancelAtCycleEnd: true,
      updatedAt: Date.now(),
    });
    return null;
  },
});
