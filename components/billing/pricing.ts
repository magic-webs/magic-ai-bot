import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import {
  fixedIn,
  formatMoney,
  markupOn,
  metaCostOf,
  type MessageCategory,
} from "@/convex/lib/billing";
import { marketChain } from "@/convex/lib/markets";

export type MetaRateRow = FunctionReturnType<
  typeof api.billing.metaRates
>["rows"][number];

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
    if (!held || held.effectiveFrom < row.effectiveFrom)
      current.set(row.market, row);
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
  return (
    cost + (markups ? markupOn(cost, markups, category, rates.currency) : 0)
  );
}

/** "₹0.10 / $0.002 + 15%", the way a markup is read aloud. */
export function describeMarkup(
  card: MarkupView,
  category: MessageCategory,
  currencies: string[]
): string {
  const parts = currencies
    .map((currency) => ({
      currency,
      micros: fixedIn(card, category, currency),
    }))
    .filter((entry) => entry.micros > 0)
    .map((entry) => formatMoney(entry.micros, entry.currency));
  const fixed = parts.join(" / ");
  const percent =
    card[category].percent > 0 ? `${card[category].percent}%` : "";
  const text = [fixed, percent].filter(Boolean).join(" + ");
  return text ? `+ ${text}` : "No markup";
}
