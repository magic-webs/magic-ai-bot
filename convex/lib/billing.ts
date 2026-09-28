/**
 * Per-message billing: what a WhatsApp message costs the account that sent it.
 *
 * Every send path — an agent's reply, a rich message, a colleague's manual
 * reply, a follow-up nudge, a marketing template — ends by calling `charge`,
 * which prices the message at the account's rate for its category and writes
 * one `billingEvents` row. The amount is fixed there and then, so repricing an
 * account changes the next message, never the ledger.
 *
 * The pure half of this file is imported by React for labels and formatting;
 * the context types below are type-only imports and never reach the bundle.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Outbound } from "./whatsappSend";

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

/** Millionths of a currency unit. See `billingRates` in the schema for why. */
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

export function rateFor(
  card: Pick<
    Doc<"billingRates">,
    "serviceMicros" | "utilityMicros" | "marketingMicros" | "authenticationMicros"
  >,
  category: MessageCategory
): number {
  switch (category) {
    case "service":
      return card.serviceMicros;
    case "utility":
      return card.utilityMicros;
    case "marketing":
      return card.marketingMicros;
    case "authentication":
      return card.authenticationMicros;
  }
}

// --- Rate cards -----------------------------------------------------------

export type EffectiveRates = {
  /** Whose card applies: the account's own, the platform default, or none. */
  scope: "workspace" | "default" | "none";
  card: Doc<"billingRates"> | null;
};

export async function defaultRateCard(
  ctx: QueryCtx
): Promise<Doc<"billingRates"> | null> {
  return await ctx.db
    .query("billingRates")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", undefined))
    .first();
}

export async function workspaceRateCard(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"billingRates"> | null> {
  return await ctx.db
    .query("billingRates")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

/** The account's own card, else the platform default, else nothing. */
export async function effectiveRates(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<EffectiveRates> {
  const own = await workspaceRateCard(ctx, workspaceId);
  if (own) return { scope: "workspace", card: own };
  const fallback = await defaultRateCard(ctx);
  if (fallback) return { scope: "default", card: fallback };
  return { scope: "none", card: null };
}

/** Clamped to what the ledger shows, so one long reply is not a long row. */
const PREVIEW_MAX = 140;

/**
 * Charge one sent message to its workspace.
 *
 * Called only after the provider accepted the message: a send that failed is
 * not a message the account received, and must not be billed as one. With no
 * rate card anywhere the message is still recorded, at zero and marked
 * unrated, so the count is right and the gap is visible.
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

  const preview = args.preview?.replace(/\s+/g, " ").trim();
  return await ctx.db.insert("billingEvents", {
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    channelId: args.channelId,
    to: args.to,
    category: args.category,
    source: args.source,
    preview: preview ? preview.slice(0, PREVIEW_MAX) : undefined,
    templateName: args.templateName,
    currency,
    amountMicros: card ? rateFor(card, args.category) : 0,
    rated: card !== null,
    createdAt: Date.now(),
  });
}
