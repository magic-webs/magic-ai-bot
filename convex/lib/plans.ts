/**
 * The platform fee: plans, extra agents, GST, and whether a workspace may use
 * the dashboard right now.
 *
 * Pure, and imported by React as well as by Convex — the pricing cards, the
 * checkout summary and the lock screen all compute from this file, so the
 * figure a company is shown is the figure its subscription is created at.
 *
 * Money is in millionths of the currency, as everywhere else in billing.
 */

import { toMicros } from "./billing";

/** Plans and the wallet are priced in Razorpay's own currency. */
export const PLATFORM_CURRENCY = "INR";
export const PLATFORM_LOCALE = "en-IN";

// --- Paise -----------------------------------------------------------------

/** A paisa — Razorpay's unit — is ten thousand micros. */
export const MICROS_PER_PAISE = 10_000;

export function toPaise(micros: number): number {
  return Math.round(micros / MICROS_PER_PAISE);
}

export function fromPaise(paise: number): number {
  return paise * MICROS_PER_PAISE;
}

/** Rounded to a whole paisa, the smallest amount a payment can carry. */
export function roundToPaise(micros: number): number {
  return toPaise(micros) * MICROS_PER_PAISE;
}

// --- Defaults ----------------------------------------------------------------

/** What billing starts on the first time an administrator switches it on. */
export const DEFAULT_SETTINGS = {
  currency: PLATFORM_CURRENCY,
  gstPercent: 18,
  trialDays: 14,
  graceDays: 3,
  extraAgentListMicros: toMicros(2499),
  extraAgentPriceMicros: toMicros(999),
  minTopUpMicros: toMicros(500),
  defaultThresholdMicros: toMicros(500),
};

/** An auto-recharge amount a company has not chosen yet. */
export const DEFAULT_RECHARGE_MICROS = toMicros(2000);

/** The most one wallet payment may be — a slipped digit, not a top-up. */
export const MAX_TOPUP_MICROS = toMicros(500_000);

/** The most extra agents one account may buy. */
export const MAX_EXTRA_AGENTS = 500;

/**
 * Above this, every card or UPI Autopay debit needs the customer's approval —
 * the opposite of automatic. It caps a saved mandate, and a plan dearer than
 * it is still sold but says so.
 */
export const APPROVAL_LIMIT_MICROS = toMicros(15_000);

/**
 * Every plan comes with the three desks — they are the platform, not an
 * add-on — so the features name them before the counts that differ.
 */
const DESKS = [
  "Front desk that answers first and routes every chat",
  "Follow-up desk that files leads and nudges quiet ones",
  "Marketing agent for festival and birthday greetings",
];

export const DEFAULT_PLANS: Array<{
  code: string;
  name: string;
  description: string;
  listPriceMicros: number;
  priceMicros: number;
  includedAiAgents: number;
  includedHumanAgents: number;
  features: string[];
  highlighted: boolean;
}> = [
  {
    code: "starter",
    name: "Starter",
    description: "Everything a business needs to put its WhatsApp on agents.",
    listPriceMicros: toMicros(4999),
    priceMicros: toMicros(4999),
    includedAiAgents: 1,
    includedHumanAgents: 1,
    features: [
      ...DESKS,
      "1 custom agent, built around your business",
      "1 human agent with full access to the platform",
    ],
    highlighted: false,
  },
  {
    code: "growth",
    name: "Growth",
    description: "For a team with several desks and people on the inbox.",
    listPriceMicros: toMicros(11999),
    priceMicros: toMicros(9999),
    includedAiAgents: 5,
    includedHumanAgents: 3,
    features: [
      ...DESKS,
      "5 custom agents",
      "3 human agents with full access",
    ],
    highlighted: true,
  },
  {
    code: "scale",
    name: "Scale",
    description: "For a business running many lines of work on agents.",
    listPriceMicros: toMicros(24999),
    priceMicros: toMicros(19999),
    includedAiAgents: 15,
    includedHumanAgents: 10,
    features: [
      ...DESKS,
      "15 custom agents",
      "10 human agents with full access",
    ],
    highlighted: false,
  },
];

// --- Pricing -----------------------------------------------------------------

export type PricingSettings = {
  gstPercent: number;
  extraAgentListMicros: number;
  extraAgentPriceMicros: number;
};

export type AccountPricing = {
  discountPercent?: number;
  extraAgentPriceMicros?: number;
};

