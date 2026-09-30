import { formatMoney } from "@/convex/lib/billing";
import {
  PLATFORM_CURRENCY,
  PLATFORM_LOCALE,
  SUBSCRIPTION_STATUS,
  type Access,
} from "@/convex/lib/plans";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  CaretRightIcon,
  CheckIcon,
  RobotIcon,
  UserIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";

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

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The desks every plan comes with. They are among its AI agents, but take none
 * of the custom agent seats the plan's own figure counts.
 */
const DESKS = [
  { name: "Front desk", detail: "answers first and routes every chat" },
  { name: "Follow-up desk", detail: "files leads and nudges quiet ones" },
  { name: "Marketing agent", detail: "festival and birthday greetings" },
];

/**
 * The agents a plan comes with as one figure — the desks, its custom agents
 * and its people — opening onto what makes it up and what one more costs.
 */
export function IncludedAgents({
  plan,
  seat,
  selected = false,
  className,
}: {
  plan: { name: string; includedAiAgents: number; includedHumanAgents: number };
  /** One extra agent, when the page knows what it sells at. */
  seat?: { priceMicros: number; listMicros: number };
  selected?: boolean;
  className?: string;
}) {
  const custom = plan.includedAiAgents;
  const ai = DESKS.length + custom;
  const human = plan.includedHumanAgents;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/50",
          className
        )}
      >
        <UsersThreeIcon
          className={cn(
            "size-6 shrink-0",
            selected ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">
            {count(ai + human, "agent")} included
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {count(ai, "AI agent")} + {count(human, "human agent")}
          </span>
        </span>
        <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-80 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>What {plan.name} includes</PopoverTitle>
        </PopoverHeader>

        <IncludedGroup icon={RobotIcon} title={count(ai, "AI agent")}>
          {DESKS.map((desk) => (
            <IncludedLine key={desk.name} name={desk.name} detail={desk.detail} />
          ))}
          {custom > 0 ? (
            <IncludedLine
              name={count(custom, "custom agent")}
              detail="built around your business"
            />
          ) : null}
        </IncludedGroup>

        <IncludedGroup
          icon={UserIcon}
          title={count(human, "human agent")}
          className="border-t pt-3"
        />

        {seat ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Extra agents{" "}
            <StrikePrice
              priceMicros={seat.priceMicros}
              listMicros={seat.listMicros}
              className="font-medium text-foreground"
            />{" "}
            each a month + GST
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function IncludedGroup({
  icon: Icon,
  title,
  detail,
  children,
  className,
}: {
  icon: Icon;
  title: string;
  detail?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-col">
          <span className="text-sm leading-7 font-medium">{title}</span>
          {detail ? (
            <span className="text-xs text-muted-foreground">{detail}</span>
          ) : null}
        </div>
        {children ? <ul className="flex flex-col gap-1">{children}</ul> : null}
      </div>
    </div>
  );
}

function IncludedLine({ name, detail }: { name: string; detail: string }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <CheckIcon className="mt-px size-3.5 shrink-0 text-primary" />
      <span>
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground"> · {detail}</span>
      </span>
    </li>
  );
}

/** A plan's feature lines, each ticked. */
export function PlanFeatures({
  features,
  className,
}: {
  features: string[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2 text-sm", className)}>
      {features.map((feature, index) => (
        <li key={index} className="flex items-start gap-2.5">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
