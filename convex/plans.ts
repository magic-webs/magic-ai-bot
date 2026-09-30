// What the platform sells, and on what terms — administrators only.
//
// Plans, the price of an extra agent, GST, the trial and the grace period.
// Nothing here reprices a subscription that already exists: a Razorpay plan
// has a fixed amount, so a new price reaches an account the next time it
// checks out. What changes at once is what the plan cards show and — for a
// plan's included agents — the limits every account on it is held to.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireWorkspace } from "./lib/auth";
import { allPlans, billingSettings } from "./lib/account";
import { toMicros } from "./lib/billing";
import { DEFAULT_PLANS, DEFAULT_SETTINGS } from "./lib/plans";
import { razorpayConfig } from "./lib/razorpay";
import { slugify } from "./lib/shared";

/** A price above this is a slipped digit, not a monthly fee. */
const MAX_PRICE = 10_000_000;

function money(label: string, amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be zero or more.`);
  }
  if (amount > MAX_PRICE) throw new Error(`${label} looks too high.`);
  return toMicros(amount);
}

function wholeNumber(label: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a whole number from 0 to ${max}.`);
  }
  return value;
}

/** The catalogue as an administrator edits it. */
export const adminCatalogue = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await billingSettings(ctx);
    const plans = await allPlans(ctx);

    // How many accounts each plan holds, so a plan in use is hidden rather
    // than deleted.
    const accounts = await ctx.db.query("billingAccounts").take(5000);
    const counts = new Map<string, number>();
    for (const account of accounts) {
      if (!account.planId) continue;
      counts.set(account.planId, (counts.get(account.planId) ?? 0) + 1);
    }

    // Which keys the deployment holds — never the keys themselves.
    const keyId = razorpayConfig()?.keyId ?? null;
    return {
      settings,
      plans: plans.map((plan) => ({ ...plan, accounts: counts.get(plan._id) ?? 0 })),
      razorpay: {
        mode: keyId ? (keyId.startsWith("rzp_live_") ? "live" : "test") : null,
        webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim()),
      },
    };
  },
});

/** The plans a workspace may choose between, and what an extra agent costs. */
export const catalogue = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const settings = await billingSettings(ctx);
    if (!settings) return null;
    const plans = await allPlans(ctx);
    return {
      currency: settings.currency,
      gstPercent: settings.gstPercent,
      extraAgentListMicros: settings.extraAgentListMicros,
      extraAgentPriceMicros: settings.extraAgentPriceMicros,
      plans: plans.filter((plan) => plan.status === "active"),
    };
  },
});

/**
 * Switch billing on: the default terms, the three starting plans, and the
 * moment every existing workspace's trial is counted from.
 *
 * Idempotent — a second call leaves what an administrator has since edited.
 */
export const enable = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();

    let plans = await allPlans(ctx);
    if (plans.length === 0) {
      for (const [index, plan] of DEFAULT_PLANS.entries()) {
        await ctx.db.insert("billingPlans", {
          ...plan,
          status: "active",
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        });
      }
      plans = await allPlans(ctx);
    }

    const existing = await billingSettings(ctx);
    if (existing) return existing._id;
    return await ctx.db.insert("billingSettings", {
      ...DEFAULT_SETTINGS,
      trialPlanId: plans[0]?._id,
      launchedAt: now,
      updatedAt: now,
    });
  },
});

