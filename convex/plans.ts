// What the platform sells, and on what terms — administrators only.
//
// Plans, the price of an extra agent, GST, the trial and the grace period.
// Nothing here reprices a subscription that already exists: a Razorpay plan
// has a fixed amount, so a new price reaches an account the next time it
// checks out. What changes at once is what the plan cards show and — for a
// plan's included agents — the limits every account on it is held to.

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin, requireWorkspace } from "./lib/auth";
import { allPlans, billingSettings, billingTermsFor } from "./lib/account";
import { toMicros, workspaceCurrency } from "./lib/billing";
import {
  DEFAULT_PLANS,
  DEFAULT_SETTINGS,
  DEFAULT_CURRENCY_TERMS,
  PLATFORM_CURRENCY,
  allCurrencyTerms,
  planCurrency,
} from "./lib/plans";
import { isValidCurrency } from "./lib/regional";
import { slugify } from "./lib/shared";

/** A price above this is a slipped digit, not a monthly fee. */
const MAX_PRICE = 10_000_000;

function money(label: string, amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ConvexError(`${label} must be zero or more.`);
  }
  if (amount > MAX_PRICE) throw new ConvexError(`${label} looks too high.`);
  return toMicros(amount);
}

function wholeNumber(label: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ConvexError(`${label} must be a whole number from 0 to ${max}.`);
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

    return {
      settings,
      terms: settings ? allCurrencyTerms(settings) : [],
      plans: plans.map((plan) => ({
        ...plan,
        currency: planCurrency(plan),
        accounts: counts.get(plan._id) ?? 0,
      })),
    };
  },
});

/**
 * The currency money is shown in: a workspace's own account currency, or the
 * default a new account starts on.
 */
export const currency = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args): Promise<string> => {
    if (args.workspaceId) {
      await requireWorkspace(ctx, args.workspaceId);
      return await workspaceCurrency(ctx, args.workspaceId);
    }
    const settings = await billingSettings(ctx);
    return settings?.currency ?? PLATFORM_CURRENCY;
  },
});

/** The plans a workspace may choose between, and what an extra agent costs. */
export const catalogue = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const terms = await billingTermsFor(ctx, args.workspaceId);
    if (!terms) return null;
    const { settings } = terms;
    const plans = (await allPlans(ctx)).filter(
      (plan) => planCurrency(plan) === settings.currency
    );
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

/**
 * The terms. The trial and grace every account shares and the default
 * currency, and — merged by currency with what is saved — each currency's
 * trial plan, GST, extra agent price, wallet minimums and welcome bonus.
 * Amounts arrive in whole units.
 */
