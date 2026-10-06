/**
 * Per-message billing: what a WhatsApp message costs the account that sent it.
 *
 * Every send path — an agent's reply, a rich message, a colleague's manual
 * reply, a follow-up nudge, a marketing template — ends by calling `charge`
 * (./charge). A message costs Meta's rate for the recipient's market and its
 * category, plus the platform's markup — fixed, a percentage, or both. It is
 * held at that estimate and settled when Meta's status webhook says what was
 * actually billed.
 *
 * The pure half of this file is imported by React for labels and formatting;
 * the context types below are type-only imports and never reach the bundle.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { Outbound } from "./whatsappSend";
import { marketChain, marketOf } from "./markets";

export type MessageCategory =
  | "service"
  | "utility"
  | "marketing"
  | "authentication";

export type TemplateCategory = Exclude<MessageCategory, "service">;

export type BillingSource =
  | "agent"
  | "human"
  | "follow_up"
  | "campaign"
  | "system"
  | "notification";

export const MESSAGE_CATEGORIES: MessageCategory[] = [
  "service",
  "utility",
  "marketing",
  "authentication",
];

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  service: "Service",
  utility: "Utility",
  marketing: "Marketing",
  authentication: "Authentication",
};

/** What each category covers, in the words an account owner would use. */
export const CATEGORY_HINTS: Record<MessageCategory, string> = {
  service: "Replies inside the 24-hour window — agents, your team, follow-ups",
  utility: "Template updates about something the customer already started",
  marketing: "Template greetings and offers — festivals, birthdays, campaigns",
  authentication: "Template one-time passcodes",
};

export const SOURCE_LABELS: Record<BillingSource, string> = {
  agent: "Agent",
  human: "Your team",
  follow_up: "Follow-up desk",
  campaign: "Campaign",
  system: "Platform",
  notification: "Notification",
};

// --- Money ----------------------------------------------------------------

/** Millionths of a currency unit: a message can cost a fraction of a paisa. */
export const MICROS = 1_000_000;

export function toMicros(amount: number): number {
  return Math.round(amount * MICROS);
}

export function fromMicros(micros: number): number {
  return micros / MICROS;
}

/**
 * Money at a precision that survives being small.
 *
 * A single message can cost 0.0034 of a dollar, and rounding that to cents
 * shows every row in the ledger as 0.00. Under one unit keeps four decimals;
 * sums past it drop to the currency's usual two.
 */
export function formatMoney(
  micros: number,
  currency: string,
  locale?: string
): string {
  const amount = fromMicros(micros);
  const small = Math.abs(amount) > 0 && Math.abs(amount) < 1;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: small ? 2 : undefined,
      maximumFractionDigits: small ? 4 : 2,
    }).format(amount);
  } catch {
    // A code Intl does not know still has to print as something.
    return `${currency} ${amount.toFixed(small ? 4 : 2)}`;
  }
}

// --- Categories -----------------------------------------------------------

/**
 * The category a message is billed at, or null for one that is not billed.
 *
 * Templates carry the category Meta approved them under; anything composed
 * freely can only be sent inside the customer-service window, so it is
 * service. A reaction is not a message anyone is charged for.
 */
export function categoryOf(
  message: Outbound,
  templateCategory?: TemplateCategory
): MessageCategory | null {
  if (message.kind === "reaction") return null;
  if (message.kind === "template" || message.kind === "carousel") {
    return templateCategory ?? "marketing";
  }
  return "service";
}

// --- Pricing --------------------------------------------------------------

export type Markup = { fixedMicros: number; percent: number };

export type MarkupCard = Record<MessageCategory, Markup> & {
  /** What a message Meta did not charge for costs: its free tier, ad replies. */
  freeMicros: number;
};

type MetaRates = Pick<
  Doc<"metaRates">,
  | "serviceMicros"
  | "utilityMicros"
  | "marketingMicros"
  | "authenticationMicros"
  | "authenticationIntlMicros"
>;

export function metaCostOf(
  rates: MetaRates,
  category: MessageCategory,
  international = false
): number {
  switch (category) {
    case "service":
      return rates.serviceMicros;
    case "utility":
      return rates.utilityMicros;
    case "marketing":
      return rates.marketingMicros;
    case "authentication":
      return international
        ? (rates.authenticationIntlMicros ?? rates.authenticationMicros)
        : rates.authenticationMicros;
  }
}

