"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  APPROVAL_LIMIT_MICROS,
  LIVE_STATUSES,
  MAX_EXTRA_AGENTS,
  extrasNeeded,
  isValidGstin,
  quote,
} from "@/convex/lib/plans";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { CheckoutClosed, openCheckout } from "@/components/billing/checkout";
import {
  AccessBadge,
  IncludedAgents,
  PlanFeatures,
  StrikePrice,
  daysFrom,
  formatDay,
  inr,
  subscriptionLabel,
} from "@/components/billing/plan-bits";
import { errorMessage } from "@/lib/convex-server";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  FloppyDiskIcon,
  MinusIcon,
  PlusIcon,
  ReceiptIcon,
  RobotIcon,
  UserIcon,
  UsersThreeIcon,
  WarningIcon,
} from "@phosphor-icons/react";

type Overview = FunctionReturnType<typeof api.subscriptions.overview>;
type Enabled = Extract<Overview, { enabled: true }>;
type Plan = Enabled["plans"][number];
type Profile = Pick<
  Enabled["account"],
  | "billingName"
  | "gstin"
  | "billingEmail"
  | "billingPhone"
  | "billingAddress"
  | "billingState"
>;

const PAGE = 20;
/** Razorpay's "authenticated" and "active": a subscription that grants the plan. */
const LIVE = new Set(LIVE_STATUSES);
/** Still being charged, or being retried — what the company pays, and can cancel. */
const CHARGING = new Set([...LIVE_STATUSES, "pending", "halted"]);

const agents = (count: number) => `${count} ${count === 1 ? "agent" : "agents"}`;

/**
 * Checkout closed by the person is a choice, not a failure: it is said
 * plainly, without the error styling.
 */
function report(title: string, error: unknown) {
  if (error instanceof CheckoutClosed) {
    toast.add({
      title: "Payment not completed",
      description: "The Razorpay window was closed before it finished. Nothing has changed.",
    });
    return;
  }
  toast.add({ title, description: errorMessage(error), type: "error" });
}

/**
 * The platform fee: which plan the workspace is on, what it pays each
 * month, the seats it is using, and the way to change any of it.
 *
 * Everything that spends money is the workspace's own login's call (or an
 * administrator's); a human agent sees the same page read-only.
 */
