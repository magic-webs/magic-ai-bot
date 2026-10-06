import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { messageCategory } from "./schema";
import { requireAdmin, requireWorkspace } from "./lib/auth";
import {
  MESSAGE_CATEGORIES,
  billingCurrency,
  defaultMarkups,
  effectiveMarkups,
  workspaceCurrency,
  homeMarket,
  metaCostOf,
  metaRatesFor,
  quote,
  toMicros,
  workspaceMarkups,
  type MessageCategory,
} from "./lib/billing";
import { MARKETS, marketLabel } from "./lib/markets";
import { supportedCurrencies } from "./lib/currency";
import { charge } from "./lib/charge";
import { billingCategory } from "./lib/notifications";
import { isValidCurrency } from "./lib/regional";
import { logoSrcFor } from "./lib/branding";

const DAY_MS = 24 * 60 * 60 * 1000;
// Summaries read rows, not a rollup, so one read is capped — the same trade
// usage.ts makes, and the page says so when it is hit.
const SCAN_CAP = 20_000;
// No single message should cost more than this in any currency; a rate above
// it is a slipped decimal point, not a price.
const MAX_RATE = 1_000_000;
const MAX_PERCENT = 1_000;
const SWEEP_BATCH = 500;
const KNOWN_MARKETS = new Set(MARKETS.map((market) => market.key));

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

/** Meta's category for a template the agent sent by name. */
async function templateCategoryOf(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  name: string
): Promise<MessageCategory | null> {
  const synced = await ctx.db
    .query("whatsappTemplates")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(500);
  const template = synced.find((row) => row.name === name);
  if (template) return billingCategory(template.category);
  const own = await ctx.db
    .query("marketingTemplates")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(500);
  return own.find((row) => row.metaTemplateName === name)?.category ?? null;
}

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
    messages: v.array(
      v.object({
        category: messageCategory,
        preview: v.optional(v.string()),
        templateName: v.optional(v.string()),
        wamid: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { messages, ...shared } = args;
    for (const message of messages) {
      const category =
        message.templateName && message.category !== "service"
          ? ((await templateCategoryOf(
              ctx,
              args.workspaceId,
              message.templateName
            )) ?? message.category)
          : message.category;
      await charge(ctx, { ...shared, ...message, category });
    }
    return null;
  },
});

/**
 * Held messages whose receipts never brought Meta's pricing — a provider that
 * does not forward it, a receipt that was lost — keep the estimate.
 */
export const settleStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("billingEvents")
      .withIndex("by_status_createdAt", (q) =>
        q.eq("status", "pending").lt("createdAt", now - DAY_MS)
      )
      .take(SWEEP_BATCH);
    for (const event of stale) {
      await ctx.db.patch("billingEvents", event._id, {
        status: "settled",
        settledAt: now,
      });
    }
    if (stale.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.billing.settleStale, {});
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type MarkupView = {
  scope: "workspace" | "default";
  chargeFree: boolean;
  byCurrency: NonNullable<Doc<"billingMarkups">["byCurrency"]>;
  updatedAt: number;
} & Record<MessageCategory, { fixedMicros: number; percent: number }>;

function markupView(
  card: Doc<"billingMarkups">,
  scope: MarkupView["scope"]
): MarkupView {
  return {
    scope,
    service: card.service,
    utility: card.utility,
    marketing: card.marketing,
    authentication: card.authentication,
    chargeFree: card.chargeFree ?? false,
    byCurrency: card.byCurrency ?? [],
    updatedAt: card.updatedAt,
  };
}

/**
 * What one message of each category costs an account at its home market:
 * the final price only, never Meta's share of it.
 */
type PriceView = {
  market: string;
  marketLabel: string;
  currency: string;
  chargeFree: boolean;
} & Record<`${MessageCategory}Micros`, number>;

async function pricesFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<PriceView | null> {
  const market = await homeMarket(ctx, workspaceId);
  const prices = {} as Record<`${MessageCategory}Micros`, number>;
  let currency = "INR";
  for (const category of MESSAGE_CATEGORIES) {
    const priced = await quote(ctx, { workspaceId, market, category });
    if (!priced.rated) return null;
    currency = priced.currency;
    prices[`${category}Micros`] = priced.amountMicros;
  }
  const { card } = await effectiveMarkups(ctx, workspaceId);
  return {
    market,
    marketLabel: marketLabel(market),
    currency,
    chargeFree: card?.chargeFree ?? false,
    ...prices,
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

type Margin = {
  billedMicros: number;
  metaCostMicros: number;
  messages: number;
};

/** Only rows priced off Meta's rates split into its cost and the markup. */
function addMargin(into: Map<string, Margin>, row: Doc<"billingEvents">) {
  if (row.metaCostMicros === undefined) return;
  const bucket = into.get(row.currency) ?? {
    billedMicros: 0,
    metaCostMicros: 0,
    messages: 0,
  };
  bucket.billedMicros += row.amountMicros;
  bucket.metaCostMicros += row.metaCostMicros;
  bucket.messages += 1;
  into.set(row.currency, bucket);
}

const marginList = (map: Map<string, Margin>) =>
  [...map.entries()].map(([currency, value]) => ({
    currency,
    ...value,
    marginMicros: value.billedMicros - value.metaCostMicros,
  }));

/** What an account pays per message, for its own billing page. */
export const prices = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<PriceView | null> => {
    await requireWorkspace(ctx, args.workspaceId);
    return await pricesFor(ctx, args.workspaceId);
  },
});