export type Quote = {
  /** The plan's list price, before anything comes off. */
  planListMicros: number;
  /** The plan's price after this account's discount. */
  planMicros: number;
  /** What this account's own discount took off the plan. */
  discountMicros: number;
  discountPercent: number;
  extraAgents: number;
  /** One extra agent, at this account's price. */
  seatMicros: number;
  seatListMicros: number;
  seatsMicros: number;
  subtotalMicros: number;
  gstPercent: number;
  gstMicros: number;
  totalMicros: number;
};

/**
 * A month of the platform fee: the plan, less any discount this account has
 * been given, plus its extra agents, plus GST.
 *
 * Each part is rounded to a paisa before it is added, so the parts on the
 * summary add up to the total the subscription charges.
 */
export function quote(args: {
  plan: { priceMicros: number; listPriceMicros: number };
  extraAgents: number;
  settings: PricingSettings;
  account?: AccountPricing | null;
}): Quote {
  const discountPercent = clampPercent(args.account?.discountPercent ?? 0);
  const planListMicros = Math.max(args.plan.listPriceMicros, args.plan.priceMicros);
  const discountMicros = roundToPaise(
    (args.plan.priceMicros * discountPercent) / 100
  );
  const planMicros = roundToPaise(args.plan.priceMicros) - discountMicros;

  const extraAgents = Math.max(0, Math.floor(args.extraAgents));
  const seatMicros = roundToPaise(
    args.account?.extraAgentPriceMicros ?? args.settings.extraAgentPriceMicros
  );
  const seatListMicros = Math.max(
    roundToPaise(args.settings.extraAgentListMicros),
    seatMicros
  );
  const seatsMicros = seatMicros * extraAgents;

  const subtotalMicros = planMicros + seatsMicros;
  const gstMicros = roundToPaise((subtotalMicros * args.settings.gstPercent) / 100);

  return {
    planListMicros,
    planMicros,
    discountMicros,
    discountPercent,
    extraAgents,
    seatMicros,
    seatListMicros,
    seatsMicros,
    subtotalMicros,
    gstPercent: args.settings.gstPercent,
    gstMicros,
    totalMicros: subtotalMicros + gstMicros,
  };
}

