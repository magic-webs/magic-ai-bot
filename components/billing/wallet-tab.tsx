"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { CheckoutOptions } from "@/convex/razorpay";
import { toMicros } from "@/convex/lib/billing";
import {
  APPROVAL_LIMIT_MICROS,
  MAX_TOPUP_MICROS,
  roundToPaise,
  withGst,
} from "@/convex/lib/plans";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import {
  CheckoutClosed,
  openCheckout,
  type CheckoutSuccess,
} from "@/components/billing/checkout";
import {
  daysFrom,
  formatDay,
  rupeesOf,
  useMoney,
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  ClockIcon,
  CreditCardIcon,
  FloppyDiskIcon,
  LightningIcon,
  QrCodeIcon,
  TrashIcon,
  WalletIcon,
  WarningIcon,
} from "@phosphor-icons/react";

type Summary = NonNullable<FunctionReturnType<typeof api.wallet.summary>>;

const PAGE = 20;
/** Top-up chips, as multiples of the minimum: ₹1,000–₹10,000, or $10–$100. */
const QUICK_MULTIPLES = [2, 5, 10, 20];
/**
 * The most one automatic debit may be, GST included. Above it every debit
 * needs the customer's approval, cards and UPI alike — convex/wallet.ts
 * refuses to authorise a mandate for more, and this says so before asking.
 */
const MANDATE_CAP_MICROS = APPROVAL_LIMIT_MICROS;

/**
 * Checkout closed by the person is a choice, not a failure: it is said
 * plainly, without the error styling.
 */
function report(title: string, error: unknown) {
  if (error instanceof CheckoutClosed) {
    toast.add({
      title: "Payment not completed",
      description:
        "The Razorpay window was closed before it finished. Nothing was charged.",
    });
    return;
  }
  toast.add({ title, description: errorMessage(error), type: "error" });
}

/** The order Checkout paid, from its answer or, failing that, from ours. */
function orderIdOf(
  options: CheckoutOptions,
  response: CheckoutSuccess
): string {
  const orderId =
    response.razorpay_order_id ??
    (options.kind === "order" ? options.orderId : undefined);
  if (!orderId) throw new Error("Razorpay did not say which order was paid.");
  return orderId;
}