export const updateSettings = mutation({
  args: {
    trialDays: v.optional(v.number()),
    graceDays: v.optional(v.number()),
    currency: v.optional(v.string()),
    terms: v.optional(
      v.array(
        v.object({
          currency: v.string(),
          trialPlanId: v.optional(v.id("billingPlans")),
          gstPercent: v.number(),
          extraAgentList: v.number(),
          extraAgentPrice: v.number(),
          minTopUp: v.number(),
          defaultThreshold: v.number(),
          welcomeBonus: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const settings = await billingSettings(ctx);
    if (!settings) throw new ConvexError("Switch billing on first.");

    const terms = new Map(
      allCurrencyTerms(settings).map((entry) => [entry.currency, entry])
    );
    const bonus = new Map(
      (settings.welcomeBonus ?? DEFAULT_SETTINGS.welcomeBonus).map((entry) => [
        entry.currency,
        entry.amountMicros,
      ])
    );
    for (const entry of args.terms ?? []) {
      const code = entry.currency.trim().toUpperCase();
      if (!isValidCurrency(code))
        throw new ConvexError(`${entry.currency} is not a currency code.`);
      if (
        !Number.isFinite(entry.gstPercent) ||
        entry.gstPercent < 0 ||
        entry.gstPercent > 50
      ) {
        throw new ConvexError(`${code} GST must be a percentage from 0 to 50.`);
      }
      if (entry.trialPlanId) {
        const plan = await ctx.db.get("billingPlans", entry.trialPlanId);
        if (!plan) throw new ConvexError("That plan no longer exists.");
        if (planCurrency(plan) !== code) {
          throw new ConvexError(
            `The ${code} trial plan has to be one of the ${code} plans.`
          );
        }
      }
      const extraAgentPriceMicros = money(
        `The ${code} extra agent price`,
        entry.extraAgentPrice
      );
      const minTopUpMicros = money(
        `The ${code} minimum top-up`,
        entry.minTopUp
      );
      if (minTopUpMicros < toMicros(1)) {
        throw new ConvexError(
          `The ${code} minimum top-up must be at least 1 — Razorpay's floor.`
        );
      }
      terms.set(code, {
        currency: code,
        trialPlanId: entry.trialPlanId,
        gstPercent: entry.gstPercent,
        extraAgentPriceMicros,
        // A list price below the price would show a discount that is not one.
        extraAgentListMicros: Math.max(
          money(`The ${code} extra agent list price`, entry.extraAgentList),
          extraAgentPriceMicros
        ),
        minTopUpMicros,
        defaultThresholdMicros: money(
          `The ${code} low-balance line`,
          entry.defaultThreshold
        ),
      });
      bonus.set(code, money(`The ${code} welcome bonus`, entry.welcomeBonus));
    }

    const currency = (args.currency ?? settings.currency).trim().toUpperCase();
    const base = terms.get(currency);
    if (!base)
      throw new ConvexError(
        `Add terms for ${currency} before making it the default.`
      );

    // Accounts made before currencies were per account follow the default;
    // pin them to it so a new default does not move their wallets.
    if (currency !== settings.currency) {
      const accounts = await ctx.db.query("billingAccounts").take(5000);
      for (const account of accounts) {
        if (!account.currency) {
          await ctx.db.patch("billingAccounts", account._id, {
            currency: settings.currency,
          });
        }
      }
    }

    await ctx.db.patch("billingSettings", settings._id, {
      ...base,
      trialPlanId: base.trialPlanId,
      currencies: [...terms.values()].filter(
        (entry) => entry.currency !== currency
      ),
      welcomeBonus: [...bonus.entries()].map(([code, amountMicros]) => ({
        currency: code,
        amountMicros,
      })),
      trialDays:
        args.trialDays === undefined
          ? settings.trialDays
          : wholeNumber("Trial days", args.trialDays, 365),
      graceDays:
        args.graceDays === undefined
          ? settings.graceDays
          : wholeNumber("Grace days", args.graceDays, 60),
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
  args: {
    planId: v.optional(v.id("billingPlans")),
    currency: v.optional(v.string()),
    ...planFields,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("A plan needs a name.");

    const priceMicros = money("The price", args.price);
    const fields = {
      name,
      description: args.description?.trim() || undefined,
      priceMicros,
      listPriceMicros: Math.max(
        money("The list price", args.listPrice),
        priceMicros
      ),
      includedAiAgents: wholeNumber(
        "Custom agents",
        args.includedAiAgents,
        1000
      ),
      includedHumanAgents: wholeNumber(
        "Human agents",
        args.includedHumanAgents,
        1000
      ),
      features: args.features
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20),
      highlighted: args.highlighted,
      status: args.status,
      updatedAt: Date.now(),
    };

    const existing = args.planId
      ? await ctx.db.get("billingPlans", args.planId)
      : null;
    const currency = existing
      ? planCurrency(existing)
      : (args.currency ?? PLATFORM_CURRENCY).trim().toUpperCase();
    if (!isValidCurrency(currency))
      throw new ConvexError("Pick a currency for the plan.");

    // One card is "most popular" at most, in each currency.
    if (fields.highlighted) {
      for (const other of await allPlans(ctx)) {
        if (
          other._id !== args.planId &&
          other.highlighted &&
          planCurrency(other) === currency
        ) {
          await ctx.db.patch("billingPlans", other._id, { highlighted: false });
        }
      }
    }

    if (args.planId) {
      const plan = await ctx.db.get("billingPlans", args.planId);
      if (!plan) throw new ConvexError("Plan not found");
      await ctx.db.patch("billingPlans", args.planId, fields);
      return args.planId;
    }

    const plans = await allPlans(ctx);
    const base = slugify(name) || "plan";
    const taken = (code: string) =>
      plans.some(
        (plan) => plan.code === code && planCurrency(plan) === currency
      );
    let code = base;
    for (let n = 2; taken(code); n++) {
      code = `${base}-${n}`;
    }
    return await ctx.db.insert("billingPlans", {
      ...fields,
      currency,
      code,
      sortOrder:
        plans.reduce((max, plan) => Math.max(max, plan.sortOrder), -1) + 1,
      createdAt: fields.updatedAt,
    });
  },
});

/** Move a plan one place left or right on the pricing page. */
export const movePlan = mutation({
  args: {
    planId: v.id("billingPlans"),
    direction: v.union(v.literal(-1), v.literal(1)),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const moving = await ctx.db.get("billingPlans", args.planId);
    if (!moving) return null;
    const plans = (await allPlans(ctx)).filter(
      (plan) => planCurrency(plan) === planCurrency(moving)
    );
    const index = plans.findIndex((plan) => plan._id === args.planId);
    const other = plans[index + args.direction];
    if (index < 0 || !other) return null;
    const here = plans[index];
    // Written as positions rather than swapped values, so two plans that
    // shared an order number come apart.
    await ctx.db.patch("billingPlans", here._id, {
      sortOrder: index + args.direction,
    });
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
      throw new ConvexError(
        inUse || subscribed
          ? "Accounts are on this plan. Hide it instead, so nobody new can choose it."
          : "Trials run on this plan. Pick another trial plan first."
      );
    }
    await ctx.db.delete("billingPlans", args.planId);
    return null;
  },
});

/** USD prices for the plans a fresh catalogue starts with, by plan code. */
const USD_PRICES: Record<string, { price: number; list: number }> = {
  starter: { price: 49, list: 49 },
  growth: { price: 99, list: 119 },
  scale: { price: 199, list: 249 },
};

/**
 * Mark the plans made before currencies as INR and add a USD copy of each,
 * with USD terms if there are none. Safe to run again: a plan that already
 * has its USD twin is left alone. `bunx convex run plans:addUsdPlans`
 */
export const addUsdPlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const plans = await allPlans(ctx);
    for (const plan of plans) {
      if (!plan.currency) {
        await ctx.db.patch("billingPlans", plan._id, {
          currency: PLATFORM_CURRENCY,
        });
      }
    }
    const inr = plans.filter(
      (plan) => planCurrency(plan) === PLATFORM_CURRENCY
    );
    const now = Date.now();
    let added = 0;
    for (const plan of inr) {
      const twin = plans.find(
        (other) => other.code === plan.code && other.currency === "USD"
      );
      if (twin) continue;
      const usd = USD_PRICES[plan.code] ?? {
        price: Math.round(plan.priceMicros / 100 / 1_000_000),
        list: Math.round(plan.listPriceMicros / 100 / 1_000_000),
      };
      await ctx.db.insert("billingPlans", {
        code: plan.code,
        currency: "USD",
        name: plan.name,
        description: plan.description,
        listPriceMicros: toMicros(Math.max(usd.list, usd.price)),
        priceMicros: toMicros(usd.price),
        includedAiAgents: plan.includedAiAgents,
        includedHumanAgents: plan.includedHumanAgents,
        features: plan.features,
        highlighted: plan.highlighted,
        status: plan.status,
        sortOrder: plan.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }

    const settings = await billingSettings(ctx);
    if (
      settings &&
      !settings.currencies?.some((entry) => entry.currency === "USD")
    ) {
      await ctx.db.patch("billingSettings", settings._id, {
        currencies: [...(settings.currencies ?? []), ...DEFAULT_CURRENCY_TERMS],
        updatedAt: now,
      });
    }
    return { added };
  },
});
