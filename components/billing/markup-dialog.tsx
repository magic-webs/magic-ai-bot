"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  MARKUP_BASE_CURRENCY,
  MESSAGE_CATEGORIES,
  formatMoney,
  fromMicros,
  metaCostOf,
  toMicros,
  type MessageCategory,
} from "@/convex/lib/billing";
import { CategoryDot } from "@/components/billing/category";
import type { MarkupView, MetaRateRow } from "@/components/billing/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

type Draft = {
  percent: Record<MessageCategory, string>;
  /** Per currency: each category's fixed amount. */
  fixed: Record<string, Record<MessageCategory, string>>;
  chargeFree: boolean;
};

// Plain decimals, not formatMoney: this is what goes back in the box.
const show = (micros: number | undefined) =>
  micros === undefined ? "0" : String(fromMicros(micros));

function draftOf(card: MarkupView | null, currencies: string[]): Draft {
  const percent = {} as Draft["percent"];
  for (const category of MESSAGE_CATEGORIES) {
    percent[category] = String(card?.[category].percent ?? 0);
  }
  const fixed: Draft["fixed"] = {};
  for (const currency of currencies) {
    const other = card?.byCurrency.find((entry) => entry.currency === currency);
    const base = currency === MARKUP_BASE_CURRENCY;
    fixed[currency] = {
      service: show(base ? card?.service.fixedMicros : other?.service),
      utility: show(base ? card?.utility.fixedMicros : other?.utility),
      marketing: show(base ? card?.marketing.fixedMicros : other?.marketing),
      authentication: show(
        base ? card?.authentication.fixedMicros : other?.authentication
      ),
    };
  }
  return { percent, fixed, chargeFree: card?.chargeFree ?? false };
}

const valid = (value: string) => value.trim() !== "" && Number(value) >= 0;

/**
 * Edit the platform's markup on Meta's rates, per category: a percentage of
 * Meta's rate, and a fixed amount in each currency an account can be billed
 * in — plus what a message Meta did not charge for costs. With a workspace,
 * that account's own markup; without one, the default.
 */
