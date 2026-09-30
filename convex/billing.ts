import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { messageCategory } from "./schema";
import { requireAdmin, requireWorkspace } from "./lib/auth";
import {
  MESSAGE_CATEGORIES,
  defaultRateCard,
  effectiveRates,
  toMicros,
  workspaceRateCard,
  type MessageCategory,
} from "./lib/billing";
import { charge } from "./lib/charge";
import { isValidCurrency } from "./lib/regional";
import { logoSrcFor } from "./lib/branding";

const DAY_MS = 24 * 60 * 60 * 1000;
// Summaries read rows, not a rollup, so one read is capped — the same trade
// usage.ts makes, and the page says so when it is hit.
const SCAN_CAP = 20_000;
// No single message should cost more than this in any currency; a rate above
// it is a slipped decimal point, not a price.
const MAX_RATE = 1_000_000;

const sourceValidator = v.union(
  v.literal("agent"),
  v.literal("human"),
  v.literal("follow_up"),
  v.literal("campaign"),
  v.literal("system"),
  v.literal("notification")
);

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Charge messages the WhatsApp senders have just delivered.
 *
 * Takes a list because one agent reply can go out as several WhatsApp
 * messages — a long answer is split — and each is a message the account is
 * billed for. One mutation for the lot keeps it one round trip.
 */