export function markupOn(metaCostMicros: number, markup: Markup): number {
  return markup.fixedMicros + Math.round((metaCostMicros * markup.percent) / 100);
}

/** Meta's `pricing.category` on a status webhook, as the ledger bills it. */
export function metaCategory(
  category: string | undefined
): { category: MessageCategory; international: boolean } | null {
  switch (category) {
    case "service":
    case "utility":
    case "marketing":
    case "authentication":
      return { category, international: false };
    case "marketing_lite":
      return { category: "marketing", international: false };
    case "authentication_international":
      return { category: "authentication", international: true };
    default:
      return null;
  }
}

// --- Rates and markups ------------------------------------------------------

/** The currency the wallet is billed in, and so the one Meta's rates are read in. */
export async function billingCurrency(ctx: QueryCtx): Promise<string> {
  const settings = await ctx.db.query("billingSettings").first();
  return settings?.currency ?? "INR";
}

/**
 * Meta's rates for a market as they stood at `at`, falling back through the
 * market's old region to Other. Without `at`, the newest imported rates.
 */
export async function metaRatesFor(
  ctx: QueryCtx,
  market: string,
  currency: string,
  at?: number
): Promise<Doc<"metaRates"> | null> {
  for (const key of marketChain(market)) {
    const row = await ctx.db
      .query("metaRates")
      .withIndex("by_currency_market_effectiveFrom", (q) =>
        at === undefined
          ? q.eq("currency", currency).eq("market", key)
          : q.eq("currency", currency).eq("market", key).lte("effectiveFrom", at)
      )
      .order("desc")
      .first();
    if (row) return row;
  }
  return null;
}

export async function defaultMarkups(
  ctx: QueryCtx
): Promise<Doc<"billingMarkups"> | null> {
  return await ctx.db
    .query("billingMarkups")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", undefined))
    .first();
}

export async function workspaceMarkups(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"billingMarkups"> | null> {
  return await ctx.db
    .query("billingMarkups")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

export type EffectiveMarkups = {
  scope: "workspace" | "default" | "none";
  card: Doc<"billingMarkups"> | null;
};

/** The account's own markup, else the platform default, else none. */
export async function effectiveMarkups(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<EffectiveMarkups> {
  const own = await workspaceMarkups(ctx, workspaceId);
  if (own) return { scope: "workspace", card: own };
  const fallback = await defaultMarkups(ctx);
  if (fallback) return { scope: "default", card: fallback };
  return { scope: "none", card: null };
}

/** Where most of an account's customers are: its default calling code. */
export async function homeMarket(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<string> {
  const settings = await ctx.db
    .query("notificationSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  return marketOf(settings?.defaultCountryCode ?? "91");
}

export type Quote = {
  market: string;
  currency: string | null;
  metaCostMicros: number;
  markupMicros: number;
  amountMicros: number;
  /** False when no Meta rates cover the market: counted at zero. */
  rated: boolean;
};

/**
 * What one message costs an account: Meta's rate for the market and
 * category, plus the account's markup on it. A message Meta did not bill
 * costs only the free-message fee.
 */
export async function quote(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<"workspaces">;
    market: string;
    category: MessageCategory;
    billable?: boolean;
    international?: boolean;
    at?: number;
  }
): Promise<Quote> {
  const rates = await metaRatesFor(
    ctx,
    args.market,
    await billingCurrency(ctx),
    args.at
  );
  const { card } = await effectiveMarkups(ctx, args.workspaceId);
  const currency = rates?.currency ?? null;
  if (args.billable === false) {
    const fee = card?.freeMicros ?? 0;
    return {
      market: args.market,
      currency,
      metaCostMicros: 0,
      markupMicros: fee,
      amountMicros: fee,
      rated: rates !== null,
    };
  }
  if (!rates) {
    return {
      market: args.market,
      currency,
      metaCostMicros: 0,
      markupMicros: 0,
      amountMicros: 0,
      rated: false,
    };
  }
  const metaCostMicros = metaCostOf(rates, args.category, args.international);
  const markupMicros = card ? markupOn(metaCostMicros, card[args.category]) : 0;
  return {
    market: args.market,
    currency,
    metaCostMicros,
    markupMicros,
    amountMicros: metaCostMicros + markupMicros,
    rated: true,
  };
}