export function PlanTab() {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const data = useQuery(api.subscriptions.overview, {
    workspaceId: workspace._id,
    now,
  });

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> Loading your plan…
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptIcon />
          </EmptyMedia>
          <EmptyTitle>Plans aren&apos;t switched on for this platform yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const profile: Profile = {
    billingName: data.account.billingName,
    gstin: data.account.gstin,
    billingEmail: data.account.billingEmail,
    billingPhone: data.account.billingPhone,
    billingAddress: data.account.billingAddress,
    billingState: data.account.billingState,
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <StatusCard data={data} now={now} />
        <SeatsCard data={data} />
      </div>

      {data.account.mode === "manual" ? (
        <Alert>
          <ReceiptIcon />
          <AlertTitle>Your plan is billed by arrangement</AlertTitle>
          <AlertDescription>
            It is invoiced to you directly rather than through Razorpay, so it
            is not changed here. Get in touch with us to change the plan or add
            extra agents.
          </AlertDescription>
        </Alert>
      ) : !data.isOwner ? (
        <Alert>
          <ReceiptIcon />
          <AlertTitle>Only the account&apos;s own login can change the plan</AlertTitle>
          <AlertDescription>
            You can see what the workspace is on and what it pays. Ask whoever
            manages the account to change the plan or add extra agents.
          </AlertDescription>
        </Alert>
      ) : (
        // Keyed on what the account is on, so a switch that lands resets the
        // picker to the new plan rather than leaving the old choice in it.
        <PlanPicker
          key={`${data.plan?._id ?? ""}:${data.account.extraAgents}:${data.subscription?._id ?? ""}`}
          data={data}
        />
      )}

      {/* Keyed on the saved values, so the form starts from what is stored
          and resets after a save — no effect copying the query into state. */}
      <BillingDetails
        key={JSON.stringify(profile)}
        saved={profile}
        canEdit={data.isOwner}
      />

      <PaymentHistory />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where the account stands
// ---------------------------------------------------------------------------

type KeyDate = { label: string; at: number; danger?: boolean };

/** The dates worth knowing: when the trial ends, the next charge, the lock. */
function keyDates(data: Enabled): KeyDate[] {
  const { access, subscription, account } = data;
  const rows: KeyDate[] = [];

  if (access.state === "trial" && access.until) {
    rows.push({ label: "Free trial ends", at: access.until });
  }
  if (access.state === "grace" && access.until) {
    rows.push({ label: "Dashboard locks", at: access.until, danger: true });
  }
  if (account.mode === "manual") {
    if (account.manualPaidThrough) {
      rows.push({ label: "Paid up to", at: account.manualPaidThrough });
    }
    return rows;
  }
  if (!subscription) return rows;

  const next = subscription.chargeAt ?? subscription.currentEnd ?? subscription.startAt;
  const end = subscription.currentEnd ?? subscription.chargeAt ?? subscription.startAt;
  if (LIVE.has(subscription.status)) {
    if (subscription.cancelAtCycleEnd) {
      if (end) rows.push({ label: "Ends on", at: end });
    } else if (next) {
      rows.push({
        // Authorised during a trial or a paid month, and not charged yet.
        label: subscription.paidCount === 0 ? "First charge" : "Renews on",
        at: next,
      });
    }
  } else if (!CHARGING.has(subscription.status) && access.state === "active" && access.until) {
    // Cancelled, and running on to the end of the month it paid for.
    rows.push({ label: "Ends on", at: access.until });
  }
  return rows;
}

function StatusCard({ data, now }: { data: Enabled; now: number }) {
  const workspace = useWorkspace();
  const cancelSubscription = useAction(api.razorpay.cancelSubscription);
  const refresh = useAction(api.razorpay.refresh);
  const [busy, setBusy] = useState<"cancel" | "refresh" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { access, plan, subscription, pending, account, quote: priced } = data;
  const manual = account.mode === "manual";
  const charging =
    subscription && CHARGING.has(subscription.status) ? subscription : null;
  const cancellable =
    data.isOwner && !manual && charging !== null && !charging.cancelAtCycleEnd;
  // Cancelling runs a charged month to its end; one that has not charged yet
  // — authorised during a trial — stops at once. Said before, not after.
  const charged = (charging?.paidCount ?? 0) > 0;
  const runsToEnd = charging?.status === "active" && charged;
  const periodEnd = charging?.currentEnd ?? charging?.chargeAt ?? null;
  const pendingPlan = pending
    ? data.plans.find((row) => row._id === pending.planId)
    : null;
  const dates = keyDates(data);

  const monthly = charging
    ? {
        subtotal: charging.subtotalMicros,
        gst: charging.gstMicros,
        gstLabel: "GST",
        total: charging.totalMicros,
      }
    : priced
      ? {
          subtotal: priced.subtotalMicros,
          gst: priced.gstMicros,
          gstLabel: `GST ${priced.gstPercent}%`,
          total: priced.totalMicros,
        }
      : null;
  const extras = charging?.extraAgents ?? account.extraAgents;

  const cancel = async () => {
    setBusy("cancel");
    try {
      const result = await cancelSubscription({ workspaceId: workspace._id });
      setConfirming(false);
      toast.add({
        title:
          result.atCycleEnd && periodEnd
            ? `Your plan ends on ${formatDay(periodEnd)}`
            : "Your plan is cancelled",
        description: result.atCycleEnd
          ? "Nothing more is charged. Everything stays open until then."
          : "Nothing more is charged.",
        type: "success",
      });
    } catch (error) {
      report("Could not cancel the plan", error);
    } finally {
      setBusy(null);
    }
  };

  const checkAgain = async () => {
    setBusy("refresh");
    try {
      await refresh({ workspaceId: workspace._id });
      toast.add({
        title: "Checked with Razorpay",
        description: "This page now shows what Razorpay has on record.",
        type: "success",
      });
    } catch (error) {
      report("Could not check with Razorpay", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {plan ? `${plan.name} plan` : "No plan yet"}
          <AccessBadge access={access} />
        </CardTitle>
        {access.state === "grace" || access.state === "locked" ? (
          <CardDescription>{access.reason}</CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {dates.length > 0 || charging ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {dates.map((row) => (
              <div key={row.label} className="flex flex-col gap-0.5">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    "text-sm font-medium",
                    row.danger && "text-destructive"
                  )}
                >
                  {formatDay(row.at)}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {daysFrom(row.at, now)}
                  </span>
                </dd>
              </div>
            ))}
            {charging ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Autopay
                </dt>
                <dd className="text-sm font-medium">
                  {subscriptionLabel(charging.status)}
                  {charging.cancelAtCycleEnd ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · cancelled at period end
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {!manual && monthly ? (
          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {charging ? "What you pay each month" : "What this plan comes to each month"}
            </p>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {plan?.name ?? "Plan"}
                {extras > 0 ? ` + ${extras} extra ${extras === 1 ? "agent" : "agents"}` : ""}
              </span>
              <span className="tabular-nums">{inr(monthly.subtotal)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{monthly.gstLabel}</span>
              <span className="tabular-nums">{inr(monthly.gst)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
              <span className="text-sm font-medium">Total a month</span>
              <span className="font-heading text-lg font-semibold tabular-nums">
                {inr(monthly.total)}
              </span>
            </div>
          </div>
        ) : null}

        {pending ? (
          <Alert>
            <ArrowClockwiseIcon />
            <AlertTitle>A checkout hasn&apos;t been authorised yet</AlertTitle>
            <AlertDescription>
              {pendingPlan ? `The ${pendingPlan.name} plan` : "A plan"}
              {pending.extraAgents > 0 ? ` with ${pending.extraAgents} extra ${pending.extraAgents === 1 ? "agent" : "agents"}` : ""}{" "}
              was started {daysFrom(pending.createdAt, now)} and Razorpay
              hasn&apos;t confirmed it.
              {data.isOwner
                ? " If you finished it, check again; otherwise pick the plan below to start over."
                : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      {data.isOwner && !manual && (cancellable || pending) ? (
        <CardFooter className="flex flex-wrap justify-end gap-2">
          {pending ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={checkAgain}
            >
              {busy === "refresh" ? <Spinner /> : <ArrowClockwiseIcon />} Check
              again
            </Button>
          ) : null}
          {cancellable ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirming(true)}
            >
              Cancel plan
            </Button>
          ) : null}
        </CardFooter>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your plan?</AlertDialogTitle>
            <AlertDialogDescription>
              {runsToEnd && periodEnd
                ? `Nothing more is charged. The month you've paid for runs to its end, on ${formatDay(periodEnd)}; after that the dashboard locks, apart from Billing, until a plan is active again.`
                : !charged
                  ? "It hasn't charged yet, so it stops straight away and nothing is charged. If your free trial has already ended, the dashboard locks, apart from Billing, until a plan is active again."
                  : "It stops straight away and nothing more is charged. Once the time you've paid for is up, the dashboard locks, apart from Billing, until a plan is active again."}{" "}
              Your agents keep answering customers either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "cancel"}>
              Keep my plan
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy === "cancel"}
              onClick={cancel}
            >
              {busy === "cancel" ? <Spinner /> : null} Cancel plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

function SeatsCard({ data }: { data: Enabled }) {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const { seats, used, plan } = data;

  const rows = seats
    ? [
        {
          icon: RobotIcon,
          label: "Custom agents live",
          used: used.ai,
          of: seats.ai.included,
          noun: "included",
        },
        {
          icon: UserIcon,
          label: "Human agents with a login",
          used: used.human,
          of: seats.human.included,
          noun: "included",
        },
        {
          icon: UsersThreeIcon,
          label: "Extra agents in use",
          used: seats.extra.used,
          of: seats.extra.bought,
          noun: "bought",
        },
      ]
    : [];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Agents on your plan</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {seats && plan ? (
          <>
            {seats.over > 0 ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>
                  You&apos;re over your plan by {agents(seats.over)}
                </AlertTitle>
                <AlertDescription>
                  More agents are live than the {plan.name} plan and its extra
                  agents cover. Pause a custom agent or revoke a human
                  agent&apos;s login,{" "}
                  {data.isOwner
                    ? "or add extra agents below."
                    : "or ask whoever manages the account to add extra agents."}
                </AlertDescription>
              </Alert>
            ) : null}

            <ul className="flex flex-col gap-3">
              {rows.map((row) => {
                const Icon = row.icon;
                const over = row.used > row.of;
                const share = row.of > 0 ? Math.min(1, row.used / row.of) : row.used > 0 ? 1 : 0;
                return (
                  <li key={row.label} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{row.label}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-medium">{row.used}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          of {row.of} {row.noun}
                        </span>
                      </span>
                    </div>
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`${row.used} of ${row.of}`}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full",
                          over
                            ? row.noun === "bought"
                              ? "bg-destructive"
                              : "bg-amber-500"
                            : "bg-primary"
                        )}
                        style={{ width: `${share * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            There is no plan to measure against yet.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`${base}/agents`} />}
        >
          Agents <ArrowRightIcon />
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`${base}/team`} />}
        >
          Team <ArrowRightIcon />
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Choosing a plan
// ---------------------------------------------------------------------------

function PlanPicker({ data }: { data: Enabled }) {
  const workspace = useWorkspace();
  const startSubscription = useAction(api.razorpay.startSubscription);
  const confirmSubscription = useAction(api.razorpay.confirmSubscription);
  const { plans, plan: current, subscription, account, used } = data;
  const live =
    subscription && LIVE.has(subscription.status) ? subscription : null;

  // Enough extras to keep everything that is live now, and never fewer than
  // the account already pays for — a smaller plan should not strand anyone.
  const suggested = (plan: Plan) =>
    Math.min(
      MAX_EXTRA_AGENTS,
      Math.max(account.extraAgents, extrasNeeded(plan, used))
    );
  const initial =
    plans.find((row) => row._id === (live?.planId ?? current?._id)) ??
    plans.find((row) => row.highlighted) ??
    plans[0] ??
    null;

  const [chosenId, setChosenId] = useState(initial?._id ?? null);
  const [extras, setExtras] = useState(() => (initial ? suggested(initial) : 0));
  const [busy, setBusy] = useState(false);

  const chosen = plans.find((row) => row._id === chosenId) ?? null;

  if (!chosen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose a plan</CardTitle>
          <CardDescription>
            No plans are on sale yet. Get in touch and we&apos;ll set one up.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pick = (plan: Plan) => {
    setChosenId(plan._id);
    setExtras(suggested(plan));
  };
  const setClamped = (value: number) =>
    setExtras(
      Math.min(MAX_EXTRA_AGENTS, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0))
    );

  const needed = extrasNeeded(chosen, used);
  const stranded = Math.max(0, needed - extras);
  const summary = quote({
    plan: chosen,
    extraAgents: extras,
    settings: data.pricing,
    account: data.accountPricing,
  });
  const seat = { priceMicros: summary.seatMicros, listMicros: summary.seatListMicros };

  const same =
    live !== null && live.planId === chosen._id && live.extraAgents === extras;
  const unchanged = same && !live.cancelAtCycleEnd;
  const label = !live
    ? "Subscribe"
    : same
      ? "Keep this plan"
      : "Switch to this plan";

  // Where the new subscription starts charging, worked out by the server
  // with the rule the checkout is created with.
  const startsLater = data.nextStartAt;
  const payable = data.razorpayKeyId !== null;

  const subscribe = async () => {
    setBusy(true);
    try {
      const options = await startSubscription({
        workspaceId: workspace._id,
        planId: chosen._id,
        extraAgents: extras,
      });
      const response = await openCheckout(options);
      const razorpaySubscriptionId =
        response.razorpay_subscription_id ??
        (options.kind === "subscription" ? options.subscriptionId : undefined);
      if (!razorpaySubscriptionId) {
        throw new Error("Razorpay did not say which subscription was authorised.");
      }
      await confirmSubscription({
        workspaceId: workspace._id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySubscriptionId,
        razorpaySignature: response.razorpay_signature,
      });
      const startAt = options.kind === "subscription" ? options.startAt : null;
      toast.add({
        title: live ? `Switched to the ${chosen.name} plan` : `You're on the ${chosen.name} plan`,
        description: startAt
          ? `Its limits apply now. Nothing is charged until ${formatDay(startAt)}, and the ₹5 authorisation is refunded.`
          : "Its limits apply now, and Razorpay charges it each month from here.",
        type: "success",
      });
    } catch (error) {
      report("Could not start the plan", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{live ? "Change your plan" : "Choose a plan"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div
          role="radiogroup"
          aria-label="Plans"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {plans.map((plan) => {
            const selected = plan._id === chosen._id;
            const isCurrent = live !== null && plan._id === current?._id;
            return (
              // The plan's name is the radio, stretched over the whole card,
              // so the agents box can sit above it and open on its own.
              <div
                key={plan._id}
                className={cn(
                  "relative flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/30 has-[[role=radio]:focus-visible]:ring-3 has-[[role=radio]:focus-visible]:ring-ring/50",
                  selected &&
                    "border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/5"
                )}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => pick(plan)}
                      className="cursor-pointer text-left font-heading text-lg font-semibold outline-none after:absolute after:inset-0 after:rounded-xl"
                    >
                      {plan.name}
                    </button>
                    {plan.highlighted ? <Badge>Most popular</Badge> : null}
                    {isCurrent ? <Badge variant="outline">Current</Badge> : null}
                    {plan.status === "hidden" ? (
                      <Badge variant="secondary">No longer on sale</Badge>
                    ) : null}
                  </div>
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <StrikePrice
                      priceMicros={plan.priceMicros}
                      listMicros={plan.listPriceMicros}
                      className="font-heading text-3xl font-semibold tracking-tight tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">
                      / month + GST
                    </span>
                  </p>
                  {plan.description ? (
                    <p className="text-sm text-muted-foreground">
                      {plan.description}
                    </p>
                  ) : null}
                </div>
                <IncludedAgents
                  plan={plan}
                  seat={seat}
                  selected={selected}
                  className="relative z-10"
                />
                {plan.features.length > 0 ? (
                  <PlanFeatures
                    features={plan.features}
                    className={selected ? undefined : "text-muted-foreground"}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ------------------------------------------- extra agents */}
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="extra-agents">Extra agents</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="One fewer extra agent"
                disabled={extras <= 0 || busy}
                onClick={() => setClamped(extras - 1)}
              >
                <MinusIcon />
              </Button>
              <Input
                id="extra-agents"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_EXTRA_AGENTS}
                step={1}
                value={extras}
                disabled={busy}
                onChange={(event) => setClamped(Number(event.target.value))}
                className="w-20 text-center tabular-nums"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="One more extra agent"
                disabled={extras >= MAX_EXTRA_AGENTS || busy}
                onClick={() => setClamped(extras + 1)}
              >
                <PlusIcon />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              <StrikePrice
                priceMicros={summary.seatMicros}
                listMicros={summary.seatListMicros}
                className="font-medium text-foreground"
              />{" "}
              each a month + GST
            </p>
            {needed > 0 ? (
              <p className="text-xs text-muted-foreground">
                What is live now needs {needed} extra{" "}
                {needed === 1 ? "agent" : "agents"} on {chosen.name}.
              </p>
            ) : null}
            {stranded > 0 ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>
                  {stranded === 1
                    ? "1 agent that is live now won't fit"
                    : `${stranded} agents that are live now won't fit`}
                </AlertTitle>
                <AlertDescription>
                  You can still go ahead. Afterwards, pause custom agents or
                  revoke logins until you are within the plan — or add{" "}
                  {stranded === 1 ? "an extra agent" : `${stranded} more extra agents`}{" "}
                  here.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          {/* ------------------------------------------------ summary */}
          <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              Each month
            </p>
            <dl className="flex flex-col gap-1.5 text-sm">
              <SummaryRow
                label={`${chosen.name} plan`}
                value={inr(summary.planMicros + summary.discountMicros)}
              />
              {summary.discountMicros > 0 ? (
                <SummaryRow
                  label={`Your discount (${summary.discountPercent}%)`}
                  value={`−${inr(summary.discountMicros)}`}
                  className="text-emerald-700 dark:text-emerald-400"
                />
              ) : null}
              {summary.extraAgents > 0 ? (
                <SummaryRow
                  label={`${summary.extraAgents} extra ${summary.extraAgents === 1 ? "agent" : "agents"} × ${inr(summary.seatMicros)}`}
                  value={inr(summary.seatsMicros)}
                />
              ) : null}
              <SummaryRow
                label="Subtotal"
                value={inr(summary.subtotalMicros)}
                className="border-t pt-1.5"
              />
              <SummaryRow
                label={`GST ${summary.gstPercent}%`}
                value={inr(summary.gstMicros)}
              />
              <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
                <dt className="font-medium">Total / month</dt>
                <dd className="font-heading text-xl font-semibold tabular-nums">
                  {inr(summary.totalMicros)}
                </dd>
              </div>
            </dl>

            <Button
              size="lg"
              disabled={busy || unchanged || !payable}
              onClick={subscribe}
            >
              {busy ? <Spinner /> : null}{" "}
              {unchanged ? "This is your plan" : label}
            </Button>

            <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
              {!payable ? (
                <p className="text-destructive">
                  Payments aren&apos;t set up on the platform yet, so a plan
                  can&apos;t be bought here. Get in touch and we&apos;ll sort it
                  out.
                </p>
              ) : startsLater ? (
                <p>You won&apos;t be charged until {formatDay(startsLater)}.</p>
              ) : null}
              {summary.totalMicros > APPROVAL_LIMIT_MICROS ? (
                <p>
                  At over ₹15,000 a month, card and UPI Autopay debits need
                  your approval each time.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who the invoice is made out to
// ---------------------------------------------------------------------------

/**
 * Keyed on the saved values by its parent, so the fields start from what is
 * stored and a save elsewhere resets them.
 */
function BillingDetails({
  saved,
  canEdit,
}: {
  saved: Profile;
  canEdit: boolean;
}) {
  const workspace = useWorkspace();
  const updateBillingProfile = useMutation(api.subscriptions.updateBillingProfile);
  const [draft, setDraft] = useState<Profile>(saved);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof Profile) => (value: string) =>
    setDraft((previous) => ({ ...previous, [field]: value }));
  const gstin = draft.gstin.trim();
  const gstinInvalid = gstin !== "" && !isValidGstin(gstin);

  const save = async () => {
    setBusy(true);
    try {
      await updateBillingProfile({ workspaceId: workspace._id, ...draft });
      toast.add({ title: "Billing details saved", type: "success" });
    } catch (error) {
      report("Could not save the billing details", error);
    } finally {
      setBusy(false);
    }
  };

  const field = (
    id: keyof Profile,
    label: string,
    props: React.ComponentProps<typeof Input> = {}
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`billing-${id}`}>{label}</Label>
      <Input
        id={`billing-${id}`}
        value={draft[id]}
        readOnly={!canEdit}
        disabled={busy}
        onChange={(event) => set(id)(event.target.value)}
        {...props}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {field("billingName", "Legal name", { autoComplete: "organization" })}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="billing-gstin">GSTIN</Label>
          <Input
            id="billing-gstin"
            value={draft.gstin}
            readOnly={!canEdit}
            disabled={busy}
            placeholder="Optional"
            aria-invalid={gstinInvalid || undefined}
            onChange={(event) => set("gstin")(event.target.value.toUpperCase())}
            className="font-mono uppercase"
          />
          {gstinInvalid ? (
            <p className="text-xs text-destructive">
              A GSTIN is 15 characters, like 29ABCDE1234F1Z5.
            </p>
          ) : null}
        </div>
        {field("billingEmail", "Billing email", {
          type: "email",
          autoComplete: "email",
        })}
        {field("billingPhone", "Phone, with country code", {
          type: "tel",
          autoComplete: "tel",
          placeholder: "+919876543210",
        })}
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="billing-address">Address</Label>
          <Textarea
            id="billing-address"
            rows={2}
            value={draft.billingAddress}
            readOnly={!canEdit}
            disabled={busy}
            autoComplete="street-address"
            onChange={(event) => set("billingAddress")(event.target.value)}
          />
        </div>
        {field("billingState", "State", { placeholder: "Karnataka" })}
      </CardContent>
      {canEdit ? (
        // Not held back until something changes: until the first save the
        // fields show the workspace's own contact details, which are not yet
        // the account's, and saving them as they are is a real change.
        <CardFooter className="justify-end">
          <Button disabled={busy || gstinInvalid} onClick={save}>
            {busy ? <Spinner /> : <FloppyDiskIcon />} Save details
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

const PURPOSE_LABEL: Record<Doc<"billingPayments">["purpose"], string> = {
  subscription: "Plan",
  wallet_topup: "Wallet top-up",
  auto_recharge: "Auto-recharge",
};

const STATUS: Record<
  Doc<"billingPayments">["status"],
  { label: string; tone: string }
> = {
  created: { label: "Not completed", tone: "bg-muted text-muted-foreground" },
  pending: {
    label: "Processing",
    tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
  },
  paid: {
    label: "Paid",
    tone: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  },
  failed: { label: "Failed", tone: "bg-destructive/10 text-destructive" },
};

function PaymentHistory() {
  const workspace = useWorkspace();
  const { results, status, loadMore } = usePaginatedQuery(
    api.subscriptions.payments,
    { workspaceId: workspace._id },
    { initialNumItems: PAGE }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment history</CardTitle>
      </CardHeader>
      <CardContent>
        {status === "LoadingFirstPage" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Loading payments…
          </div>
        ) : results.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ReceiptIcon />
              </EmptyMedia>
              <EmptyTitle>No payments yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="min-w-40">Description</TableHead>
                    <TableHead className="hidden md:table-cell">For</TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      Amount
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      GST
                    </TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((row) => {
                    const state = STATUS[row.status];
                    return (
                      <TableRow key={row._id}>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                          {formatDay(row.paidAt ?? row.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-64 min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {row.description}
                          </span>
                          {row.periodStart && row.periodEnd ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatDay(row.periodStart)} – {formatDay(row.periodEnd)}
                            </span>
                          ) : null}
                          <span className="block text-xs text-muted-foreground md:hidden">
                            {PURPOSE_LABEL[row.purpose]}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground md:table-cell">
                          {PURPOSE_LABEL[row.purpose]}
                        </TableCell>
                        <TableCell className="hidden text-right whitespace-nowrap tabular-nums md:table-cell">
                          {inr(row.subtotalMicros)}
                        </TableCell>
                        <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">
                          {inr(row.gstMicros)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {inr(row.totalMicros)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="secondary"
                            className={state.tone}
                            title={row.status === "failed" ? row.error : undefined}
                          >
                            {state.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {status === "CanLoadMore" || status === "LoadingMore" ? (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={status === "LoadingMore"}
                  onClick={() => loadMore(PAGE)}
                >
                  {status === "LoadingMore" ? <Spinner /> : null} Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