/** A whole-rupee box's value, or null while it holds something else. */
function rupeesIn(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * The wallet WhatsApp messages are paid from: what it holds, how long that
 * lasts, and the two ways to fill it — by hand, or automatically from a
 * saved mandate when it runs low.
 *
 * Paying is the workspace's own login's call (or an administrator's); a
 * human agent sees the same page read-only.
 */
export function WalletTab() {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const data = useQuery(api.wallet.summary, {
    workspaceId: workspace._id,
    now,
  });

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> Loading the wallet…
      </div>
    );
  }

  if (data === null) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WalletIcon />
          </EmptyMedia>
          <EmptyTitle>The wallet isn&apos;t switched on yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div
        className={cn("grid min-w-0 gap-5", data.isOwner && "lg:grid-cols-2")}
      >
        <BalanceCard data={data} now={now} />
        {data.isOwner ? <TopUpCard data={data} /> : null}
      </div>

      {/* Keyed on the saved preferences, so the fields start from what is
          stored and reset after a save — no effect copying the query into
          state. */}
      <AutoRechargeCard
        key={JSON.stringify([
          data.thresholdMicros,
          data.autoRecharge.amountMicros,
          data.autoRecharge.enabled,
          data.hasMandate,
        ])}
        data={data}
      />

      <WalletHistory />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The balance
// ---------------------------------------------------------------------------

function BalanceCard({ data, now }: { data: Summary; now: number }) {
  const { money } = useMoney(useWorkspace()._id);
  const balance = data.balanceMicros;
  const perDay = data.spent7dMicros / 7;
  const days = perDay > 0 && balance > 0 ? Math.floor(balance / perDay) : null;
  // A busier week than one read covers makes the spend a floor, so the days
  // it would last are a ceiling.
  const pace =
    days === null
      ? null
      : days < 1
        ? "Less than a day of messages at last week's pace."
        : `${data.spendTruncated ? "At most about" : "About"} ${days} ${days === 1 ? "day" : "days"} of messages at last week's pace.`;
  const otherCurrency =
    data.rateCurrency && data.rateCurrency !== data.currency
      ? data.rateCurrency
      : null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Wallet balance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p
            className={cn(
              "font-heading text-4xl leading-none font-semibold tabular-nums",
              balance < 0 && "text-destructive"
            )}
          >
            {money(balance)}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.spent7dMicros > 0 ? (
              <>
                {money(data.spent7dMicros)}
                {data.spendTruncated ? " or more" : ""} spent in the last 7
                days. {pace}
              </>
            ) : (
              "Nothing was spent in the last 7 days."
            )}
          </p>
        </div>

        {data.lowBalance ? (
          <Alert variant={balance <= 0 ? "destructive" : "default"}>
            <WarningIcon />
            <AlertTitle>
              {balance <= 0 ? "Your wallet has run out" : "Your balance is low"}
            </AlertTitle>
            <AlertDescription>
              It is below your low-balance line of {money(data.thresholdMicros)}
              . Marketing, utility and authentication templates are held back
              when the balance can&apos;t cover one. Service replies always go
              out, even when that takes the balance below zero.
            </AlertDescription>
          </Alert>
        ) : null}

        {data.inFlight ? (
          <Alert>
            <ClockIcon />
            <AlertTitle>An auto-recharge is on its way</AlertTitle>
            <AlertDescription>
              An auto-recharge of {money(data.inFlight.totalMicros)} was
              requested {daysFrom(data.inFlight.startedAt, now)}; the bank
              debits it 1–1.5 days after its notice.
            </AlertDescription>
          </Alert>
        ) : null}

        {otherCurrency ? (
          <Alert>
            <WarningIcon />
            <AlertTitle>Your message rates are in {otherCurrency}</AlertTitle>
            <AlertDescription>
              The wallet is in {data.currency}, so messages are not being taken
              off it. The platform needs to set {data.currency} rates for this
              account.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {!data.isOwner ? (
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Only the account&apos;s own login can top up or change
            auto-recharge.
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Topping up by hand
// ---------------------------------------------------------------------------

function TopUpCard({ data }: { data: Summary }) {
  const { money, symbol } = useMoney(useWorkspace()._id);
  const workspace = useWorkspace();
  const startTopUp = useAction(api.razorpay.startTopUp);
  const confirmPayment = useAction(api.razorpay.confirmPayment);
  const quickPicks = QUICK_MULTIPLES.map(
    (times) => (data.minTopUpMicros / 1_000_000) * times
  );
  const [amount, setAmount] = useState(String(quickPicks[0]));
  const [busy, setBusy] = useState(false);

  const value = rupeesIn(amount);
  const micros = value === null ? 0 : toMicros(value);
  const tooSmall = micros < data.minTopUpMicros;
  const tooLarge = micros > MAX_TOPUP_MICROS;
  const amounts = withGst(micros, data.gstPercent);
  const payable = data.razorpayKeyId !== null;

  const topUp = async () => {
    if (value === null) return;
    setBusy(true);
    try {
      const options = await startTopUp({
        workspaceId: workspace._id,
        amount: value,
      });
      const response = await openCheckout(options);
      const result = await confirmPayment({
        workspaceId: workspace._id,
        razorpayOrderId: orderIdOf(options, response),
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
      toast.add(
        result.status === "captured"
          ? {
              title: `${money(amounts.subtotalMicros)} added to your wallet`,
              type: "success",
            }
          : {
              title: "Payment received",
              description:
                "The credit shows here as soon as Razorpay confirms it.",
              type: "success",
            }
      );
    } catch (error) {
      report("Could not top up", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Top up</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="topup-amount">Amount</Label>
          <InputGroup>
            <InputGroupAddon>{symbol}</InputGroupAddon>
            <InputGroupInput
              id="topup-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={amount}
              disabled={busy}
              aria-invalid={
                (value !== null && (tooSmall || tooLarge)) || undefined
              }
              onChange={(event) => setAmount(event.target.value)}
              className="tabular-nums"
            />
          </InputGroup>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickPicks.map((pick) => (
            <Button
              key={pick}
              variant={value === pick ? "secondary" : "outline"}
              size="sm"
              disabled={busy}
              onClick={() => setAmount(String(pick))}
            >
              {money(toMicros(pick))}
            </Button>
          ))}
        </div>
        {value !== null && tooSmall ? (
          <p className="text-xs text-destructive">
            The smallest top-up is {money(data.minTopUpMicros)}.
          </p>
        ) : tooLarge ? (
          <p className="text-xs text-destructive">
            A single top-up can be at most {money(MAX_TOPUP_MICROS)}.
          </p>
        ) : value !== null ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {amounts.gstMicros > 0 ? (
              <>
                {money(amounts.subtotalMicros)} + {money(amounts.gstMicros)} GST
                ={" "}
              </>
            ) : (
              "You pay "
            )}
            <span className="font-medium text-foreground">
              {money(amounts.totalMicros)}
            </span>
          </p>
        ) : null}
        {!payable ? (
          <p className="text-xs text-destructive">
            Payments aren&apos;t set up on the platform yet, so the wallet
            can&apos;t be topped up here.
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          disabled={busy || !payable || value === null || tooSmall || tooLarge}
          onClick={topUp}
        >
          {busy ? <Spinner /> : <WalletIcon />}
          {value !== null && !tooSmall && !tooLarge
            ? `Pay ${money(amounts.totalMicros)}`
            : "Pay"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Auto-recharge
// ---------------------------------------------------------------------------

const METHOD_LABEL: Record<string, string> = {
  upi: "UPI Autopay",
  card: "Card",
};

function mandateState(tokenStatus: string | null): {
  label: string;
  tone: string;
} {
  if (tokenStatus === "confirmed") {
    return {
      label: "Active",
      tone: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
    };
  }
  if (tokenStatus === "initiated") {
    return {
      label: "Awaiting confirmation from the bank",
      tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
    };
  }
  return {
    label: tokenStatus
      ? tokenStatus.charAt(0).toUpperCase() + tokenStatus.slice(1)
      : "Unknown",
    tone: "bg-destructive/10 text-destructive",
  };
}

/**
 * The low-balance line and the recharge amount, and the mandate behind
 * them. Keyed on the saved values by its parent.
 */
function AutoRechargeCard({ data }: { data: Summary }) {
  const { money, symbol } = useMoney(useWorkspace()._id);
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const updatePreferences = useMutation(api.wallet.updatePreferences);
  const removeMandate = useMutation(api.wallet.removeMandate);
  const startMandate = useAction(api.razorpay.startMandate);
  const confirmPayment = useAction(api.razorpay.confirmPayment);

  const { autoRecharge, hasMandate } = data;
  const saved = {
    threshold: rupeesOf(data.thresholdMicros),
    amount: rupeesOf(autoRecharge.amountMicros),
    enabled: autoRecharge.enabled && hasMandate,
  };
  const [threshold, setThreshold] = useState(saved.threshold);
  const [amount, setAmount] = useState(saved.amount);
  const [enabled, setEnabled] = useState(saved.enabled);
  const [busy, setBusy] = useState<"save" | "upi" | "card" | "remove" | null>(
    null
  );
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const canEdit = data.isOwner;
  const payable = data.razorpayKeyId !== null;

  const thresholdValue = rupeesIn(threshold);
  const thresholdValid = thresholdValue !== null && thresholdValue >= 0;
  const amountValue = rupeesIn(amount);
  const amountMicros = amountValue === null ? 0 : toMicros(amountValue);
  const amountValid =
    amountValue !== null &&
    amountMicros >= data.minTopUpMicros &&
    amountMicros <= MAX_TOPUP_MICROS;
  const debit = withGst(amountMicros, data.gstPercent);
  // A mandate is authorised for a ceiling; a recharge above it would be
  // refused by the bank, so it is refused here first.
  const overMandate =
    hasMandate &&
    enabled &&
    autoRecharge.maxAmountMicros !== null &&
    debit.totalMicros > autoRecharge.maxAmountMicros;
  const overCap = !hasMandate && debit.totalMicros > MANDATE_CAP_MICROS;

  // The bank debits a day to a day and a half after its notice, so the line
  // has to carry two days of messages or templates stop in the gap.
  const twoDays = roundToPaise((data.spent7dMicros / 7) * 2);
  const lineShort =
    thresholdValid && twoDays > 0 && toMicros(thresholdValue) < twoDays;

  const dirty =
    threshold !== saved.threshold ||
    amount !== saved.amount ||
    enabled !== saved.enabled;
  const inputsValid = thresholdValid && amountValid;

  const save = async () => {
    if (thresholdValue === null || amountValue === null) return;
    setBusy("save");
    try {
      await updatePreferences({
        workspaceId: workspace._id,
        threshold: thresholdValue,
        autoRechargeEnabled: hasMandate && enabled,
        rechargeAmount: amountValue,
      });
      toast.add({
        title: hasMandate
          ? enabled
            ? "Auto-recharge is on"
            : "Auto-recharge is off"
          : "Low-balance line saved",
        type: "success",
      });
    } catch (error) {
      report("Could not save", error);
    } finally {
      setBusy(null);
    }
  };

  const setUp = async (method: "upi" | "card") => {
    if (thresholdValue === null || amountValue === null) return;
    setBusy(method);
    try {
      const options = await startMandate({
        workspaceId: workspace._id,
        method,
        rechargeAmount: amountValue,
        threshold: thresholdValue,
      });
      const response = await openCheckout(options);
      await confirmPayment({
        workspaceId: workspace._id,
        razorpayOrderId: orderIdOf(options, response),
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
      toast.add({
        title: "Auto-recharge is set up",
        description:
          method === "upi"
            ? `The ${money(toMicros(1))} is in your wallet. Your bank confirms a UPI mandate in its own time, so it can show as awaiting confirmation for a while.`
            : `The ${money(toMicros(1))} is in your wallet. Recharges start the next time the balance drops below the line.`,
        type: "success",
      });
    } catch (error) {
      report("Could not set up auto-recharge", error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await removeMandate({ workspaceId: workspace._id });
      setConfirmingRemove(false);
      toast.add({
        title: "Auto-recharge removed",
        description:
          "The mandate is cancelled with your bank. Top up by hand from now on.",
        type: "success",
      });
    } catch (error) {
      report("Could not remove auto-recharge", error);
    } finally {
      setBusy(null);
    }
  };

  const state = mandateState(autoRecharge.tokenStatus);
  const standing = !hasMandate
    ? { label: "Off", tone: "bg-muted text-muted-foreground" }
    : autoRecharge.enabled
      ? {
          label: "On",
          tone: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
        }
      : {
          label: "Paused",
          tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
        };
  const method = autoRecharge.method
    ? (METHOD_LABEL[autoRecharge.method] ?? autoRecharge.method)
    : "Saved mandate";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LightningIcon className="size-4 text-muted-foreground" />
          Auto-recharge
          <Badge variant="secondary" className={standing.tone}>
            {standing.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recharge-threshold">Low-balance line</Label>
            <InputGroup>
              <InputGroupAddon>{symbol}</InputGroupAddon>
              <InputGroupInput
                id="recharge-threshold"
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={threshold}
                readOnly={!canEdit}
                disabled={busy !== null}
                aria-invalid={!thresholdValid || undefined}
                onChange={(event) => setThreshold(event.target.value)}
                className="tabular-nums"
              />
            </InputGroup>
            {lineShort ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                That is less than two days of last week&apos;s spend, so
                templates may be held back while a recharge is on its way.
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recharge-amount">Recharge amount</Label>
            <InputGroup>
              <InputGroupAddon>{symbol}</InputGroupAddon>
              <InputGroupInput
                id="recharge-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={amount}
                readOnly={!canEdit}
                disabled={busy !== null}
                aria-invalid={!amountValid || undefined}
                onChange={(event) => setAmount(event.target.value)}
                className="tabular-nums"
              />
            </InputGroup>
            {amountValue !== null && amountMicros < data.minTopUpMicros ? (
              <p className="text-xs text-destructive">
                The smallest recharge is {money(data.minTopUpMicros)}.
              </p>
            ) : amountMicros > MAX_TOPUP_MICROS ? (
              <p className="text-xs text-destructive">
                A recharge can be at most {money(MAX_TOPUP_MICROS)}.
              </p>
            ) : amountValid ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {debit.gstMicros > 0 ? (
                  <>
                    Each recharge credits {money(debit.subtotalMicros)} and
                    debits {money(debit.totalMicros)} with GST.
                  </>
                ) : (
                  <>
                    Each recharge credits and debits {money(debit.totalMicros)}.
                  </>
                )}
              </p>
            ) : null}
            {overCap ? (
              <p className="text-xs text-destructive">
                An automatic debit can be at most {money(MANDATE_CAP_MICROS)}
                {data.gstPercent > 0 ? " with GST" : ""} — above that the bank
                asks for your approval every time. Pick a smaller amount.
              </p>
            ) : null}
            {overMandate && autoRecharge.maxAmountMicros !== null ? (
              <p className="text-xs text-destructive">
                That is more than the saved mandate allows in one debit (
                {money(autoRecharge.maxAmountMicros)}). Remove it and set up
                auto-recharge again for the higher amount.
              </p>
            ) : null}
          </div>
        </div>

        {hasMandate ? (
          <div className="flex flex-col gap-4 rounded-lg border p-3">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Paid with" value={method} />
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Mandate
                </dt>
                <dd>
                  <Badge
                    variant="secondary"
                    className={cn("max-w-full", state.tone)}
                  >
                    <span className="truncate">{state.label}</span>
                  </Badge>
                </dd>
              </div>
              <Fact
                label="Most per debit"
                value={
                  autoRecharge.maxAmountMicros !== null
                    ? money(autoRecharge.maxAmountMicros)
                    : "—"
                }
              />
              <Fact
                label="Last recharge"
                value={
                  autoRecharge.lastChargedAt
                    ? formatDay(autoRecharge.lastChargedAt)
                    : "Not yet"
                }
              />
            </dl>

            {autoRecharge.lastError ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>
                  The last auto-recharge didn&apos;t go through
                </AlertTitle>
                <AlertDescription>{autoRecharge.lastError}</AlertDescription>
              </Alert>
            ) : null}

            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canEdit || busy !== null}
              />
              {enabled ? "Recharge automatically" : "Paused — top up by hand"}
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {!data.profileReady ? (
              <Alert>
                <WarningIcon />
                <AlertTitle>
                  Add a billing email and phone number first
                </AlertTitle>
                <AlertDescription>
                  Razorpay needs both to set up autopay. Save them under{" "}
                  <Link href={`${base}/billing?tab=plan`}>
                    Billing details on the Plan tab
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            ) : null}
            {!payable ? (
              <p className="text-xs text-destructive">
                Payments aren&apos;t set up on the platform yet, so
                auto-recharge can&apos;t be authorised here.
              </p>
            ) : null}
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                {(data.currency === "INR"
                  ? (["upi", "card"] as const)
                  : (["card"] as const)
                ).map((option, index) => (
                  <Button
                    key={option}
                    variant={index === 0 ? "default" : "outline"}
                    disabled={
                      busy !== null ||
                      !payable ||
                      !data.profileReady ||
                      !inputsValid ||
                      overCap
                    }
                    onClick={() => setUp(option)}
                  >
                    {busy === option ? (
                      <Spinner />
                    ) : option === "upi" ? (
                      <QrCodeIcon />
                    ) : (
                      <CreditCardIcon />
                    )}
                    {option === "upi"
                      ? "Set up with UPI Autopay"
                      : "Set up with card"}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>

      {canEdit ? (
        <CardFooter className="flex flex-wrap justify-end gap-2">
          {hasMandate ? (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirmingRemove(true)}
            >
              <TrashIcon /> Remove
            </Button>
          ) : null}
          <Button
            variant={hasMandate ? "default" : "outline"}
            disabled={busy !== null || !dirty || !inputsValid || overMandate}
            onClick={save}
          >
            {busy === "save" ? <Spinner /> : <FloppyDiskIcon />}
            {hasMandate ? "Save" : "Save the line"}
          </Button>
        </CardFooter>
      ) : null}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove auto-recharge?</AlertDialogTitle>
            <AlertDialogDescription>
              The mandate is cancelled with your bank, so nothing more is
              debited from it. To switch auto-recharge on again later, you
              authorise a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "remove"}>
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy === "remove"}
              onClick={remove}
            >
              {busy === "remove" ? <Spinner /> : null} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money in
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<Doc<"walletTransactions">["kind"], string> = {
  topup: "Top-up",
  auto_recharge: "Auto-recharge",
  adjustment: "Adjustment",
  bonus: "Welcome bonus",
};

function WalletHistory() {
  const { money } = useMoney(useWorkspace()._id);
  const workspace = useWorkspace();
  const { results, status, loadMore } = usePaginatedQuery(
    api.wallet.transactions,
    { workspaceId: workspace._id },
    { initialNumItems: PAGE }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet history</CardTitle>
      </CardHeader>
      <CardContent>
        {status === "LoadingFirstPage" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Loading the wallet history…
          </div>
        ) : results.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WalletIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing has gone into the wallet yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="hidden md:table-cell">Note</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      Balance after
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatDay(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {KIND_LABEL[row.kind]}
                      </TableCell>
                      <TableCell className="hidden max-w-80 md:table-cell">
                        <span
                          className="line-clamp-1 text-sm text-muted-foreground"
                          title={row.note}
                        >
                          {row.note ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium whitespace-nowrap tabular-nums",
                          row.amountMicros >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-destructive"
                        )}
                      >
                        {row.amountMicros >= 0 ? "+" : "−"}
                        {money(Math.abs(row.amountMicros))}
                      </TableCell>
                      <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">
                        {money(row.balanceAfterMicros)}
                      </TableCell>
                    </TableRow>
                  ))}
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