/** The terms. Amounts arrive in whole rupees, the way they are typed. */
export const updateSettings = mutation({
  args: {
    gstPercent: v.number(),
    trialDays: v.number(),
    graceDays: v.number(),
    extraAgentList: v.number(),
    extraAgentPrice: v.number(),
    minTopUp: v.number(),
    defaultThreshold: v.number(),
    trialPlanId: v.optional(v.id("billingPlans")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const settings = await billingSettings(ctx);
    if (!settings) throw new Error("Switch billing on first.");

    if (!Number.isFinite(args.gstPercent) || args.gstPercent < 0 || args.gstPercent > 50) {
      throw new Error("GST must be a percentage from 0 to 50.");
    }
    const extraAgentPriceMicros = money("An extra agent's price", args.extraAgentPrice);
    const extraAgentListMicros = money("An extra agent's list price", args.extraAgentList);
    const minTopUpMicros = money("The minimum top-up", args.minTopUp);
    if (minTopUpMicros < toMicros(1)) {
      throw new Error("The minimum top-up must be at least ₹1 — Razorpay's floor.");
    }
    if (args.trialPlanId && !(await ctx.db.get("billingPlans", args.trialPlanId))) {
      throw new Error("That plan no longer exists.");
    }

    await ctx.db.patch("billingSettings", settings._id, {
      gstPercent: args.gstPercent,
      trialDays: wholeNumber("Trial days", args.trialDays, 365),
      graceDays: wholeNumber("Grace days", args.graceDays, 60),
      extraAgentPriceMicros,
      // A list price below the price would show a discount that is not one.
      extraAgentListMicros: Math.max(extraAgentListMicros, extraAgentPriceMicros),
      minTopUpMicros,
      defaultThresholdMicros: money("The default low-balance line", args.defaultThreshold),
      trialPlanId: args.trialPlanId ?? settings.trialPlanId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

const planFields = {
  name: v.string(),
  description: v.optional(v.string()),
  listPrice: v.number(),
  price: v.number(),
  includedAiAgents: v.number(),
  includedHumanAgents: v.number(),
  features: v.array(v.string()),
  highlighted: v.boolean(),
  status: v.union(v.literal("active"), v.literal("hidden")),
};

/** Create a plan, or edit one when `planId` is given. */
export const savePlan = mutation({
  args: { planId: v.optional(v.id("billingPlans")), ...planFields },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("A plan needs a name.");

    const priceMicros = money("The price", args.price);
    const fields = {
      name,
      description: args.description?.trim() || undefined,
      priceMicros,
      listPriceMicros: Math.max(money("The list price", args.listPrice), priceMicros),
      includedAiAgents: wholeNumber("Custom agents", args.includedAiAgents, 1000),
      includedHumanAgents: wholeNumber("Human agents", args.includedHumanAgents, 1000),
      features: args.features.map((line) => line.trim()).filter(Boolean).slice(0, 20),
      highlighted: args.highlighted,
      status: args.status,
      updatedAt: Date.now(),
    };

    // One card is "most popular" at most.
    if (fields.highlighted) {
      for (const other of await allPlans(ctx)) {
        if (other._id !== args.planId && other.highlighted) {
          await ctx.db.patch("billingPlans", other._id, { highlighted: false });
        }
      }
    }

    if (args.planId) {
      const plan = await ctx.db.get("billingPlans", args.planId);
      if (!plan) throw new Error("Plan not found");
      await ctx.db.patch("billingPlans", args.planId, fields);
      return args.planId;
    }

    const plans = await allPlans(ctx);
    const base = slugify(name) || "plan";
    let code = base;
    for (let n = 2; plans.some((plan) => plan.code === code); n++) {
      code = `${base}-${n}`;
    }
    return await ctx.db.insert("billingPlans", {
      ...fields,
      code,
      sortOrder: plans.reduce((max, plan) => Math.max(max, plan.sortOrder), -1) + 1,
      createdAt: fields.updatedAt,
    });
  },
});

/** Move a plan one place left or right on the pricing page. */
export const movePlan = mutation({
  args: { planId: v.id("billingPlans"), direction: v.union(v.literal(-1), v.literal(1)) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const plans = await allPlans(ctx);
    const index = plans.findIndex((plan) => plan._id === args.planId);
    const other = plans[index + args.direction];
    if (index < 0 || !other) return null;
    const here = plans[index];
    // Written as positions rather than swapped values, so two plans that
    // shared an order number come apart.
    await ctx.db.patch("billingPlans", here._id, { sortOrder: index + args.direction });
    await ctx.db.patch("billingPlans", other._id, { sortOrder: index });
    return null;
  },
});

/**
 * Delete a plan nobody is on. One that holds accounts is hidden instead —
 * the accounts keep it, and nobody new can choose it.
 */
export const removePlan = mutation({
  args: { planId: v.id("billingPlans") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const inUse = await ctx.db
      .query("billingAccounts")
      .filter((q) => q.eq(q.field("planId"), args.planId))
      .first();
    // A subscription that can still be authorised or charged would bring the
    // plan back as the account's the moment it did.
    const subscribed = await ctx.db
      .query("billingSubscriptions")
      .filter((q) =>
        q.and(
          q.eq(q.field("planId"), args.planId),
          q.neq(q.field("status"), "cancelled"),
          q.neq(q.field("status"), "completed"),
          q.neq(q.field("status"), "expired")
        )
      )
      .first();
    const settings = await billingSettings(ctx);
    if (inUse || subscribed || settings?.trialPlanId === args.planId) {
      throw new Error(
        inUse || subscribed
          ? "Accounts are on this plan. Hide it instead, so nobody new can choose it."
          : "Trials run on this plan. Pick another trial plan first."
      );
    }
    await ctx.db.delete("billingPlans", args.planId);
    return null;
  },
});
