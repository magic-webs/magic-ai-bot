"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toMicros } from "@/convex/lib/billing";
import { extrasNeeded, type SeatUsage } from "@/convex/lib/plans";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { CompanyLogo } from "@/components/company-logo";
import {
  AccessBadge,
  daysFrom,
  formatDay,
  rupeesOf,
  subscriptionLabel,
  currencySymbol,
  moneyIn,
} from "@/components/billing/plan-bits";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CreditCardIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";

type Overview = FunctionReturnType<typeof api.subscriptions.adminAccounts>;
type AccountRow = Overview["accounts"][number];
type Plan = Overview["plans"][number];
type Filter = "all" | "active" | "trial" | "grace" | "locked";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "trial", label: "Free trial" },
  { value: "grace", label: "Payment due" },
  { value: "locked", label: "Locked" },
];

const MODE_LABEL: Record<AccountRow["mode"], string> = {
  trial: "Trial",
  razorpay: "Razorpay",
  manual: "By arrangement",
};

/** Razorpay is taking money for these — convex/subscriptions.ts's LIVE. */
const CHARGING = new Set(["active", "authenticated"]);
/**
 * A subscription that still decides the account's standing, and so is worth
 * cancelling: a failing one is retried or has stopped, but it is not over.
 */
const STANDING = new Set(["active", "authenticated", "pending", "halted"]);

const DAY_MS = 24 * 60 * 60 * 1000;

const isCharging = (row: AccountRow) =>
  row.subscription !== null && CHARGING.has(row.subscription.status);

/** What the server refuses a mode change on — a retry can still take money. */
const isStanding = (row: AccountRow) =>
  row.subscription !== null && STANDING.has(row.subscription.status);

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** A typed number, or NaN for an empty box — `Number("")` is 0, not blank. */
const num = (text: string) => (text.trim() === "" ? NaN : Number(text));

