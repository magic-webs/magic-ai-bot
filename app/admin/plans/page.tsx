"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toMicros } from "@/convex/lib/billing";
import { DEFAULT_PLANS, DEFAULT_SETTINGS, withGst } from "@/convex/lib/plans";
import { SelectField } from "@/components/select-field";
import {
  IncludedAgents,
  PlanFeatures,
  StrikePrice,
  currencySymbol,
  formatDay,
  moneyIn,
  rupeesOf,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Dialog,
  DialogBody,
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
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  CaretLeftIcon,
  CaretRightIcon,
  EyeSlashIcon,
  PencilSimpleIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
} from "@phosphor-icons/react";

type Catalogue = FunctionReturnType<typeof api.plans.adminCatalogue>;
type PlanRow = Catalogue["plans"][number];
type Settings = Doc<"billingSettings">;

function fail(title: string, error: unknown) {
  toast.add({
    title,
    description: error instanceof Error ? error.message : String(error),
    type: "error",
  });
}

/** A typed number, or NaN for an empty box — `Number("")` is 0, not blank. */
const num = (text: string) => (text.trim() === "" ? NaN : Number(text));

/** "3 accounts", "1 account". */
const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

function NumberInput({
  id,
  value,
  onChange,
  prefix,
  suffix,
  whole = false,
  invalid = false,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  whole?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <Input
        id={id}
        type="number"
        inputMode={whole ? "numeric" : "decimal"}
        min={0}
        step={whole ? 1 : "any"}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn("tabular-nums", prefix && "pl-6", suffix && "pr-12")}
        onChange={(event) => onChange(event.target.value)}
      />
      {suffix ? (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
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

// ---------------------------------------------------------------------------
// Billing off
// ---------------------------------------------------------------------------

function EnableBilling() {
  const enable = useMutation(api.plans.enable);
  const [busy, setBusy] = useState(false);
  const names = DEFAULT_PLANS.map((plan) => plan.name);
  const listed = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

  const run = async () => {
    setBusy(true);
    try {
      await enable({});
      toast.add({
        title: "Billing is on",
        description: `Every workspace's free trial is counted from today.`,
        type: "success",
      });
    } catch (error) {
      fail("Could not switch billing on", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PowerIcon />
        </EmptyMedia>
        <EmptyTitle>Billing is off</EmptyTitle>
        <EmptyDescription>
          No company is charged a platform fee and no dashboard locks. Switching
          it on creates three starting plans — {listed} — and starts every
          existing workspace&apos;s free trial from today,{" "}
          {DEFAULT_SETTINGS.trialDays} days by default. Nothing locks until a
          trial runs out, and every figure can be edited once it is on.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={busy} onClick={() => void run()}>
          {busy ? <Spinner /> : <PowerIcon />} Switch billing on
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Terms — GST, the trial, grace, extra agents and the wallet
// ---------------------------------------------------------------------------

type General = {
  trialDays: string;
  graceDays: string;
  trialPlanId: string;
};

type CurrencyDraft = {
  gstPercent: string;
  extraAgentList: string;
  extraAgentPrice: string;
  minTopUp: string;
  defaultThreshold: string;
  welcomeBonus: string;
};

type TermsRow = Catalogue["terms"][number];

function generalOf(settings: Settings): General {
  return {
    trialDays: String(settings.trialDays),
    graceDays: String(settings.graceDays),
    trialPlanId: settings.trialPlanId ?? "",
  };
}

function currencyDrafts(
  settings: Settings,
  terms: TermsRow[]
): Record<string, CurrencyDraft> {
  const bonus = settings.welcomeBonus ?? DEFAULT_SETTINGS.welcomeBonus;
  const drafts: Record<string, CurrencyDraft> = {};
  for (const row of terms) {
    drafts[row.currency] = {
      gstPercent: String(row.gstPercent),
      extraAgentList: rupeesOf(row.extraAgentListMicros),
      extraAgentPrice: rupeesOf(row.extraAgentPriceMicros),
      minTopUp: rupeesOf(row.minTopUpMicros),
      defaultThreshold: rupeesOf(row.defaultThresholdMicros),
      welcomeBonus: rupeesOf(
        bonus.find((entry) => entry.currency === row.currency)?.amountMicros ??
          0
      ),
    };
  }
  return drafts;
}

const same = <T extends Record<string, string>>(a: T, b: T) =>
  Object.keys(a).every((key) => a[key] === b[key]);

/**
 * The form starts from the saved settings and is remounted — keyed on
 * `updatedAt` by its caller — whenever they change, rather than copying them
 * into state from an effect: the save itself is one such change, and it
 * brings back what the server kept (a list price below the price is raised
 * to it), not what was typed. Every currency's terms are in the one draft;
 * the tab only picks which are on screen.
 */
function TermsForm({
  settings,
  terms,
  plans,
  currency,
}: {
  settings: Settings;
  terms: TermsRow[];
  plans: PlanRow[];
  /** The currency tab open on the page. */
  currency: string;
}) {
  const money = moneyIn(currency);
  const symbol = currencySymbol(currency);
  const updateSettings = useMutation(api.plans.updateSettings);
  const savedGeneral = generalOf(settings);
  const savedCurrencies = currencyDrafts(settings, terms);
  const [general, setGeneral] = useState<General>(savedGeneral);
  const [drafts, setDrafts] = useState(savedCurrencies);
  const [defaultCurrency, setDefaultCurrency] = useState(settings.currency);
  const [busy, setBusy] = useState(false);
  const draft = drafts[currency];

  const setG = (key: keyof General) => (value: string) =>
    setGeneral((prev) => ({ ...prev, [key]: value }));
  const set = (key: keyof CurrencyDraft) => (value: string) =>
    setDrafts((prev) => ({
      ...prev,
      [currency]: { ...prev[currency], [key]: value },
    }));

  const badNumber = (text: string, whole = false) => {
    const value = num(text);
    return !(value >= 0) || (whole && !Number.isInteger(value));
  };
  const badG = (key: keyof General) =>
    key !== "trialPlanId" && badNumber(general[key], true);
  const bad = (key: keyof CurrencyDraft) => badNumber(draft[key]);
  const invalid =
    (["trialDays", "graceDays"] as const).some(badG) ||
    Object.values(drafts).some((row) =>
      Object.values(row).some((text) => badNumber(text))
    );
  const dirty =
    !same(general, savedGeneral) ||
    defaultCurrency !== settings.currency ||
    Object.keys(drafts).some(
      (code) => !same(drafts[code], savedCurrencies[code])
    );

  const gst = num(draft.gstPercent);
  const priceMicros = toMicros(num(draft.extraAgentPrice) || 0);
  const listMicros = toMicros(num(draft.extraAgentList) || 0);

  const save = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      await updateSettings({
        trialDays: num(general.trialDays),
        graceDays: num(general.graceDays),
        trialPlanId: general.trialPlanId
          ? (general.trialPlanId as Id<"billingPlans">)
          : undefined,
        currency: defaultCurrency,
        terms: Object.entries(drafts).map(([code, row]) => ({
          currency: code,
          gstPercent: num(row.gstPercent),
          extraAgentList: num(row.extraAgentList),
          extraAgentPrice: num(row.extraAgentPrice),
          minTopUp: num(row.minTopUp),
          defaultThreshold: num(row.defaultThreshold),
          welcomeBonus: num(row.welcomeBonus),
        })),
      });
      toast.add({
        title: "Terms saved",
        description:
          "New checkouts are priced on them. A subscription Razorpay is already charging keeps its amount.",
        type: "success",
      });
    } catch (error) {
      fail("Could not save the terms", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id="terms-trial"
            label="Free trial"
            hint="From when billing went on, or a workspace's creation if later."
          >
            <NumberInput
              id="terms-trial"
              suffix="days"
              whole
              value={general.trialDays}
              invalid={badG("trialDays")}
              onChange={setG("trialDays")}
            />
          </Field>
          <Field
            id="terms-grace"
            label="Grace period"
            hint="After a failed renewal, before the dashboard locks."
          >
            <NumberInput
              id="terms-grace"
              suffix="days"
              whole
              value={general.graceDays}
              invalid={badG("graceDays")}
              onChange={setG("graceDays")}
            />
          </Field>
          <Field
            id="terms-default-currency"
            label="Default currency"
            hint="For a new account that is neither Indian nor has a currency with terms. Indian businesses start in INR, others in USD."
          >
            <SelectField
              id="terms-default-currency"
              className="w-full"
              value={defaultCurrency}
              onValueChange={setDefaultCurrency}
              options={Object.keys(drafts).map((code) => ({
                value: code,
                label: code,
              }))}
            />
          </Field>
        </div>

        <Field
          id="terms-trial-plan"
          label="Trial plan"
          hint={
            <>
              Whose limits a workspace on its free trial is held to. A trial
              length changed here reaches workspaces that have not set up
              billing yet; one already fixed on an account keeps its date —
              extend it from Subscriptions.
            </>
          }
        >
          <SelectField
            id="terms-trial-plan"
            className="w-full sm:w-72"
            value={general.trialPlanId}
            placeholder="The first plan on sale"
            onValueChange={setG("trialPlanId")}
            options={plans.map((plan) => ({
              value: plan._id,
              label: `${plan.name} · ${plan.currency}${plan.status === "hidden" ? " (hidden)" : ""}`,
            }))}
          />
        </Field>

        <div className="flex flex-col gap-3 border-t pt-5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {currency} accounts
          </span>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="terms-gst"
              label="GST"
              hint="Added on top of every plan, extra agent and top-up."
            >
              <NumberInput
                id="terms-gst"
                suffix="%"
                value={draft.gstPercent}
                invalid={bad("gstPercent")}
                onChange={set("gstPercent")}
              />
            </Field>
            <Field id="terms-extra-list" label="Extra agent · list price">
              <NumberInput
                id="terms-extra-list"
                prefix={symbol}
                value={draft.extraAgentList}
                invalid={bad("extraAgentList")}
                onChange={set("extraAgentList")}
              />
            </Field>
            <Field id="terms-extra-price" label="Extra agent · price">
              <NumberInput
                id="terms-extra-price"
                prefix={symbol}
                value={draft.extraAgentPrice}
                invalid={bad("extraAgentPrice")}
                onChange={set("extraAgentPrice")}
              />
            </Field>
          </div>
          {/* The figure a company will see on its plan picker, because two
              bare boxes do not say which one is struck through. */}
          {!bad("extraAgentPrice") && !bad("extraAgentList") ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {listMicros > priceMicros ? (
                <>
                  <span className="line-through">{money(listMicros)}</span>{" "}
                  →{" "}
                </>
              ) : null}
              <span className="font-medium text-foreground">
                {money(priceMicros)}
              </span>{" "}
              a month per extra agent
              {gst > 0
                ? `, ${money(withGst(priceMicros, gst).totalMicros)} with GST`
                : ""}
              . One pool: each can be an AI agent or a human one.
              {listMicros > 0 && listMicros < priceMicros
                ? " A list price below the price is saved as the price."
                : ""}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="terms-min-topup"
              label="Minimum wallet top-up"
              hint="The smallest wallet payment a company can make. At least 1."
            >
              <NumberInput
                id="terms-min-topup"
                prefix={symbol}
                value={draft.minTopUp}
                invalid={bad("minTopUp")}
                onChange={set("minTopUp")}
              />
            </Field>
            <Field
              id="terms-threshold"
              label="Default low-balance line"
              hint="Below it the dashboard warns and auto-recharge fires. Each company can set its own."
            >
              <NumberInput
                id="terms-threshold"
                prefix={symbol}
                value={draft.defaultThreshold}
                invalid={bad("defaultThreshold")}
                onChange={set("defaultThreshold")}
              />
            </Field>
            <Field
              id="terms-bonus"
              label="Welcome bonus"
              hint="Credited to a new workspace's wallet. Zero for none."
            >
              <NumberInput
                id="terms-bonus"
                prefix={symbol}
                value={draft.welcomeBonus}
                invalid={bad("welcomeBonus")}
                onChange={set("welcomeBonus")}
              />
            </Field>
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {invalid
            ? "Every box needs a number — zero if it is free."
            : dirty
              ? "Unsaved changes."
              : `Saved ${formatDay(settings.updatedAt)}.`}
        </span>
        <Button
          disabled={busy || invalid || !dirty}
          onClick={() => void save()}
        >
          {busy ? <Spinner /> : null} Save terms
        </Button>
      </CardFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// One plan, edited or created
// ---------------------------------------------------------------------------

type PlanDraft = {
  name: string;
  description: string;
  price: string;
  listPrice: string;
  includedAiAgents: string;
  includedHumanAgents: string;
  features: string;
  highlighted: boolean;
  offered: boolean;
};

function planDraft(plan: PlanRow | null): PlanDraft {
  if (!plan) {
    return {
      name: "",
      description: "",
      price: "",
      listPrice: "",
      includedAiAgents: "1",
      includedHumanAgents: "1",
      features: "",
      highlighted: false,
      offered: true,
    };
  }
  return {
    name: plan.name,
    description: plan.description ?? "",
    price: rupeesOf(plan.priceMicros),
    // Blank when it is the price itself: the box then reads as "nothing
    // struck through", which is what the plan card shows.
    listPrice:
      plan.listPriceMicros > plan.priceMicros
        ? rupeesOf(plan.listPriceMicros)
        : "",
    includedAiAgents: String(plan.includedAiAgents),
    includedHumanAgents: String(plan.includedHumanAgents),
    features: plan.features.join("\n"),
    highlighted: plan.highlighted,
    offered: plan.status === "active",
  };
}

/**
 * The dialog's contents. Mounted afresh each time it opens — the caller keys
 * it on a counter — so a cancelled edit is not waiting there next time.
 */
function PlanForm({
  plan,
  plans,
  currency,
  gstPercent,
  onDone,
}: {
  plan: PlanRow | null;
  plans: PlanRow[];
  currency: string;
  gstPercent: number;
  onDone: () => void;
}) {
  const money = moneyIn(currency);
  const symbol = currencySymbol(currency);
  const savePlan = useMutation(api.plans.savePlan);
  const [draft, setDraft] = useState<PlanDraft>(() => planDraft(plan));
  const [busy, setBusy] = useState(false);
  // Problems are shown once a save has been tried, so a new plan does not
  // open with every empty box already red.
  const [tried, setTried] = useState(false);

  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const price = num(draft.price);
  const list = draft.listPrice.trim() === "" ? price : num(draft.listPrice);
  const ai = num(draft.includedAiAgents);
  const human = num(draft.includedHumanAgents);
  const problems = {
    name: draft.name.trim() === "",
    price: !(price >= 0),
    list: !(list >= 0),
    ai: !Number.isInteger(ai) || ai < 0,
    human: !Number.isInteger(human) || human < 0,
  };
  const invalid = Object.values(problems).some(Boolean);
  const features = draft.features
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const otherHighlighted = plans.find(
    (other) => other.highlighted && other._id !== plan?._id
  );

  const save = async () => {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    try {
      await savePlan({
        planId: plan?._id,
        currency,
        name: draft.name,
        description: draft.description,
        listPrice: list,
        price,
        includedAiAgents: ai,
        includedHumanAgents: human,
        features,
        highlighted: draft.highlighted,
        status: draft.offered ? "active" : "hidden",
      });
      toast.add({
        title: plan
          ? `${draft.name.trim()} saved`
          : `${draft.name.trim()} added`,
        type: "success",
      });
      onDone();
    } catch (error) {
      fail("Could not save the plan", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{plan ? `Edit ${plan.name}` : "New plan"}</DialogTitle>
        <DialogDescription>
          Monthly, before GST. The three desks come with every plan and are not
          counted against its agents.
        </DialogDescription>
      </DialogHeader>

      <DialogBody>
        <Field id="plan-name" label="Name">
          <Input
            id="plan-name"
            value={draft.name}
            placeholder="Growth"
            aria-invalid={(tried && problems.name) || undefined}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>

        <Field id="plan-description" label="Description">
          <Textarea
            id="plan-description"
            rows={2}
            value={draft.description}
            placeholder="For a team with several desks and people on the inbox."
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="plan-price" label="Price">
            <NumberInput
              id="plan-price"
              prefix={symbol}
              value={draft.price}
              placeholder="9999"
              invalid={tried && problems.price}
              onChange={(value) => set("price", value)}
            />
          </Field>
          <Field
            id="plan-list"
            label="List price"
            hint="Shown struck through. Blank for none."
          >
            <NumberInput
              id="plan-list"
              prefix={symbol}
              value={draft.listPrice}
              placeholder={draft.price || "Same as the price"}
              invalid={tried && problems.list}
              onChange={(value) => set("listPrice", value)}
            />
          </Field>
        </div>
        {!problems.price && !problems.list ? (
          <p className="-mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <StrikePrice
              priceMicros={toMicros(price)}
              listMicros={toMicros(list)}
              className="font-medium text-foreground"
            />{" "}
            a month, {money(withGst(toMicros(price), gstPercent).totalMicros)}{" "}
            with {gstPercent}% GST.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="plan-ai"
            label="Custom agents included"
            hint="Live specialists, beyond the three desks."
          >
            <NumberInput
              id="plan-ai"
              whole
              value={draft.includedAiAgents}
              invalid={tried && problems.ai}
              onChange={(value) => set("includedAiAgents", value)}
            />
          </Field>
          <Field
            id="plan-human"
            label="Human agents included"
            hint="People with a login of their own."
          >
            <NumberInput
              id="plan-human"
              whole
              value={draft.includedHumanAgents}
              invalid={tried && problems.human}
              onChange={(value) => set("includedHumanAgents", value)}
            />
          </Field>
        </div>

        <Field
          id="plan-features"
          label="Features"
          hint={`One per line, as the plan card lists them — up to 20.${
            features.length > 20
              ? ` ${features.length - 20} past that are dropped.`
              : ""
          }`}
        >
          <Textarea
            id="plan-features"
            rows={5}
            value={draft.features}
            placeholder={
              "Front desk that answers first and routes every chat\n5 custom agents\n3 human agents with full access"
            }
            onChange={(event) => set("features", event.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex flex-col">
              <Label htmlFor="plan-highlighted" className="font-normal">
                Mark it most popular
              </Label>
              <span className="text-xs text-muted-foreground">
                One plan carries it at most
                {otherHighlighted && draft.highlighted
                  ? ` — this takes it off ${otherHighlighted.name}.`
                  : "."}
              </span>
            </div>
            <Switch
              id="plan-highlighted"
              checked={draft.highlighted}
              onCheckedChange={(checked) => set("highlighted", checked)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex flex-col">
              <Label htmlFor="plan-offered" className="font-normal">
                Offer it to new accounts
              </Label>
              <span className="text-xs text-muted-foreground">
                Off hides it from the pricing page. Accounts already on it keep
                it, at the price they signed up at.
              </span>
            </div>
            <Switch
              id="plan-offered"
              checked={draft.offered}
              onCheckedChange={(checked) => set("offered", checked)}
            />
          </div>
        </div>

        {plan ? (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            A new price reaches a company already paying only when it next
            checks out — Razorpay keeps charging what its subscription was
            created at. Included agents apply to every account on the plan
            straight away, so lowering them can leave accounts over their limit.
          </p>
        ) : null}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? <Spinner /> : null} {plan ? "Save plan" : "Add plan"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// The plan cards
// ---------------------------------------------------------------------------

function PlanCard({
  plan,
  seat,
  first,
  last,
  isTrialPlan,
  moving,
  onEdit,
  onMove,
}: {
  plan: PlanRow;
  seat: {
    priceMicros: number;
    listMicros: number;
    currency?: string;
    taxed?: boolean;
  };
  first: boolean;
  last: boolean;
  isTrialPlan: boolean;
  moving: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const removePlan = useMutation(api.plans.removePlan);

  const remove = async () => {
    try {
      await removePlan({ planId: plan._id });
      toast.add({ title: `${plan.name} deleted`, type: "success" });
    } catch (error) {
      fail(`Could not delete ${plan.name}`, error);
    }
  };

  return (
    <Card
      className={cn(
        plan.highlighted && "ring-2 ring-primary/40",
        plan.status === "hidden" && "opacity-75"
      )}
    >
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <CardTitle>{plan.name}</CardTitle>
          {plan.highlighted ? <Badge>Most popular</Badge> : null}
          {plan.status === "hidden" ? (
            <Badge variant="secondary">
              <EyeSlashIcon /> Hidden
            </Badge>
          ) : null}
          {isTrialPlan ? <Badge variant="outline">Trial plan</Badge> : null}
        </div>
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <StrikePrice
            priceMicros={plan.priceMicros}
            listMicros={plan.listPriceMicros}
            currency={plan.currency}
            className="font-heading text-2xl font-semibold tabular-nums"
          />
          <span className="text-xs text-muted-foreground">/ month + GST</span>
        </p>
        {plan.description ? (
          <CardDescription>{plan.description}</CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <IncludedAgents plan={plan} seat={seat} />
        {plan.features.length > 0 ? (
          <PlanFeatures features={plan.features} />
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No features listed.
          </p>
        )}
      </CardContent>

      <CardFooter className="justify-between gap-2">
        {/* Accounts pinned to it. Workspaces still on the trial they started
            with run on the trial plan without being counted here. */}
        <span className="text-xs text-muted-foreground">
          {count(plan.accounts, "account")}
          {isTrialPlan ? " · and every trial" : ""}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Move earlier"
            aria-label={`Move ${plan.name} earlier`}
            disabled={first || moving}
            onClick={() => onMove(-1)}
          >
            <CaretLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Move later"
            aria-label={`Move ${plan.name} later`}
            disabled={last || moving}
            onClick={() => onMove(1)}
          >
            <CaretRightIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Edit"
            aria-label={`Edit ${plan.name}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Delete"
                  aria-label={`Delete ${plan.name}`}
                >
                  <TrashIcon />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {plan.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It disappears from the pricing page for good. A plan accounts
                  are on, or the one trials run on, cannot be deleted — hide it
                  instead, so nobody new can choose it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  render={<Button variant="ghost">Cancel</Button>}
                />
                <AlertDialogAction
                  render={
                    <Button variant="destructive" onClick={() => void remove()}>
                      Delete plan
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardFooter>
    </Card>
  );
}

/**
 * What the platform sells: the plans, the terms they are sold on, and whether
 * Razorpay is wired up to collect.
 */
export default function AdminPlansPage() {
  const data = useQuery(api.plans.adminCatalogue, {});
  const movePlan = useMutation(api.plans.movePlan);

  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open, and the form is keyed on it, so it always starts
  // from the plan as it is now rather than from the last draft.
  const [session, setSession] = useState(0);
  const [moving, setMoving] = useState<Id<"billingPlans"> | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  const openPlan = (plan: PlanRow | null) => {
    setEditing(plan);
    setSession((n) => n + 1);
    setDialogOpen(true);
  };

  const move = async (plan: PlanRow, direction: -1 | 1) => {
    setMoving(plan._id);
    try {
      await movePlan({ planId: plan._id, direction });
    } catch (error) {
      fail(`Could not move ${plan.name}`, error);
    } finally {
      setMoving(null);
    }
  };

  const settings = data?.settings ?? null;
  const allPlans = data?.plans ?? [];
  const terms = data?.terms ?? [];
  const currency = tab ?? settings?.currency ?? "INR";
  const termsHere = terms.find((row) => row.currency === currency) ?? terms[0];
  const plans = allPlans.filter((plan) => plan.currency === currency);
  // The plan a trial runs on, worked out the way convex/lib/account.ts does
  // when the settings name none.
  const trialPlanId =
    settings?.trialPlanId ??
    allPlans.find((plan) => plan.status === "active")?._id ??
    allPlans[0]?._id;
  const hidden = plans.filter((plan) => plan.status === "hidden").length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Plans &amp; pricing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The monthly fee each company pays to use the platform — its plans,
            the price of an extra agent, GST and the free trial.
          </p>
        </div>
      </header>

      {data === undefined ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner /> Loading plans…
        </div>
      ) : settings === null ? (
        <EnableBilling />
      ) : (
        <>
          {terms.length > 1 ? (
            <Tabs
              value={currency}
              onValueChange={(value) => setTab(String(value))}
            >
              <TabsList>
                {terms.map((row) => (
                  <TabsTrigger key={row.currency} value={row.currency}>
                    {row.currency} plans
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Terms</CardTitle>
              <CardDescription>
                What every plan is sold on. Billing was switched on{" "}
                {formatDay(settings.launchedAt)}.
              </CardDescription>
            </CardHeader>
            <TermsForm
              key={settings.updatedAt}
              settings={settings}
              terms={terms}
              plans={allPlans}
              currency={currency}
            />
          </Card>

          <section className="flex shrink-0 flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg font-semibold tracking-tight">
                  {currency} plans
                </h2>
                <p className="text-sm text-muted-foreground">
                  In the order the pricing page shows them
                  {hidden > 0 ? ` · ${hidden} hidden from new accounts` : ""}.
                </p>
              </div>
              <Button onClick={() => openPlan(null)}>
                <PlusIcon /> New plan
              </Button>
            </div>

            {plans.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No plans. Nobody can check out, and trials have no limits to be
                held to, until there is one.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan, index) => (
                  <PlanCard
                    key={plan._id}
                    plan={plan}
                    seat={{
                      priceMicros: termsHere?.extraAgentPriceMicros ?? 0,
                      listMicros: termsHere?.extraAgentListMicros ?? 0,
                      currency,
                      taxed: (termsHere?.gstPercent ?? 0) > 0,
                    }}
                    first={index === 0}
                    last={index === plans.length - 1}
                    isTrialPlan={plan._id === trialPlanId}
                    moving={moving !== null}
                    onEdit={() => openPlan(plan)}
                    onMove={(direction) => void move(plan, direction)}
                  />
                ))}
              </div>
            )}
          </section>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-lg">
              <PlanForm
                key={session}
                plan={editing}
                plans={plans}
                currency={editing?.currency ?? currency}
                gstPercent={termsHere?.gstPercent ?? 0}
                onDone={() => setDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