/** An account's own markup and the default, for the admin editor. */
export const markups = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const fallback = await defaultMarkups(ctx);
    const own = args.workspaceId
      ? await workspaceMarkups(ctx, args.workspaceId)
      : null;
    return {
      own: own ? markupView(own, "workspace") : null,
      default: fallback ? markupView(fallback, "default") : null,
    };
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
    const prices = await pricesFor(ctx, args.workspaceId);
    const currency = prices?.currency ?? workspace.currency;

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
    const others = new Map<
      string,
      { amountMicros: number; messages: number }
    >();
    let unrated = 0;
    let pending = 0;

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
      if (row.status === "pending") pending += 1;

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
      pending,
      prices,
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
    const cards = await ctx.db
      .query("billingMarkups")
      .take(workspaces.length + 1);

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
      margin: Map<string, Margin>;
    };
    const blank = (): Stats => ({
      messages: 0,
      byCategory: { service: 0, utility: 0, marketing: 0, authentication: 0 },
      spend: new Map(),
      margin: new Map(),
    });

    const totals = blank();
    const stats = new Map<Id<"workspaces">, Stats>();
    for (const row of rows) {
      const entry = stats.get(row.workspaceId) ?? blank();
      entry.messages += 1;
      entry.byCategory[row.category] += 1;
      addSpend(entry.spend, row);
      addMargin(entry.margin, row);
      stats.set(row.workspaceId, entry);

      totals.messages += 1;
      totals.byCategory[row.category] += 1;
      addSpend(totals.spend, row);
      addMargin(totals.margin, row);
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
      defaultMarkups: fallback ? markupView(fallback, "default") : null,
      totals: {
        messages: totals.messages,
        byCategory: totals.byCategory,
        spend: spendList(totals.spend),
        margin: marginList(totals.margin),
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
            billedIn: await workspaceCurrency(ctx, workspace._id),
            locale: workspace.locale,
            logoSrc: await logoSrcFor(ctx, workspace),
            markups: own ? markupView(own, "workspace") : null,
            messages: entry.messages,
            byCategory: entry.byCategory,
            spend: spendList(entry.spend),
            margin: marginList(entry.margin),
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
// Meta's rates and the platform markup — administrators only
// ---------------------------------------------------------------------------

/**
 * Every imported version of Meta's rates, newest first per market, and the
 * currency messages are priced in — the rows in any other are kept for
 * reference only.
 */
export const metaRates = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("metaRates").take(5_000);
    const settings = await ctx.db.query("billingSettings").first();
    return {
      currency: await billingCurrency(ctx),
      currencies: settings ? supportedCurrencies(settings) : ["INR"],
      rows: rows
        .map((row) => ({ ...row, label: marketLabel(row.market) }))
        .sort(
          (a, b) =>
            a.label.localeCompare(b.label) || b.effectiveFrom - a.effectiveFrom
        ),
    };
  },
});

