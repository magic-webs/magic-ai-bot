import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspace } from "./lib/auth";
import { reachable } from "./lib/audience";
import { addDays } from "./lib/marketing";
import {
  EMPTY_COUNTS,
  dailyStats,
  eventKey,
  statsFor,
  utcDay,
  type MarketingCounts,
} from "./lib/marketingStats";

const DAY_MS = 24 * 60 * 60 * 1000;
const CONTACT_SCAN = 5000;
const BILLING_SCAN = 8000;
const CAMPAIGN_SCAN = 60;

function sum(days: Map<string, MarketingCounts>, from: string, to: string) {
  const total = { ...EMPTY_COUNTS };
  for (const [day, counts] of days) {
    if (day < from || day > to) continue;
    for (const field of Object.keys(total) as Array<keyof MarketingCounts>) {
      total[field] += counts[field];
    }
  }
  return total;
}

export const summary = query({
  args: { workspaceId: v.id("workspaces"), days: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const days = Math.min(90, Math.max(7, Math.round(args.days)));
    const today = utcDay(args.now);
    const from = addDays(today, -(days - 1));
    const previousFrom = addDays(from, -days);
    const previousTo = addDays(from, -1);
    const daily = await dailyStats(ctx, args.workspaceId, previousFrom, today);

    const series = [];
    for (let offset = 0; offset < days; offset++) {
      const day = addDays(from, offset);
      series.push({ date: day, ...(daily.get(day) ?? EMPTY_COUNTS) });
    }

    const cutoff = args.now - days * DAY_MS;
    const recent = await ctx.db
      .query("marketingEvents")
      .withIndex("by_workspace_and_date", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("date", from)
      )
      .order("desc")
      .take(CAMPAIGN_SCAN);
    const campaigns = [];
    for (const event of recent) {
      if (!event.startedAt || event.startedAt < cutoff) continue;
      const stats = await statsFor(ctx, eventKey(event._id));
      if (stats.sent === 0) continue;
      campaigns.push({
        _id: event._id,
        title: event.title,
        isReminder: Boolean(event.campaignId),
        startedAt: event.startedAt,
        stats,
      });
    }
    campaigns.sort((a, b) => b.stats.sent - a.stats.sent);

    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(CONTACT_SCAN);
    let reachableCount = 0;
    let optedOut = 0;
    let newContacts = 0;
    let newOptOuts = 0;
    for (const contact of contacts) {
      if (contact.channelType !== "whatsapp") continue;
      if (reachable(contact)) reachableCount++;
      else optedOut++;
      if (contact.createdAt >= cutoff) newContacts++;
      if (contact.optedOutAt && contact.optedOutAt >= cutoff) newOptOuts++;
    }

    const billing = await ctx.db
      .query("billingEvents")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("createdAt", cutoff)
      )
      .take(BILLING_SCAN);
    let spendMicros = 0;
    let currency: string | null = null;
    for (const row of billing) {
      if (row.source !== "campaign") continue;
      spendMicros += row.amountMicros;
      currency = row.currency;
    }

    return {
      days,
      series,
      totals: sum(daily, from, today),
      previous: sum(daily, previousFrom, previousTo),
      campaigns: campaigns.slice(0, 8),
      audience: {
        reachable: reachableCount,
        optedOut,
        newContacts,
        newOptOuts,
        partial: contacts.length >= CONTACT_SCAN,
      },
      spend: { micros: spendMicros, currency, partial: billing.length >= BILLING_SCAN },
    };
  },
});
