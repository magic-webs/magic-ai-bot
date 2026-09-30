import { formatMoney } from "@/convex/lib/billing";
import {
  PLATFORM_CURRENCY,
  PLATFORM_LOCALE,
  SUBSCRIPTION_STATUS,
  type Access,
} from "@/convex/lib/plans";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Small pieces the Plan, Wallet and admin pages share, so a rupee, a date
 * and a plan's standing read the same on all of them.
 */

const WHOLE_RUPEES = new Intl.NumberFormat(PLATFORM_LOCALE, {
  style: "currency",
  currency: PLATFORM_CURRENCY,
  maximumFractionDigits: 0,
});

/**
 * Rupees, the Indian way: ₹1,23,456, and ₹5,898.82 when there are paise.
 * A price is usually whole, and "₹4,999.00" on a plan card is noise; below a
 * rupee — one message — the four decimals formatMoney keeps are the point.
 */
export function inr(micros: number): string {
  if (micros % 1_000_000 === 0) return WHOLE_RUPEES.format(micros / 1_000_000);
  return formatMoney(micros, PLATFORM_CURRENCY, PLATFORM_LOCALE);
}

/** Whole rupees for a box the person types into — "999", not "₹999.00". */
export function rupeesOf(micros: number): string {
  return String(Math.round(micros / 10_000) / 100);
}

const DAY = new Intl.DateTimeFormat(PLATFORM_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatDay(timestamp: number | null | undefined): string {
  return typeof timestamp === "number" ? DAY.format(timestamp) : "—";
}

/** "in 3 days", "today", "2 days ago" — for a date that matters soon. */
export function daysFrom(timestamp: number, now: number): string {
  const days = Math.round((timestamp - now) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

const ACCESS_LABEL: Record<Access["state"], string> = {
  open: "No plan needed",
  trial: "Free trial",
  active: "Active",
  grace: "Payment due",
  locked: "Locked",
};

const ACCESS_TONE: Record<Access["state"], string> = {
  open: "bg-muted text-muted-foreground",
  trial:
    "bg-sky-50 text-sky-800 ring-1 ring-sky-600/20 ring-inset dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25",
  active:
    "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  grace:
    "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
  locked: "bg-destructive/10 text-destructive",
};

export function AccessBadge({
  access,
  className,
}: {
  access: Access;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn(ACCESS_TONE[access.state], className)}>
      {ACCESS_LABEL[access.state]}
    </Badge>
  );
}

export function subscriptionLabel(status: string): string {
  return SUBSCRIPTION_STATUS[status] ?? status;
}

/** A price with its list price struck through beside it, when there is one. */
export function StrikePrice({
  priceMicros,
  listMicros,
  className,
}: {
  priceMicros: number;
  listMicros: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      {listMicros > priceMicros ? (
        <span className="text-muted-foreground text-[0.8em] font-normal line-through">
          {inr(listMicros)}
        </span>
      ) : null}
      <span>{inr(priceMicros)}</span>
    </span>
  );
}