function amountMicros(label: string, amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be zero or more.`);
  }
  if (amount > MAX_RATE) {
    throw new Error(`${label} looks too high to be per message.`);
  }
  return toMicros(amount);
}

/**
 * Load Meta's rate card, in whole currency units as its CSV prints them. A
 * market already imported for the same date is replaced; an earlier version
 * stays, so a message sent under it still settles at it.
 */
export const importMetaRates = mutation({
  args: {
    currency: v.string(),
    effectiveFrom: v.number(),
    rows: v.array(
      v.object({
        market: v.string(),
        marketing: v.number(),
        utility: v.number(),
        authentication: v.number(),
        authenticationIntl: v.optional(v.number()),
        service: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const currency = args.currency.trim().toUpperCase();
    if (!isValidCurrency(currency)) {
      throw new Error("Pick a three-letter currency code, e.g. INR or USD.");
    }
    if (args.rows.length === 0)
      throw new Error("There are no rates to import.");
    const now = Date.now();
    for (const row of args.rows) {
      if (!KNOWN_MARKETS.has(row.market)) {
        throw new Error(`${row.market} is not a market Meta prices.`);
      }
      const label = marketLabel(row.market);
      const utilityMicros = amountMicros(`${label} utility`, row.utility);
      const fields = {
        market: row.market,
        currency,
        marketingMicros: amountMicros(`${label} marketing`, row.marketing),
        utilityMicros,
        authenticationMicros: amountMicros(
          `${label} authentication`,
          row.authentication
        ),
        authenticationIntlMicros:
          row.authenticationIntl === undefined
            ? undefined
            : amountMicros(
                `${label} authentication-international`,
                row.authenticationIntl
              ),
        // Meta prices a service message at the market's utility rate.
        serviceMicros:
          row.service === undefined
            ? utilityMicros
            : amountMicros(`${label} service`, row.service),
        effectiveFrom: args.effectiveFrom,
        updatedAt: now,
      };
      const existing = await ctx.db
        .query("metaRates")
        .withIndex("by_currency_market_effectiveFrom", (q) =>
          q
            .eq("currency", currency)
            .eq("market", row.market)
            .eq("effectiveFrom", args.effectiveFrom)
        )
        .first();
      if (existing) await ctx.db.patch("metaRates", existing._id, fields);
      else await ctx.db.insert("metaRates", fields);
    }
    return { imported: args.rows.length };
  },
});

/** Drop one imported version of Meta's rates, for a mistaken import. */
export const deleteMetaRates = mutation({
  args: { currency: v.string(), effectiveFrom: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("metaRates").take(5_000);
    for (const row of rows) {
      if (
        row.currency === args.currency &&
        row.effectiveFrom === args.effectiveFrom
      ) {
        await ctx.db.delete("metaRates", row._id);
      }
    }
    return null;
  },
});

const markupInput = v.object({ fixed: v.number(), percent: v.number() });

/**
 * Set the platform's markup on Meta's rates — for one account, or, with no
 * workspace, the default every account without its own pays. Fixed amounts
 * arrive in whole currency units and are stored in millionths.
 */
export const setMarkups = mutation({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    service: markupInput,
    utility: markupInput,
    marketing: markupInput,
    authentication: markupInput,
    chargeFree: v.boolean(),
    /** Fixed amounts in other currencies; the ones above are in INR. */
    byCurrency: v.optional(
      v.array(
        v.object({
          currency: v.string(),
          service: v.number(),
          utility: v.number(),
          marketing: v.number(),
          authentication: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.workspaceId) {
      const workspace = await ctx.db.get("workspaces", args.workspaceId);
      if (!workspace) throw new Error("Workspace not found");
    }
    const markupOf = (category: MessageCategory) => {
      const { fixed, percent } = args[category];
      if (!Number.isFinite(percent) || percent < 0 || percent > MAX_PERCENT) {
        throw new Error(
          `The ${category} percentage must be between 0 and ${MAX_PERCENT}.`
        );
      }
      return {
        fixedMicros: amountMicros(`The ${category} fixed markup`, fixed),
        percent,
      };
    };
    const fields = {
      service: markupOf("service"),
      utility: markupOf("utility"),
      marketing: markupOf("marketing"),
      authentication: markupOf("authentication"),
      chargeFree: args.chargeFree,
      ...(args.byCurrency === undefined
        ? {}
        : {
            byCurrency: args.byCurrency.map((entry) => {
              const code = entry.currency.trim().toUpperCase();
              if (!isValidCurrency(code))
                throw new Error(`${entry.currency} is not a currency code.`);
              return {
                currency: code,
                service: amountMicros(
                  `The ${code} service markup`,
                  entry.service
                ),
                utility: amountMicros(
                  `The ${code} utility markup`,
                  entry.utility
                ),
                marketing: amountMicros(
                  `The ${code} marketing markup`,
                  entry.marketing
                ),
                authentication: amountMicros(
                  `The ${code} authentication markup`,
                  entry.authentication
                ),
              };
            }),
          }),
      updatedAt: Date.now(),
    };

    const existing = args.workspaceId
      ? await workspaceMarkups(ctx, args.workspaceId)
      : await defaultMarkups(ctx);
    if (existing) {
      await ctx.db.patch("billingMarkups", existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("billingMarkups", {
      workspaceId: args.workspaceId,
      ...fields,
    });
  },
});

/** Put an account back on the default markup. */
export const clearMarkups = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await workspaceMarkups(ctx, args.workspaceId);
    if (existing) await ctx.db.delete("billingMarkups", existing._id);
    return null;
  },
});

/**
 * Turn the old flat rate cards into markups over Meta's rates, so an account
 * pays what it did for a message to its home market. Needs Meta's rates for
 * that market imported first: `bunx convex run billing:migrateRateCards`.
 */
export const migrateRateCards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cards = await ctx.db.query("billingRates").take(1_000);
    const currency = await billingCurrency(ctx);
    let migrated = 0;
    for (const card of cards) {
      const existing = card.workspaceId
        ? await workspaceMarkups(ctx, card.workspaceId)
        : await defaultMarkups(ctx);
      if (!existing) {
        const market = card.workspaceId
          ? await homeMarket(ctx, card.workspaceId)
          : "IN";
        const rates = await metaRatesFor(ctx, market, currency);
        if (!rates) {
          throw new Error(
            `Import Meta's rates for ${marketLabel(market)} first.`
          );
        }
        const markupFor = (category: MessageCategory) => ({
          fixedMicros: Math.max(
            0,
            card[`${category}Micros`] - metaCostOf(rates, category)
          ),
          percent: 0,
        });
        const service = markupFor("service");
        await ctx.db.insert("billingMarkups", {
          workspaceId: card.workspaceId,
          service,
          utility: markupFor("utility"),
          marketing: markupFor("marketing"),
          authentication: markupFor("authentication"),
          updatedAt: Date.now(),
        });
        migrated++;
      }
      await ctx.db.delete("billingRates", card._id);
    }
    return { migrated };
  },
});