export function MarkupDialog({
  workspaceId,
  workspaceName,
  current,
  fallback,
  currencies,
  currency: shown,
  sample,
  trigger,
}: {
  workspaceId?: Id<"workspaces">;
  workspaceName?: string;
  current: MarkupView | null;
  fallback?: MarkupView | null;
  /** The currencies accounts are billed in; INR first. */
  currencies: string[];
  /** The one currency whose fixed amounts to show; the others keep theirs. */
  currency?: string;
  /** One market's Meta rates, to show what a message ends up costing. */
  sample?: MetaRateRow;
  trigger: React.ReactElement;
}) {
  const setMarkups = useMutation(api.billing.setMarkups);
  const clearMarkups = useMutation(api.billing.clearMarkups);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const known = [
    ...new Set([
      MARKUP_BASE_CURRENCY,
      ...currencies,
      ...(shown ? [shown] : []),
      ...((current ?? fallback)?.byCurrency.map((entry) => entry.currency) ??
        []),
    ]),
  ];
  const columns = shown ? [shown] : known;
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(current ?? fallback ?? null, known)
  );

  const custom = Boolean(workspaceId && current);
  const setPercent = (category: MessageCategory, value: string) =>
    setDraft((prev) => ({
      ...prev,
      percent: { ...prev.percent, [category]: value },
    }));
  const setFixed = (currency: string, key: MessageCategory, value: string) =>
    setDraft((prev) => ({
      ...prev,
      fixed: {
        ...prev.fixed,
        [currency]: { ...prev.fixed[currency], [key]: value },
      },
    }));

  const invalid =
    MESSAGE_CATEGORIES.some((category) => !valid(draft.percent[category])) ||
    columns.some((currency) =>
      MESSAGE_CATEGORIES.some((key) => !valid(draft.fixed[currency][key]))
    );

  const save = async () => {
    if (invalid) return;
    setBusy("save");
    const base = draft.fixed[MARKUP_BASE_CURRENCY];
    const entry = (category: MessageCategory) => ({
      fixed: Number(base[category]),
      percent: Number(draft.percent[category]),
    });
    try {
      await setMarkups({
        workspaceId,
        service: entry("service"),
        utility: entry("utility"),
        marketing: entry("marketing"),
        authentication: entry("authentication"),
        chargeFree: draft.chargeFree,
        byCurrency: known
          .filter((currency) => currency !== MARKUP_BASE_CURRENCY)
          .map((currency) => ({
            currency,
            service: Number(draft.fixed[currency].service),
            utility: Number(draft.fixed[currency].utility),
            marketing: Number(draft.fixed[currency].marketing),
            authentication: Number(draft.fixed[currency].authentication),
          })),
      });
      toast.add({
        title: workspaceName
          ? `Markup saved for ${workspaceName}`
          : "Default markup saved",
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not save the markup",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const resetToDefault = async () => {
    if (!workspaceId) return;
    setBusy("clear");
    try {
      await clearMarkups({ workspaceId });
      toast.add({
        title: `${workspaceName ?? "This account"} is back on the default markup`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not reset the markup",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const grid = {
    gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, 7rem) 5.5rem`,
  };
  const box = (currency: string, key: MessageCategory, label: string) => (
    <div className="relative" key={currency}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={draft.fixed[currency][key]}
        aria-label={label}
        aria-invalid={!valid(draft.fixed[currency][key]) || undefined}
        className="pr-11 text-right tabular-nums"
        onChange={(event) => setFixed(currency, key, event.target.value)}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
        {currency}
      </span>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(draftOf(current ?? fallback ?? null, known));
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {workspaceName ? `Markup for ${workspaceName}` : "Default markup"}
            {shown ? ` · ${shown}` : ""}
          </DialogTitle>
          <DialogDescription>
            Added on top of Meta&apos;s rate for each message: a percentage of
            Meta&apos;s rate, plus a fixed amount in the currency the account is
            billed in. Applies to messages sent from now on.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex min-w-xl flex-col gap-3">
            <div
              className="grid items-end gap-x-3 text-xs text-muted-foreground"
              style={grid}
            >
              <span />
              {columns.map((currency) => (
                <span key={currency} className="text-right">
                  Fixed · {currency}
                </span>
              ))}
              <span className="text-right">% of Meta</span>
            </div>

            {MESSAGE_CATEGORIES.map((category) => {
              const percent = draft.percent[category];
              const fixed =
                draft.fixed[sample?.currency ?? MARKUP_BASE_CURRENCY]?.[
                  category
                ];
              const cost = sample ? metaCostOf(sample, category) : null;
              const price =
                cost !== null &&
                fixed !== undefined &&
                valid(fixed) &&
                valid(percent)
                  ? cost +
                    toMicros(Number(fixed)) +
                    Math.round((cost * Number(percent)) / 100)
                  : null;
              const money = (micros: number) =>
                formatMoney(micros, sample?.currency ?? MARKUP_BASE_CURRENCY);
              return (
                <div
                  key={category}
                  className="grid items-center gap-x-3"
                  style={grid}
                >
                  <div className="min-w-0">
                    <Label className="flex items-center gap-2">
                      <CategoryDot category={category} />
                      {CATEGORY_LABELS[category]}
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {cost !== null && price !== null && sample
                        ? `${sample.label}: Meta ${money(cost)} → ${money(price)}`
                        : CATEGORY_HINTS[category]}
                    </p>
                  </div>
                  {columns.map((currency) =>
                    box(
                      currency,
                      category,
                      `${CATEGORY_LABELS[category]} fixed markup in ${currency}`
                    )
                  )}
                  <div className="relative">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={percent}
                      aria-label={`${CATEGORY_LABELS[category]} percentage markup`}
                      aria-invalid={!valid(percent) || undefined}
                      className="pr-7 text-right tabular-nums"
                      onChange={(event) =>
                        setPercent(category, event.target.value)
                      }
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
              );
            })}

            <label className="flex items-start justify-between gap-4 border-t pt-3">
              <span className="min-w-0">
                <span className="text-sm font-medium">
                  Charge for messages Meta does not charge
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Free-tier replies and ad replies. Off, they cost nothing.
                </span>
              </span>
              <Switch
                checked={draft.chargeFree}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, chargeFree: checked }))
                }
              />
            </label>
          </div>
        </div>

        {invalid ? (
          <p className="text-xs text-destructive">
            Every box needs a number, zero or more.
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          {custom ? (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void resetToDefault()}
            >
              {busy === "clear" ? <Spinner /> : null} Use default markup
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null || invalid}
              onClick={() => void save()}
            >
              {busy === "save" ? <Spinner /> : null} Save markup
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