export const recordSent = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
    to: v.string(),
    source: sourceValidator,
    templateName: v.optional(v.string()),
    messages: v.array(
      v.object({
        category: messageCategory,
        preview: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { messages, ...shared } = args;
    for (const message of messages) {
      await charge(ctx, { ...shared, ...message });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type RateView = {
  scope: "workspace" | "default";
  currency: string;
  serviceMicros: number;
  utilityMicros: number;
  marketingMicros: number;
  authenticationMicros: number;
  updatedAt: number;
};

function rateView(
  card: Doc<"billingRates">,
  scope: RateView["scope"]
): RateView {
  return {
    scope,
    currency: card.currency,
    serviceMicros: card.serviceMicros,
    utilityMicros: card.utilityMicros,
    marketingMicros: card.marketingMicros,
    authenticationMicros: card.authenticationMicros,
    updatedAt: card.updatedAt,
  };
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** The window a summary covers, in whole UTC days ending today. */
function windowFor(daysArg: number, now: number) {
  const days = Math.max(1, Math.min(Math.floor(daysArg), 90));
  const today = new Date(now);
  const todayStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const windowStart = todayStart - (days - 1) * DAY_MS;
  return { days, windowStart, previousStart: windowStart - days * DAY_MS };
}

type CategoryTotals = Record<
  MessageCategory,
  { messages: number; amountMicros: number }
>;

const emptyCategories = (): CategoryTotals => ({
  service: { messages: 0, amountMicros: 0 },
  utility: { messages: 0, amountMicros: 0 },
  marketing: { messages: 0, amountMicros: 0 },
  authentication: { messages: 0, amountMicros: 0 },
});

/** Amounts in several currencies, which can never be added together. */
function addSpend(
  into: Map<string, { amountMicros: number; messages: number }>,
  row: Doc<"billingEvents">
) {
  const bucket = into.get(row.currency) ?? { amountMicros: 0, messages: 0 };
  bucket.amountMicros += row.amountMicros;
  bucket.messages += 1;
  into.set(row.currency, bucket);
}

const spendList = (
  map: Map<string, { amountMicros: number; messages: number }>
) =>
  [...map.entries()]
    .map(([currency, value]) => ({ currency, ...value }))
    .sort((a, b) => b.messages - a.messages);

/** The rate card an account is billed at, for its own billing page. */
export const rates = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<RateView | null> => {
    await requireWorkspace(ctx, args.workspaceId);
    const { scope, card } = await effectiveRates(ctx, args.workspaceId);
    return card && scope !== "none" ? rateView(card, scope) : null;
  },
});

/** The platform default card, for prefilling an account's first rates. */
export const defaultRates = query({
  args: {},
  handler: async (ctx): Promise<RateView | null> => {
    await requireAdmin(ctx);
    const card = await defaultRateCard(ctx);
    return card ? rateView(card, "default") : null;
  },
});

/**
 * One account's consumption over a window: how many messages of each kind,
 * what they came to, and day by day.
 *
 * `now` is an argument for the reason usage.workspaceSummary takes one — a
 * query is not re-run because time passed.
 *
 * Money is reported in the account's current billing currency. A card whose
 * currency changed mid-window leaves rows in the old one; those come back in
 * `otherCurrencies` rather than being summed into a figure they do not belong
 * in.
 */
export const workspaceSummary = query({
  args: {
    workspaceId: v.id("workspaces"),
    days: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const { days, windowStart, previousStart } = windowFor(args.days, args.now);
    const { scope, card } = await effectiveRates(ctx, args.workspaceId);
    const currency = card?.currency ?? workspace.currency;

    // Both windows in one read, so the comparison cannot straddle two.
    const rows = await ctx.db
      .query("billingEvents")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("createdAt", previousStart)
      )
      .take(SCAN_CAP);

    const totals = { messages: 0, amountMicros: 0 };
    const previous = { messages: 0, amountMicros: 0 };
    const byCategory = emptyCategories();
    const others = new Map<string, { amountMicros: number; messages: number }>();
    let unrated = 0;

    const daily = new Map<
      string,
      { date: string; messages: number; spend: number; amountMicros: number }
    >();
    for (let i = 0; i < days; i++) {
      const key = dayKey(windowStart + i * DAY_MS);
      daily.set(key, { date: key, messages: 0, spend: 0, amountMicros: 0 });
    }

    for (const row of rows) {
      const inCurrency = row.currency === currency;
      if (row.createdAt < windowStart) {
        previous.messages += 1;
        if (inCurrency) previous.amountMicros += row.amountMicros;
        continue;
      }

      totals.messages += 1;
      byCategory[row.category].messages += 1;
      if (!row.rated) unrated += 1;

      const bucket = daily.get(dayKey(row.createdAt));
      if (bucket) bucket.messages += 1;

      if (!inCurrency) {
        addSpend(others, row);
        continue;
      }
      totals.amountMicros += row.amountMicros;
      byCategory[row.category].amountMicros += row.amountMicros;
      if (bucket) bucket.amountMicros += row.amountMicros;
    }

    return {
      windowDays: days,
      truncated: rows.length === SCAN_CAP,
      currency,
      locale: workspace.locale,
      totals,
      previous,
      byCategory: MESSAGE_CATEGORIES.map((category) => ({
        category,
        ...byCategory[category],
      })),
      daily: [...daily.values()].map((day) => ({
        ...day,
        // Whole units for the chart axis; the table and tiles use micros.
        spend: day.amountMicros / 1_000_000,
      })),
      otherCurrencies: spendList(others),
      unrated,
      rates: card && scope !== "none" ? rateView(card, scope) : null,
    };
  },
});

/**
 * Every billed message, newest first — the per-message ledger.
 *
 * Paginated, because this is the one view that is meant to reach back through
 * all of it. The contact's name is resolved per row off an index so the
 * ledger reads as people rather than as phone numbers.
 */
export const ledger = query({
  args: {
    workspaceId: v.id("workspaces"),
    category: v.optional(messageCategory),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const category = args.category;

    const page = category
      ? await ctx.db
          .query("billingEvents")
          .withIndex("by_workspace_category_createdAt", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("category", category)
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("billingEvents")
          .withIndex("by_workspace_createdAt", (q) =>
            q.eq("workspaceId", args.workspaceId)
          )
          .order("desc")
          .paginate(args.paginationOpts);

    const names = new Map<string, string | null>();
    const rows: Array<Doc<"billingEvents"> & { contactName: string | null }> =
      [];
    for (const row of page.page) {
      if (!names.has(row.to)) {
        const contact = await ctx.db
          .query("contacts")
          .withIndex("by_workspace_external", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("externalId", row.to)
          )
          .first();
        names.set(row.to, contact?.name ?? null);
      }
      rows.push({ ...row, contactName: names.get(row.to) ?? null });
    }

    return { ...page, page: rows };
  },
});

/**
 * The platform view: every account's rate card beside what it consumed.
 *
 * Totals are kept per currency. Accounts are billed in their own, and a sum
 * of shillings and dollars is not a number anyone can use.
 */
export const adminOverview = query({
  args: { days: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { days, windowStart } = windowFor(args.days, args.now);

    const rows = await ctx.db
      .query("billingEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", windowStart))
      .take(SCAN_CAP);
    const workspaces = await ctx.db.query("workspaces").order("desc").collect();
    // One card per workspace at most, plus the default.
    const cards = await ctx.db.query("billingRates").take(workspaces.length + 1);

    const fallback = cards.find((card) => card.workspaceId === undefined);
    const ownCard = new Map(
      cards
        .filter((card) => card.workspaceId !== undefined)
        .map((card) => [card.workspaceId as Id<"workspaces">, card])
    );

    type Stats = {
      messages: number;
      byCategory: Record<MessageCategory, number>;
      spend: Map<string, { amountMicros: number; messages: number }>;
    };
    const blank = (): Stats => ({
      messages: 0,
      byCategory: { service: 0, utility: 0, marketing: 0, authentication: 0 },
      spend: new Map(),
    });

    const totals = blank();
    const stats = new Map<Id<"workspaces">, Stats>();
    for (const row of rows) {
      const entry = stats.get(row.workspaceId) ?? blank();
      entry.messages += 1;
      entry.byCategory[row.category] += 1;
      addSpend(entry.spend, row);
      stats.set(row.workspaceId, entry);

      totals.messages += 1;
      totals.byCategory[row.category] += 1;
      addSpend(totals.spend, row);
    }

    const known = new Set(workspaces.map((workspace) => workspace._id));
    // Deleted workspaces keep their ledger — it is what they were billed —
    // so their spend is reported rather than silently dropped from the total.
    const orphaned = blank();
    for (const [workspaceId, entry] of stats) {
      if (known.has(workspaceId)) continue;
      orphaned.messages += entry.messages;
      for (const category of MESSAGE_CATEGORIES) {
        orphaned.byCategory[category] += entry.byCategory[category];
      }
      for (const [currency, value] of entry.spend) {
        const bucket = orphaned.spend.get(currency) ?? {
          amountMicros: 0,
          messages: 0,
        };
        bucket.amountMicros += value.amountMicros;
        bucket.messages += value.messages;
        orphaned.spend.set(currency, bucket);
      }
    }

    return {
      windowDays: days,
      truncated: rows.length === SCAN_CAP,
      defaultRates: fallback ? rateView(fallback, "default") : null,
      totals: {
        messages: totals.messages,
        byCategory: totals.byCategory,
        spend: spendList(totals.spend),
      },
      workspaces: await Promise.all(
        workspaces.map(async (workspace) => {
          const entry = stats.get(workspace._id) ?? blank();
          const own = ownCard.get(workspace._id);
          return {
            workspaceId: workspace._id,
            name: workspace.name,
            slug: workspace.slug,
            status: workspace.status,
            currency: workspace.currency,
            locale: workspace.locale,
            logoSrc: await logoSrcFor(ctx, workspace),
            rates: own ? rateView(own, "workspace") : null,
            messages: entry.messages,
            byCategory: entry.byCategory,
            spend: spendList(entry.spend),
          };
        })
      ),
      deleted:
        orphaned.messages > 0
          ? {
              messages: orphaned.messages,
              byCategory: orphaned.byCategory,
              spend: spendList(orphaned.spend),
            }
          : null,
    };
  },
});

// ---------------------------------------------------------------------------
// Rate cards — administrators only
// ---------------------------------------------------------------------------

/**
 * Set what one message of each category costs — for one account, or, with no
 * workspace, the platform default every account without its own is billed at.
 *
 * Rates arrive in whole currency units, the way an administrator types them
 * (0.0034, 150), and are stored in millionths.
 */
export const setRates = mutation({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    currency: v.string(),
    service: v.number(),
    utility: v.number(),
    marketing: v.number(),
    authentication: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const currency = args.currency.trim().toUpperCase();
    if (!isValidCurrency(currency)) {
      throw new Error("Pick a three-letter currency code, e.g. TZS or USD.");
    }
    const amounts = {
      service: args.service,
      utility: args.utility,
      marketing: args.marketing,
      authentication: args.authentication,
    };
    for (const [category, amount] of Object.entries(amounts)) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`The ${category} rate must be zero or more.`);
      }
      if (amount > MAX_RATE) {
        throw new Error(`The ${category} rate looks too high to be per message.`);
      }
    }

    if (args.workspaceId) {
      const workspace = await ctx.db.get("workspaces", args.workspaceId);
      if (!workspace) throw new Error("Workspace not found");
    }

    const fields = {
      currency,
      serviceMicros: toMicros(amounts.service),
      utilityMicros: toMicros(amounts.utility),
      marketingMicros: toMicros(amounts.marketing),
      authenticationMicros: toMicros(amounts.authentication),
      updatedAt: Date.now(),
    };

    const existing = args.workspaceId
      ? await workspaceRateCard(ctx, args.workspaceId)
      : await defaultRateCard(ctx);
    if (existing) {
      await ctx.db.patch("billingRates", existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("billingRates", {
      workspaceId: args.workspaceId,
      ...fields,
    });
  },
});

/** Put an account back on the platform default. */
export const clearRates = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await workspaceRateCard(ctx, args.workspaceId);
    if (existing) await ctx.db.delete("billingRates", existing._id);
    return null;
  },
});