/** A date input's value, in the admin's own timezone. */
function dateInput(timestamp: number): string {
  const day = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * The last moment of the day picked, local time — a trial that "ends on the
 * 12th" should still be open on the 12th.
 */
function endOfDay(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/**
 * One save button's worth of work: busy while it runs, a toast either way.
 * Each section of the Manage dialog has its own, so saving one never
 * resubmits another.
 */
function useRun() {
  const [busy, setBusy] = useState(false);
  const run = async (
    failTitle: string,
    task: () => Promise<{ title: string; description?: string }>
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const done = await task();
      toast.add({ ...done, type: "success" });
      return true;
    } catch (error) {
      toast.add({
        title: failTitle,
        description: message(error),
        type: "error",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

// ---------------------------------------------------------------------------
// Table cells
// ---------------------------------------------------------------------------

/** When the account's standing next changes, in words. */
function standingLine(row: AccountRow, now: number): string | null {
  const { access, subscription } = row;
  const until = access.until;
  switch (access.state) {
    case "trial":
      return until
        ? `Trial ends ${formatDay(until)} · ${daysFrom(until, now)}`
        : null;
    case "grace":
      return until
        ? `Locks ${formatDay(until)} · ${daysFrom(until, now)}`
        : null;
    case "active":
      if (row.mode === "manual") {
        return until ? `Paid through ${formatDay(until)}` : "Open-ended";
      }
      if (!until) return null;
      if (
        subscription &&
        CHARGING.has(subscription.status) &&
        !subscription.cancelAtCycleEnd
      ) {
        return `${subscription.paidCount === 0 ? "First charge" : "Renews"} ${formatDay(until)}`;
      }
      return `Ends ${formatDay(until)} · ${daysFrom(until, now)}`;
    case "locked":
      if (row.mode === "manual") return "Arranged period ended";
      if (
        subscription &&
        (subscription.status === "pending" || subscription.status === "halted")
      ) {
        return "Payment failed";
      }
      return subscription ? "Plan ended" : "Trial ended";
    default:
      return null;
  }
}

function SeatsCell({ seats }: { seats: SeatUsage | null }) {
  if (!seats) return <span className="text-muted-foreground">—</span>;
  const over = seats.over > 0;
  return (
    <span
      className={cn(
        "flex flex-col gap-0.5 text-xs whitespace-nowrap tabular-nums",
        over && "text-destructive"
      )}
    >
      <span>
        AI {seats.ai.used}/{seats.ai.included} · Human {seats.human.used}/
        {seats.human.included} · Extras {seats.extra.used}/{seats.extra.bought}
      </span>
      {over ? (
        <span className="font-medium">{seats.over} over the limit</span>
      ) : null}
    </span>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <span
        className={cn("font-heading text-2xl leading-none font-semibold", tone)}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-primary/30 bg-primary/10 font-medium text-primary"
          : "border-border text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "bg-primary/15" : "bg-muted"
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The Manage dialog, one section per thing an administrator arranges
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="font-heading text-sm font-medium">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SaveButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-end">
      <Button size="sm" disabled={busy || disabled} onClick={onClick}>
        {busy ? <Spinner /> : null} {children}
      </Button>
    </div>
  );
}

function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-md px-3 py-2 text-xs",
        tone === "warn"
          ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          : "bg-muted/50 text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

function CurrencySection({
  account,
  currencies,
}: {
  account: AccountRow;
  currencies: string[];
}) {
  const update = useMutation(api.subscriptions.adminUpdateAccount);
  const [busy, run] = useRun();
  const [currency, setCurrency] = useState(account.currency);

  const save = () =>
    void run("Could not change the currency", async () => {
      await update({ workspaceId: account.workspaceId, currency });
      return {
        title: `${account.name} is billed in ${currency}`,
        description:
          "Its plan moved to the same plan in that currency, where there is one.",
      };
    });

  return (
    <Section
      title="Billing currency"
      description="Its plans, wallet and message charges are all in it. Changes only while the wallet is at zero and Razorpay is not charging it."
    >
      <SelectField
        id="manage-currency"
        className="w-full sm:w-48"
        value={currency}
        onValueChange={setCurrency}
        options={currencies.map((code) => ({ value: code, label: code }))}
      />
      <SaveButton
        busy={busy}
        disabled={currency === account.currency}
        onClick={save}
      >
        Change currency
      </SaveButton>
    </Section>
  );
}

function PlanSection({
  account,
  plans: all,
}: {
  account: AccountRow;
  plans: Plan[];
}) {
  const money = moneyIn(account.currency);
  const plans = all.filter(
    (row) => (row.currency ?? "INR") === account.currency
  );
  const update = useMutation(api.subscriptions.adminUpdateAccount);
  const [busy, run] = useRun();
  const [planId, setPlanId] = useState<string>(account.planId ?? "");
  const [extras, setExtras] = useState(String(account.extraAgents));

  const extraAgents = num(extras);
  const bad = !Number.isInteger(extraAgents) || extraAgents < 0;
  const planChanged = planId !== "" && planId !== account.planId;
  const dirty = planChanged || (!bad && extraAgents !== account.extraAgents);
  const plan = plans.find((row) => row._id === planId);
  // What it takes to cover the agents already live, so a downgrade here does
  // not quietly leave the account over its limit.
  const needed = plan ? extrasNeeded(plan, account.used) : 0;

  const save = () =>
    void run("Could not change the plan", async () => {
      await update({
        workspaceId: account.workspaceId,
        // Only when it moved: the plan shown may be the trial plan the
        // account falls back to, and saving it would pin the account there.
        planId: planChanged ? (planId as Id<"billingPlans">) : undefined,
        extraAgents,
      });
      return {
        title: `${account.name}'s plan saved`,
        description: "Its limits changed straight away.",
      };
    });

  return (
    <Section
      title="Plan and extra agents"
      description={
        isCharging(account)
          ? `This changes the account's limits now. Razorpay keeps charging ${money(account.subscription!.totalMicros)} a month until the company checks out again.`
          : "This changes the account's limits now. What it pays is worked out when it next checks out."
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field id="manage-plan" label="Plan">
          <SelectField
            id="manage-plan"
            className="w-full"
            value={planId}
            placeholder="Choose a plan"
            onValueChange={setPlanId}
            options={plans.map((row) => ({
              value: row._id,
              label: `${row.name} · ${money(row.priceMicros)}${row.status === "hidden" ? " · hidden" : ""}`,
            }))}
          />
        </Field>
        <Field id="manage-extras" label="Extra agents">
          <Input
            id="manage-extras"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={extras}
            aria-invalid={bad || undefined}
            className="tabular-nums"
            onChange={(event) => setExtras(event.target.value)}
          />
        </Field>
      </div>
      {plan && !bad && extraAgents < needed ? (
        <Note tone="warn">
          {account.used.ai} custom and {account.used.human} human agents are
          live. {plan.name} needs {needed} extra{" "}
          {needed === 1 ? "agent" : "agents"} to cover them; fewer leaves the
          account over its limit until some are paused.
        </Note>
      ) : null}
      <SaveButton busy={busy} disabled={bad || !dirty} onClick={save}>
        Save plan
      </SaveButton>
    </Section>
  );
}

function PricingSection({ account }: { account: AccountRow }) {
  const update = useMutation(api.subscriptions.adminUpdateAccount);
  const [busy, run] = useRun();
  const [discount, setDiscount] = useState(
    account.discountPercent ? String(account.discountPercent) : ""
  );
  const [seatPrice, setSeatPrice] = useState(
    account.extraAgentPriceMicros === null
      ? ""
      : rupeesOf(account.extraAgentPriceMicros)
  );

  const percent = discount.trim() === "" ? 0 : num(discount);
  const price = seatPrice.trim() === "" ? null : num(seatPrice);
  const badDiscount = !(percent >= 0 && percent <= 100);
  const badPrice = price !== null && !(price >= 0);
  const priceMicros = price === null || badPrice ? null : toMicros(price);
  const dirty =
    percent !== account.discountPercent ||
    priceMicros !== account.extraAgentPriceMicros;

  const save = () =>
    void run("Could not save the pricing", async () => {
      await update({
        workspaceId: account.workspaceId,
        discountPercent: percent,
        // Null clears it, back to the platform's price.
        extraAgentPrice: price,
      });
      return {
        title: `Pricing saved for ${account.name}`,
        description: "It applies when the account next checks out.",
      };
    });

  return (
    <Section
      title="Price for this account"
      description={
        isCharging(account)
          ? "These apply to the account's next checkout. The subscription Razorpay is charging now keeps its amount."
          : "These apply to the account's next checkout."
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="manage-discount" label="Discount off the plan">
          <div className="relative">
            <Input
              id="manage-discount"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={discount}
              placeholder="0"
              aria-invalid={badDiscount || undefined}
              className="pr-8 tabular-nums"
              onChange={(event) => setDiscount(event.target.value)}
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
        </Field>
        <Field
          id="manage-seat-price"
          label="Extra agent price"
          hint="Blank for the platform's price."
        >
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
              {currencySymbol(account.currency)}
            </span>
            <Input
              id="manage-seat-price"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={seatPrice}
              placeholder="Platform price"
              aria-invalid={badPrice || undefined}
              className="pl-6 tabular-nums"
              onChange={(event) => setSeatPrice(event.target.value)}
            />
          </div>
        </Field>
      </div>
      <SaveButton
        busy={busy}
        disabled={badDiscount || badPrice || !dirty}
        onClick={save}
      >
        Save pricing
      </SaveButton>
    </Section>
  );
}

function TrialSection({ account, now }: { account: AccountRow; now: number }) {
  const update = useMutation(api.subscriptions.adminUpdateAccount);
  const [busy, run] = useRun();
  const current =
    account.trialEndsAt ??
    (account.access.state === "trial" ? account.access.until : null);
  const [day, setDay] = useState(current ? dateInput(current) : "");

  const endsAt = endOfDay(day);
  // A subscription that still stands decides the account's access, so a
  // trial date would change nothing — and saving it would relabel an
  // account Razorpay is charging as being on trial.
  const governed =
    account.subscription !== null && STANDING.has(account.subscription.status);

  const save = () => {
    if (endsAt === null) return;
    void run("Could not change the trial", async () => {
      await update({
        workspaceId: account.workspaceId,
        mode: "trial",
        trialEndsAt: endsAt,
      });
      return {
        title: `${account.name}'s trial ends ${formatDay(endsAt)}`,
        description:
          endsAt < now
            ? "That day has passed, so the dashboard locks."
            : `That is ${daysFrom(endsAt, now)}.`,
      };
    });
  };

  return (
    <Section
      title="Free trial"
      description="The last day the dashboard is open without a plan being paid for."
    >
      {governed ? (
        <Note>
          Its Razorpay subscription decides whether the dashboard is open, so a
          trial date would change nothing. Cancel the subscription first to give
          it more time.
        </Note>
      ) : (
        <>
          <Field
            id="manage-trial"
            label="Trial ends on"
            hint={
              endsAt === null
                ? current
                  ? undefined
                  : "Pick a day."
                : endsAt < now
                  ? "That day has passed — saving it locks the dashboard."
                  : `Open until the end of ${formatDay(endsAt)}, ${daysFrom(endsAt, now)}.`
            }
          >
            <Input
              id="manage-trial"
              type="date"
              className="w-full sm:w-48"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </Field>
          {account.mode === "manual" ? (
            <Note tone="warn">
              It is billed by arrangement now. Saving a trial takes it off the
              arrangement and back onto the trial.
            </Note>
          ) : null}
          <SaveButton
            busy={busy}
            disabled={
              endsAt === null ||
              (endsAt === current && account.mode === "trial")
            }
            onClick={save}
          >
            {current !== null && endsAt !== null && endsAt < current
              ? "Shorten trial"
              : "Extend trial"}
          </SaveButton>
        </>
      )}
    </Section>
  );
}

function ArrangementSection({
  account,
  now,
}: {
  account: AccountRow;
  now: number;
}) {
  const update = useMutation(api.subscriptions.adminUpdateAccount);
  const [busy, run] = useRun();
  const wasManual = account.mode === "manual";
  const [manual, setManual] = useState(wasManual);
  const [through, setThrough] = useState(
    account.manualPaidThrough ? dateInput(account.manualPaidThrough) : ""
  );

  const throughAt = through ? endOfDay(through) : null;
  const dirty =
    manual !== wasManual || (manual && throughAt !== account.manualPaidThrough);

  const save = () =>
    void run("Could not change the arrangement", async () => {
      if (manual) {
        await update({
          workspaceId: account.workspaceId,
          mode: "manual",
          manualPaidThrough: throughAt,
        });
        return {
          title: `${account.name} is billed by arrangement`,
          description: throughAt
            ? `The dashboard stays open through ${formatDay(throughAt)}.`
            : "Open-ended, until you change it.",
        };
      }
      await update({ workspaceId: account.workspaceId, mode: "trial" });
      return {
        title: `${account.name} is back on its trial`,
        description: "It can check out from its Billing page.",
      };
    });

  return (
    <Section
      title="Bill by arrangement"
      description="Invoiced outside Razorpay, or given away. The dashboard stays open through the paid-through day, then runs the usual grace period before it locks."
    >
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <Label htmlFor="manage-manual" className="font-normal">
          Billed by arrangement
        </Label>
        <Switch
          id="manage-manual"
          checked={manual}
          onCheckedChange={setManual}
        />
      </div>
      {manual ? (
        <Field
          id="manage-through"
          label="Paid through"
          hint={
            throughAt
              ? throughAt < now
                ? `Ended ${daysFrom(throughAt, now)} — the grace period runs from there.`
                : `Open until the end of ${formatDay(throughAt)}.`
              : "Blank for open-ended."
          }
        >
          <Input
            id="manage-through"
            type="date"
            className="w-full sm:w-48"
            value={through}
            onChange={(event) => setThrough(event.target.value)}
          />
        </Field>
      ) : null}
      {manual && !wasManual && isStanding(account) ? (
        <Note tone="warn">
          Razorpay is charging this account, and would bill it twice. Cancel its
          subscription below first.
        </Note>
      ) : null}
      {!manual && wasManual ? (
        <Note tone="warn">
          Off puts it back on its trial
          {account.trialEndsAt
            ? `, which ${account.trialEndsAt < now ? "ended" : "ends"} ${formatDay(account.trialEndsAt)}`
            : ""}
          . If that has passed the dashboard locks until the company checks out
          — extend the trial as well to give it time.
        </Note>
      ) : null}
      <SaveButton busy={busy} disabled={!dirty} onClick={save}>
        Save arrangement
      </SaveButton>
    </Section>
  );
}

function SubscriptionSection({
  account,
  now,
}: {
  account: AccountRow;
  now: number;
}) {
  const money = moneyIn(account.currency);
  const cancel = useAction(api.razorpay.cancelSubscription);
  const refresh = useAction(api.razorpay.refresh);
  const [cancelling, runCancel] = useRun();
  const [refreshing, runRefresh] = useRun();
  const subscription = account.subscription!;
  const cancellable =
    STANDING.has(subscription.status) && !subscription.cancelAtCycleEnd;
  // Set to stop at the period's end, it can still be brought forward.
  const endable =
    STANDING.has(subscription.status) && subscription.cancelAtCycleEnd;

  const endNow = () =>
    void runCancel("Could not end the subscription", async () => {
      await cancel({ workspaceId: account.workspaceId, immediately: true });
      return {
        title: "Subscription ended",
        description: `${account.name} is off its plan now and is not charged again.`,
      };
    });

  const doCancel = () =>
    void runCancel("Could not cancel the subscription", async () => {
      const { atCycleEnd } = await cancel({ workspaceId: account.workspaceId });
      return atCycleEnd
        ? {
            title: "Cancels at the end of the period",
            description: subscription.currentEnd
              ? `${account.name} keeps its plan until ${formatDay(subscription.currentEnd)}, and is not charged again.`
              : `${account.name} is not charged again.`,
          }
        : {
            title: "Subscription cancelled",
            description: `Razorpay will not charge ${account.name} again.`,
          };
    });

  const doRefresh = () =>
    void runRefresh("Could not read Razorpay", async () => {
      const { refreshed } = await refresh({ workspaceId: account.workspaceId });
      return {
        title:
          refreshed === 0
            ? "Nothing to read back"
            : "Brought up to date from Razorpay",
        description:
          refreshed === 0
            ? "This account has no subscription on record at Razorpay."
            : `${refreshed} subscription${refreshed === 1 ? "" : "s"} read back.`,
      };
    });

  const facts: Array<[string, string]> = [
    ["Status", subscriptionLabel(subscription.status)],
    [
      "Charged",
      `${money(subscription.totalMicros)} a month, incl. ${money(subscription.gstMicros)} GST`,
    ],
    ["Payments made", subscription.paidCount.toLocaleString()],
    [
      "This period",
      subscription.currentStart && subscription.currentEnd
        ? `${formatDay(subscription.currentStart)} – ${formatDay(subscription.currentEnd)}`
        : "—",
    ],
    [
      "Next charge",
      subscription.cancelAtCycleEnd
        ? "None — cancels at period end"
        : subscription.chargeAt
          ? `${formatDay(subscription.chargeAt)} · ${daysFrom(subscription.chargeAt, now)}`
          : "—",
    ],
  ];

  return (
    <Section
      title="Razorpay subscription"
      description={`Created ${formatDay(subscription.createdAt)}, with ${subscription.extraAgents} extra ${subscription.extraAgents === 1 ? "agent" : "agents"}.`}
    >
      <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[8rem_1fr]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={doRefresh}
        >
          {refreshing ? <Spinner /> : <ArrowsClockwiseIcon />} Refresh from
          Razorpay
        </Button>
        {endable ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="destructive" disabled={cancelling}>
                  {cancelling ? <Spinner /> : <XCircleIcon />} End now
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  End {account.name}&apos;s subscription now?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  It is set to stop at the end of the period. Ending it now
                  takes the account off its plan today, with no refund for the
                  rest of the period — the dashboard then follows its trial or
                  locks.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  render={<Button variant="ghost">Keep it</Button>}
                />
                <AlertDialogAction
                  render={
                    <Button variant="destructive" onClick={endNow}>
                      End now
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {cancellable ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="destructive" disabled={cancelling}>
                  {cancelling ? <Spinner /> : <XCircleIcon />} Cancel
                  subscription
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Cancel {account.name}&apos;s subscription?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Once it has been charged, it stops at the end of the period
                  already paid for and the dashboard stays open until then.
                  Otherwise it stops now. Either way Razorpay does not charge it
                  again, and the company can check out afresh from its Billing
                  page.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  render={<Button variant="ghost">Keep it</Button>}
                />
                <AlertDialogAction
                  render={
                    <Button variant="destructive" onClick={doCancel}>
                      Cancel subscription
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </Section>
  );
}

function WalletSection({ account }: { account: AccountRow }) {
  const money = moneyIn(account.currency);
  const adjust = useMutation(api.wallet.adminAdjust);
  const [busy, run] = useRun();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const value = num(amount);
  const badAmount =
    amount.trim() !== "" && (!Number.isFinite(value) || value === 0);
  const ready = Number.isFinite(value) && value !== 0 && note.trim() !== "";

  const save = async () => {
    if (!ready) return;
    const ok = await run("Could not adjust the wallet", async () => {
      const balanceMicros = await adjust({
        workspaceId: account.workspaceId,
        amount: value,
        note,
      });
      return {
        title:
          value > 0
            ? `Added ${money(toMicros(value))} to ${account.name}'s wallet`
            : `Took ${money(toMicros(-value))} off ${account.name}'s wallet`,
        description: `New balance ${money(balanceMicros)}.`,
      };
    });
    if (ok) {
      setAmount("");
      setNote("");
    }
  };

  return (
    <Section
      title="Wallet"
      description={
        <>
          Holds{" "}
          <span
            className={cn(
              "font-medium",
              account.balanceMicros < 0 ? "text-destructive" : "text-foreground"
            )}
          >
            {money(account.balanceMicros)}
          </span>
          {account.autoRecharge
            ? ", and recharges itself when it runs low"
            : ""}
          . A positive amount adds credit and a negative one takes it off — no
          payment is taken. The reason shows in the account&apos;s wallet
          history.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <Field id="manage-adjust" label="Amount">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
              {currencySymbol(account.currency)}
            </span>
            <Input
              id="manage-adjust"
              type="number"
              inputMode="decimal"
              step="any"
              value={amount}
              placeholder="500 or -500"
              aria-invalid={badAmount || undefined}
              className="pl-6 tabular-nums"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </Field>
        <Field id="manage-adjust-note" label="Reason">
          <Input
            id="manage-adjust-note"
            value={note}
            maxLength={200}
            placeholder="Refund for the failed campaign on 3 Sep"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>
      <SaveButton busy={busy} disabled={!ready} onClick={() => void save()}>
        Adjust wallet
      </SaveButton>
    </Section>
  );
}

function NoteSection({ account }: { account: AccountRow }) {
  const update = useMutation(api.subscriptions.adminUpdateAccount);
  const [busy, run] = useRun();
  const [note, setNote] = useState(account.adminNote);
  const dirty = note.trim() !== account.adminNote.trim();

  const save = () =>
    void run("Could not save the note", async () => {
      await update({ workspaceId: account.workspaceId, adminNote: note });
      return { title: "Note saved" };
    });

  return (
    <Section
      title="Admin note"
      description="For administrators only — what was agreed, and with whom. The company does not see it."
    >
      <Textarea
        id="manage-note"
        aria-label="Admin note"
        rows={3}
        value={note}
        placeholder="Six months at 20% off agreed with the owner on the call of 2 Sep."
        onChange={(event) => setNote(event.target.value)}
      />
      <SaveButton busy={busy} disabled={!dirty} onClick={save}>
        Save note
      </SaveButton>
    </Section>
  );
}

/**
 * Everything the dialog shows for one account. Keyed by its caller on each
 * opening, so every section starts from the account as it is now.
 */
function ManageBody({
  account,
  plans,
  currencies,
  now,
}: {
  account: AccountRow;
  plans: Plan[];
  currencies: string[];
  now: number;
}) {
  const line = standingLine(account, now);
  return (
    <>
      <DialogHeader>
        <div className="flex min-w-0 items-center gap-3 pr-8">
          <CompanyLogo src={account.logoSrc} className="size-10 rounded-lg" />
          <div className="grid min-w-0 gap-1">
            <DialogTitle className="truncate">{account.name}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <AccessBadge access={account.access} />
              <span>
                {account.planName ?? "No plan"} · {MODE_LABEL[account.mode]}
                {line ? ` · ${line}` : ""}
              </span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <DialogBody>
        <CurrencySection account={account} currencies={currencies} />
        <PlanSection account={account} plans={plans} />
        <PricingSection account={account} />
        <TrialSection account={account} now={now} />
        <ArrangementSection account={account} now={now} />
        {account.subscription ? (
          <SubscriptionSection account={account} now={now} />
        ) : null}
        <WalletSection account={account} />
        <NoteSection account={account} />
      </DialogBody>

      <DialogFooter className="sm:justify-between">
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link href={`/w/${account.slug}/billing`} />}
        >
          <ArrowSquareOutIcon /> Open its billing page
        </Button>
        <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
      </DialogFooter>
    </>
  );
}

/**
 * Every account's platform fee: which plan it is on, whether its dashboard is
 * open, what Razorpay charges it, and what its wallet holds.
 */
export default function AdminSubscriptionsPage() {
  const now = useHourBucket();
  const data = useQuery(api.subscriptions.adminAccounts, { now });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // The dialog holds the account's id, not a copy of the row, so what it
  // shows follows the live query as each save lands.
  const [selectedId, setSelectedId] = useState<Id<"workspaces"> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [session, setSession] = useState(0);

  const openManage = (row: AccountRow) => {
    setSelectedId(row.workspaceId);
    setSession((n) => n + 1);
    setDialogOpen(true);
  };

  const accounts = data?.accounts ?? [];
  const selected =
    accounts.find((row) => row.workspaceId === selectedId) ?? null;

  const counts: Record<Filter, number> = {
    all: accounts.length,
    active: 0,
    trial: 0,
    grace: 0,
    locked: 0,
  };
  for (const row of accounts) {
    if (row.access.state !== "open") counts[row.access.state] += 1;
  }

  const recurring = accounts.filter(isCharging);
  // Each currency on its own: rupees and dollars do not add up.
  const byCurrency = (
    pick: (row: AccountRow) => number,
    from: AccountRow[]
  ) => {
    const totals = new Map<string, number>();
    for (const row of from)
      totals.set(row.currency, (totals.get(row.currency) ?? 0) + pick(row));
    const parts = [...totals.entries()].map(([code, micros]) =>
      moneyIn(code)(micros)
    );
    return parts.length > 0
      ? parts.join(" · ")
      : moneyIn(data?.currency ?? "INR")(0);
  };
  const recurringTotal = byCurrency((row) => row.monthlyMicros ?? 0, recurring);
  const walletTotal = byCurrency((row) => row.balanceMicros, accounts);
  const belowZero = accounts.filter((row) => row.balanceMicros < 0).length;
  const endingSoon = accounts.filter(
    (row) =>
      row.access.state === "trial" &&
      row.access.until !== null &&
      row.access.until - now < 7 * DAY_MS
  ).length;

  const needle = search.trim().toLowerCase();
  const rows = accounts.filter(
    (row) =>
      (filter === "all" || row.access.state === filter) &&
      (!needle ||
        row.name.toLowerCase().includes(needle) ||
        row.slug.includes(needle))
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Subscriptions
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Which plan each company is on, whether its dashboard is open, what
            Razorpay charges it and what its wallet holds.
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/admin/plans" />}
        >
          Plans &amp; pricing
        </Button>
      </header>

      {data === undefined ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner /> Loading subscriptions…
        </div>
      ) : !data.enabled ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CreditCardIcon />
            </EmptyMedia>
            <EmptyTitle>Billing is off</EmptyTitle>
            <EmptyDescription>
              No account is on a plan or a trial yet, and no dashboard locks.
              Switch billing on from Plans &amp; pricing to start
              everyone&apos;s free trial.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/admin/plans" />}>
              Go to plans &amp; pricing
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Tile
              label="Active"
              value={counts.active.toLocaleString()}
              hint="Paying, or by arrangement"
            />
            <Tile
              label="Free trial"
              value={counts.trial.toLocaleString()}
              hint={
                endingSoon > 0
                  ? `${endingSoon} end within a week`
                  : "None ending this week"
              }
            />
            <Tile
              label="Payment due"
              value={counts.grace.toLocaleString()}
              hint="In the grace period"
              tone={
                counts.grace > 0
                  ? "text-amber-700 dark:text-amber-300"
                  : undefined
              }
            />
            <Tile
              label="Locked"
              value={counts.locked.toLocaleString()}
              hint="Dashboard shut; agents still answer"
              tone={counts.locked > 0 ? "text-destructive" : undefined}
            />
            <Tile
              label="Monthly recurring (Razorpay)"
              value={recurringTotal}
              hint={`${recurring.length} ${recurring.length === 1 ? "subscription" : "subscriptions"} · incl. GST`}
            />
            <Tile
              label="Wallet balances"
              value={walletTotal}
              hint={
                belowZero > 0
                  ? `${belowZero} below zero`
                  : "Across every account"
              }
            />
          </div>

          <Card className="shrink-0">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Accounts</CardTitle>
                <CardDescription>
                  Open one to change its plan, discount, trial or wallet.
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  placeholder="Find an account"
                  className="pl-8"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((option) => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    count={counts[option.value]}
                    active={filter === option.value}
                    onPress={() => setFilter(option.value)}
                  />
                ))}
              </div>

              {/* Scrolls inside the card, as the message billing page does:
                  the height goes on Table's own container, which already
                  scrolls sideways, so the sticky header pins to that box. */}
              <div className="overflow-hidden rounded-md border *:data-[slot=table-container]:max-h-[min(36rem,65svh)] *:data-[slot=table-container]:overflow-y-auto *:data-[slot=table-container]:overscroll-contain">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                    <TableRow>
                      <TableHead className="min-w-48">Account</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">
                        Agents
                      </TableHead>
                      <TableHead className="hidden text-right md:table-cell">
                        Monthly
                      </TableHead>
                      <TableHead className="text-right">Wallet</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const line = standingLine(row, now);
                      return (
                        <TableRow key={row.workspaceId}>
                          <TableCell className="max-w-64 min-w-0">
                            <Link
                              href={`/w/${row.slug}/billing`}
                              className="flex min-w-0 items-center gap-2.5 hover:underline"
                            >
                              <CompanyLogo
                                src={row.logoSrc}
                                className="size-8 rounded-md"
                              />
                              <span className="grid min-w-0 leading-tight">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-medium">
                                    {row.name}
                                  </span>
                                  {row.status === "archived" ? (
                                    <Badge variant="secondary">archived</Badge>
                                  ) : null}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {row.planName ?? "No plan"} ·{" "}
                                  {MODE_LABEL[row.mode]}
                                  {row.discountPercent > 0
                                    ? ` · ${row.discountPercent}% off`
                                    : ""}
                                </span>
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-col items-start gap-1">
                              <AccessBadge access={row.access} />
                              {line ? (
                                <span className="text-xs whitespace-nowrap text-muted-foreground">
                                  {line}
                                </span>
                              ) : null}
                              {row.subscription ? (
                                <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                                  Razorpay:{" "}
                                  {subscriptionLabel(row.subscription.status)}
                                  {row.subscription.cancelAtCycleEnd
                                    ? " · cancels at period end"
                                    : ""}
                                </span>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <SeatsCell seats={row.seats} />
                          </TableCell>
                          <TableCell className="hidden text-right whitespace-nowrap tabular-nums md:table-cell">
                            {row.monthlyMicros === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <>
                                {/* The subscription's own amount when
                                    Razorpay is charging; otherwise what a
                                    checkout would come to today. */}
                                <span
                                  className={
                                    isCharging(row)
                                      ? "font-medium"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {moneyIn(row.currency)(row.monthlyMicros)}
                                </span>
                                <span className="block text-[11px] text-muted-foreground">
                                  {isCharging(row)
                                    ? "incl. GST"
                                    : "quote · incl. GST"}
                                </span>
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            <span
                              className={cn(
                                "font-medium",
                                row.balanceMicros < 0 && "text-destructive"
                              )}
                            >
                              {moneyIn(row.currency)(row.balanceMicros)}
                            </span>
                            {row.autoRecharge ? (
                              <span className="block text-[11px] text-muted-foreground">
                                auto-recharge
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Manage"
                              aria-label={`Manage ${row.name}`}
                              onClick={() => openManage(row)}
                            >
                              <SlidersHorizontalIcon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {needle || filter !== "all"
                    ? "No account matches that."
                    : "No accounts yet."}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* One dialog for the whole table, outside it, holding whichever
              account was opened — not one mounted per row. */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-2xl">
              {selected ? (
                <ManageBody
                  key={session}
                  account={selected}
                  plans={data.plans}
                  currencies={data.currencies.map((row) => row.currency)}
                  now={now}
                />
              ) : (
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <WarningIcon /> That account is gone
                  </DialogTitle>
                  <DialogDescription>
                    It was deleted while this was open.
                  </DialogDescription>
                </DialogHeader>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