/** GST on a wallet payment. The credit is the amount; the tax rides on top. */
export function withGst(amountMicros: number, gstPercent: number) {
  const subtotalMicros = roundToPaise(amountMicros);
  const gstMicros = roundToPaise((subtotalMicros * gstPercent) / 100);
  return { subtotalMicros, gstMicros, totalMicros: subtotalMicros + gstMicros };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// --- Seats -------------------------------------------------------------------

export type SeatKind = "ai" | "human";

export type SeatUsage = {
  ai: { included: number; used: number };
  human: { included: number; used: number };
  /** Extra agents are one pool: each can be an AI agent or a human one. */
  extra: { bought: number; used: number };
  /** More live than the plan and its extras allow — after a downgrade. */
  over: number;
};

export function seatUsage(args: {
  includedAiAgents: number;
  includedHumanAgents: number;
  extraAgents: number;
  aiUsed: number;
  humanUsed: number;
}): SeatUsage {
  const aiOver = Math.max(0, args.aiUsed - args.includedAiAgents);
  const humanOver = Math.max(0, args.humanUsed - args.includedHumanAgents);
  const used = aiOver + humanOver;
  return {
    ai: { included: args.includedAiAgents, used: args.aiUsed },
    human: { included: args.includedHumanAgents, used: args.humanUsed },
    extra: { bought: args.extraAgents, used },
    over: Math.max(0, used - args.extraAgents),
  };
}

/** Whether one more agent of this kind fits. */
export function hasRoomFor(usage: SeatUsage, kind: SeatKind): boolean {
  const own = usage[kind];
  if (own.used < own.included) return true;
  return usage.extra.used < usage.extra.bought;
}

/**
 * The fewest extra agents that cover what is live now. What the plan picker
 * starts on, so choosing a smaller plan does not strand anyone who is live.
 */
export function extrasNeeded(
  plan: { includedAiAgents: number; includedHumanAgents: number },
  used: { ai: number; human: number }
): number {
  return (
    Math.max(0, used.ai - plan.includedAiAgents) +
    Math.max(0, used.human - plan.includedHumanAgents)
  );
}

// --- Access ------------------------------------------------------------------

/**
 * Whether the dashboard is open.
 *
 * `open` means billing is not switched on at all. `grace` is a renewal that
 * failed and is being retried; the dashboard stays open through it and
 * locks when it runs out. Locking is the dashboard only — agents keep
 * answering customers whatever this says.
 */
export type AccessState = "open" | "trial" | "active" | "grace" | "locked";

export type Access = {
  state: AccessState;
  /** When the state next changes on its own, if it does. */
  until: number | null;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Razorpay's subscription statuses, in the words a company would use. */
export const SUBSCRIPTION_STATUS: Record<string, string> = {
  created: "Awaiting authorisation",
  authenticated: "Authorised",
  active: "Active",
  pending: "Payment retrying",
  halted: "Payment failed",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
};

/** Statuses in which a subscription grants its plan. */
export const LIVE_STATUSES: readonly string[] = ["authenticated", "active"];

export const isLiveStatus = (status: string) => LIVE_STATUSES.includes(status);

/** Razorpay wants a later start in the future, and not by a hair. */
export const START_LEAD_MS = 2 * 60 * 60 * 1000;

type Moment = number | null | undefined;

/**
 * Where a new subscription starts charging: where the account is already
 * paid up to — the live subscription's next charge, or the end of a trial or
 * of a cancelled month — so a change never charges twice for the same days.
 * Null means now.
 *
 * Shared so the checkout is created at the date the page promised.
 */
export function nextStartAt(args: {
  live: { chargeAt?: Moment; currentEnd?: Moment; startAt?: Moment } | null;
  access: Access;
  now: number;
}): number | null {
  const { live, access } = args;
  const paidThrough = live
    ? (live.chargeAt ?? live.currentEnd ?? live.startAt ?? null)
    : access.state === "trial" || access.state === "active"
      ? access.until
      : null;
  return paidThrough !== null && paidThrough > args.now + START_LEAD_MS
    ? paidThrough
    : null;
}

/** When the trial of a workspace with no account of its own ends. */
export function defaultTrialEnd(
  settings: { trialDays: number; launchedAt: number },
  workspaceCreatedAt: number
): number {
  return Math.max(settings.launchedAt, workspaceCreatedAt) + settings.trialDays * DAY_MS;
}

export function accessOf(args: {
  settings: { trialDays: number; graceDays: number; launchedAt: number } | null;
  account: {
    mode: "trial" | "razorpay" | "manual";
    trialEndsAt?: number;
    manualPaidThrough?: number;
  } | null;
  subscription: {
    status: string;
    currentEnd?: number;
    chargeAt?: number;
    startAt?: number;
  } | null;
  workspaceCreatedAt: number;
  now: number;
}): Access {
  const { settings, account, subscription, now } = args;
  if (!settings) {
    return { state: "open", until: null, reason: "Billing is not switched on." };
  }
  const grace = settings.graceDays * DAY_MS;

  if (account?.mode === "manual") {
    const through = account.manualPaidThrough;
    if (through === undefined) {
      return { state: "active", until: null, reason: "Billed by arrangement." };
    }
    if (now < through) {
      return { state: "active", until: through, reason: "Billed by arrangement." };
    }
    if (now < through + grace) {
      return {
        state: "grace",
        until: through + grace,
        reason: "The arranged period has ended.",
      };
    }
    return { state: "locked", until: null, reason: "The arranged period has ended." };
  }

  if (subscription) {
    const paidThrough =
      subscription.currentEnd ?? subscription.chargeAt ?? subscription.startAt;
    switch (subscription.status) {
      case "active":
      case "authenticated":
        return {
          state: "active",
          until: paidThrough ?? null,
          reason: "Your plan is active.",
        };
      case "pending":
      case "halted": {
        const lockAt = (paidThrough ?? now) + grace;
        if (now < lockAt) {
          return {
            state: "grace",
            until: lockAt,
            reason:
              subscription.status === "pending"
                ? "Your last payment did not go through, and Razorpay is retrying it."
                : "Your payment failed and the subscription has stopped.",
          };
        }
        return { state: "locked", until: null, reason: "Your payment failed." };
      }
      case "cancelled":
      case "completed":
      case "expired":
      case "paused":
        if (paidThrough !== undefined && now < paidThrough) {
          return {
            state: "active",
            until: paidThrough,
            reason: "Your plan ends at the close of the period you paid for.",
          };
        }
        break;
      // "created" is a checkout that was never finished; it grants nothing.
    }
  }

  const trialEnd =
    account?.trialEndsAt ?? defaultTrialEnd(settings, args.workspaceCreatedAt);
  if (now < trialEnd) {
    return { state: "trial", until: trialEnd, reason: "You are on a free trial." };
  }
  return {
    state: "locked",
    until: null,
    reason: subscription ? "Your plan has ended." : "Your free trial has ended.",
  };
}

/** Whether the dashboard should open. Only a lapsed account is shut out. */
export const isLocked = (access: Access) => access.state === "locked";

// --- Tax details ---------------------------------------------------------------

/** 15 characters: state code, PAN, entity number, Z, checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: string): boolean {
  return GSTIN.test(value.trim().toUpperCase());
}
