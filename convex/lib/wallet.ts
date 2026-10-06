/**
 * The prepaid wallet WhatsApp messages are drawn from.
 *
 * Every charged message comes off the balance as it is recorded (see
 * ./charge). A service reply goes out whatever the balance — a customer who
 * wrote in is never left unanswered for want of credit — so the balance can
 * go below zero; templates, which the business starts, are held back instead
 * (`templateBlock`). Crossing the low-balance line warns the company once and,
 * when it has a saved mandate, asks Razorpay for a recharge.
 *
 * Server-only.
 */

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CATEGORY_LABELS,
  formatMoney,
  homeMarket,
  quote,
  type MessageCategory,
  type TemplateCategory,
} from "./billing";
import { accountFor, billingSettings, ensureAccount } from "./account";
import { PLATFORM_LOCALE, welcomeBonusOf, withGst } from "./plans";

type Ctx = QueryCtx | MutationCtx;

/**
 * A mandate debit lands 25–36 hours after Razorpay's pre-debit notice. One
 * still unsettled after four days has gone astray, and another may be asked.
 */
const RECHARGE_STALE_MS = 4 * 24 * 60 * 60 * 1000;

export async function walletFor(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"wallets"> | null> {
  return await ctx.db
    .query("wallets")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

async function ensureWallet(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  currency: string
): Promise<Doc<"wallets">> {
  const existing = await walletFor(ctx, workspaceId);
  if (existing) return existing;
  const walletId = await ctx.db.insert("wallets", {
    workspaceId,
    currency,
    balanceMicros: 0,
    updatedAt: Date.now(),
  });
  const wallet = await ctx.db.get("wallets", walletId);
  if (!wallet) throw new Error("Wallet could not be created");
  return wallet;
}

/**
 * Take one message's charge off the wallet.
 *
 * Only a charge in the wallet's own currency is taken: a rate card in
 * another currency cannot be subtracted from rupees, and the billing pages
 * say so rather than converting at a rate nobody agreed to. With billing
 * switched off there is no wallet to take it from.
 */
export async function debitWallet(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    currency: string;
    amountMicros: number;
  }
): Promise<void> {
  if (args.amountMicros <= 0) return;
  const settings = await billingSettings(ctx);
  if (!settings || settings.currency !== args.currency) return;

  const wallet = await ensureWallet(ctx, args.workspaceId, settings.currency);
  const balanceMicros = wallet.balanceMicros - args.amountMicros;
  await ctx.db.patch("wallets", wallet._id, {
    balanceMicros,
    updatedAt: Date.now(),
  });

  const account = await accountFor(ctx, args.workspaceId);
  const threshold =
    account?.lowBalanceThresholdMicros ?? settings.defaultThresholdMicros;
  if (balanceMicros < threshold) {
    await onLowBalance(ctx, args.workspaceId, balanceMicros, settings);
  }
}

/**
 * Give back what a message was held at and Meta did not charge. Not logged as
 * a wallet transaction: the ledger row it settles is the record, as it is for
 * the debit.
 */
export async function refundWallet(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    currency: string;
    amountMicros: number;
  }
): Promise<void> {
  if (args.amountMicros <= 0) return;
  const settings = await billingSettings(ctx);
  if (!settings || settings.currency !== args.currency) return;

  const wallet = await ensureWallet(ctx, args.workspaceId, settings.currency);
  const balanceMicros = wallet.balanceMicros + args.amountMicros;
  await ctx.db.patch("wallets", wallet._id, {
    balanceMicros,
    updatedAt: Date.now(),
  });

  const account = await accountFor(ctx, args.workspaceId);
  if (
    account?.lowBalanceAlertedAt !== undefined &&
    balanceMicros >= account.lowBalanceThresholdMicros
  ) {
    await ctx.db.patch("billingAccounts", account._id, {
      lowBalanceAlertedAt: undefined,
    });
  }
}

/**
 * Below the line: ask for a recharge if a mandate can pay for one, and tell
 * the company — once per dip, not once per message.
 */
async function onLowBalance(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  balanceMicros: number,
  settings: Doc<"billingSettings">
): Promise<void> {
  const account = await ensureAccount(ctx, workspaceId);
  const now = Date.now();

  const recharge = account.autoRecharge;
  const busy =
    account.rechargeInFlight !== undefined &&
    now - account.rechargeInFlight.startedAt < RECHARGE_STALE_MS;
  let requested = busy;
  if (
    !busy &&
    recharge.enabled &&
    account.mandateTokenId &&
    recharge.tokenStatus === "confirmed"
  ) {
    requested = await requestRecharge(ctx, account, settings);
  }

  if (account.lowBalanceAlertedAt === undefined) {
    await ctx.db.patch("billingAccounts", account._id, {
      lowBalanceAlertedAt: now,
    });
    const balance = formatMoney(balanceMicros, settings.currency, PLATFORM_LOCALE);
    await ctx.scheduler.runAfter(0, internal.push.notify, {
      workspaceId,
      event: "wallet_low",
      data: {
        message: requested
          ? `Wallet balance is ${balance}. An auto-recharge is on its way.`
          : `Wallet balance is ${balance}. Top up to keep templates sending.`,
      },
    });
  }
}

/**
 * File the recharge and hand it to Razorpay. False when it cannot be asked
 * for — the mandate's ceiling is below the amount — with the reason kept
 * where the Billing page shows it.
 */
