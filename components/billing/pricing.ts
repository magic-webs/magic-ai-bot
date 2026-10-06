import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import {
  markupOn,
  metaCostOf,
  type MessageCategory,
} from "@/convex/lib/billing";
import { marketChain } from "@/convex/lib/markets";

export type MetaRateRow = FunctionReturnType<typeof api.billing.metaRates>["rows"][number];

export type MarkupView = NonNullable<
  FunctionReturnType<typeof api.billing.markups>["default"]
>;

/** Each market's rates in force at `now`, newest first in the query. */
export function ratesInForce(
  rows: MetaRateRow[],
  now: number
): Map<string, MetaRateRow> {
  const current = new Map<string, MetaRateRow>();
  for (const row of rows) {
    if (row.effectiveFrom > now) continue;
    const held = current.get(row.market);
    if (!held || held.effectiveFrom < row.effectiveFrom) current.set(row.market, row);
  }
  return current;
}

export function ratesFor(
  current: Map<string, MetaRateRow>,
  market: string
): MetaRateRow | undefined {
  for (const key of marketChain(market)) {
    const row = current.get(key);
    if (row) return row;
  }
  return undefined;
}

/** A message's price: Meta's rate plus the markup, or Meta's rate alone. */
export function priceOf(
  rates: MetaRateRow,
  markups: MarkupView | null,
  category: MessageCategory
): number {
  const cost = metaCostOf(rates, category);
  return cost + (markups ? markupOn(cost, markups[category]) : 0);
}

/** "₹0.10 + 15%", the way a markup is read aloud. */
export function describeMarkup(
  markup: { fixedMicros: number; percent: number },
  money: (micros: number) => string
): string {
  const parts = [];
  if (markup.fixedMicros > 0) parts.push(money(markup.fixedMicros));
  if (markup.percent > 0) parts.push(`${markup.percent}%`);
  return parts.length > 0 ? `+ ${parts.join(" + ")}` : "No markup";
}