async function requestRecharge(
  ctx: MutationCtx,
  account: Doc<"billingAccounts">,
  settings: Doc<"billingSettings">
): Promise<boolean> {
  const amounts = withGst(account.autoRecharge.amountMicros, settings.gstPercent);
  const ceiling = account.autoRecharge.maxAmountMicros;
  const now = Date.now();
  if (ceiling !== undefined && amounts.totalMicros > ceiling) {
    const lastError =
      "The recharge amount is more than the saved mandate allows. Authorise auto-recharge again.";
    // Every message below the line comes through here; say it once.
    if (account.autoRecharge.lastError !== lastError) {
      await ctx.db.patch("billingAccounts", account._id, {
        autoRecharge: { ...account.autoRecharge, lastError },
        updatedAt: now,
      });
    }
    return false;
  }

  const paymentId = await ctx.db.insert("billingPayments", {
    workspaceId: account.workspaceId,
    purpose: "auto_recharge",
    status: "created",
    description: "Wallet auto-recharge",
    currency: settings.currency,
    ...amounts,
    creditMicros: amounts.subtotalMicros,
    method: account.autoRecharge.method,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("billingAccounts", account._id, {
    rechargeInFlight: { paymentId, startedAt: now },
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.razorpay.chargeMandate, {
    paymentId,
  });
  return true;
}

/**
 * Put money in: a top-up, a recharge, or an administrator's correction. The
 * only way the balance goes up, so the transaction log is the whole story.
 */
export async function creditWallet(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    kind: Doc<"walletTransactions">["kind"];
    amountMicros: number;
    paymentId?: Id<"billingPayments">;
    note?: string;
    by?: string;
  }
): Promise<number> {
  const settings = await billingSettings(ctx);
  const wallet = await ensureWallet(
    ctx,
    args.workspaceId,
    settings?.currency ?? "INR"
  );
  const now = Date.now();
  const balanceMicros = wallet.balanceMicros + args.amountMicros;
  await ctx.db.patch("wallets", wallet._id, { balanceMicros, updatedAt: now });
  await ctx.db.insert("walletTransactions", {
    workspaceId: args.workspaceId,
    kind: args.kind,
    amountMicros: args.amountMicros,
    balanceAfterMicros: balanceMicros,
    paymentId: args.paymentId,
    note: args.note,
    by: args.by,
    createdAt: now,
  });

  // Back above the line: the next dip is news again.
  const account = await accountFor(ctx, args.workspaceId);
  if (
    account?.lowBalanceAlertedAt !== undefined &&
    balanceMicros >= account.lowBalanceThresholdMicros
  ) {
    await ctx.db.patch("billingAccounts", account._id, {
      lowBalanceAlertedAt: undefined,
    });
  }
  return balanceMicros;
}

/** One template's price at the account's home market, in the wallet's currency. */
async function templatePrice(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  category: MessageCategory,
  currency: string
): Promise<number> {
  const priced = await quote(ctx, {
    workspaceId,
    market: await homeMarket(ctx, workspaceId),
    category,
  });
  return priced.currency === currency ? priced.amountMicros : 0;
}

const blockMessage = (balance: string, category: MessageCategory) =>
  `The wallet holds ${balance}, less than one ${CATEGORY_LABELS[category].toLowerCase()} template costs. Top up on the Billing page to send it.`;

/** A new workspace's wallet starts with the bonus for the billing currency. */
export async function grantWelcomeBonus(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<void> {
  const settings = await billingSettings(ctx);
  if (!settings) return;
  const amountMicros = welcomeBonusOf(settings, settings.currency);
  if (amountMicros <= 0) return;
  await creditWallet(ctx, {
    workspaceId,
    kind: "bonus",
    amountMicros,
    note: "Welcome bonus",
  });
}

/**
 * Why a template of this category cannot go out now, or null when it can.
 *
 * Templates are what the business starts — a campaign, an alert — so they
 * wait for credit where a service reply does not. Measured against one
 * message: a campaign already under way may take the balance a little below
 * zero on its last page rather than stopping mid-list.
 */
export async function templateBlock(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  category: MessageCategory
): Promise<string | null> {
  const settings = await billingSettings(ctx);
  if (!settings) return null;
  const rate = await templatePrice(ctx, workspaceId, category, settings.currency);
  if (rate <= 0) return null;

  const balanceMicros = (await walletFor(ctx, workspaceId))?.balanceMicros ?? 0;
  if (balanceMicros >= rate) return null;
  return blockMessage(
    formatMoney(balanceMicros, settings.currency, PLATFORM_LOCALE),
    category
  );
}

/**
 * `templateBlock` for all three template categories, off one read of the
 * wallet — for a send that does not know which category it holds until it
 * renders.
 */
export async function templateBlocks(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Record<TemplateCategory, string | null>> {
  const blocks: Record<TemplateCategory, string | null> = {
    utility: null,
    marketing: null,
    authentication: null,
  };
  const settings = await billingSettings(ctx);
  if (!settings) return blocks;

  const balanceMicros = (await walletFor(ctx, workspaceId))?.balanceMicros ?? 0;
  const balance = formatMoney(balanceMicros, settings.currency, PLATFORM_LOCALE);
  for (const category of Object.keys(blocks) as TemplateCategory[]) {
    const rate = await templatePrice(ctx, workspaceId, category, settings.currency);
    if (rate > 0 && balanceMicros < rate) {
      blocks[category] = blockMessage(balance, category);
    }
  }
  return blocks;
}
