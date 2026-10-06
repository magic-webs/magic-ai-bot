"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  MESSAGE_CATEGORIES,
  formatMoney,
  fromMicros,
  markupOn,
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

type Draft = Record<MessageCategory, { fixed: string; percent: string }> & {
  free: string;
};

function draftOf(card: MarkupView | null): Draft {
  // Plain decimals, not formatMoney: this is what goes back in the box.
  const show = (micros: number | undefined) =>
    micros === undefined ? "0" : String(fromMicros(micros));
  const entry = (category: MessageCategory) => ({
    fixed: show(card?.[category].fixedMicros),
    percent: String(card?.[category].percent ?? 0),
  });
  return {
    service: entry("service"),
    utility: entry("utility"),
    marketing: entry("marketing"),
    authentication: entry("authentication"),
    free: show(card?.freeMicros),
  };
}

const valid = (value: string) => value.trim() !== "" && Number(value) >= 0;

/**
 * Edit the platform's markup on Meta's rates, per category: a fixed amount,
 * a percentage of Meta's rate, or both — plus what a message Meta did not
 * charge for costs. With a workspace, that account's own markup; without
 * one, the default.
 */
export function MarkupDialog({
  workspaceId,
  workspaceName,
  current,
  fallback,
  currency,
  sample,
  trigger,
}: {
  workspaceId?: Id<"workspaces">;
  workspaceName?: string;
  current: MarkupView | null;
  fallback?: MarkupView | null;
  currency: string;
  /** One market's Meta rates, to show what a message ends up costing. */
  sample?: MetaRateRow;
  trigger: React.ReactElement;
}) {
  const setMarkups = useMutation(api.billing.setMarkups);
  const clearMarkups = useMutation(api.billing.clearMarkups);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(current ?? fallback ?? null));

  const custom = Boolean(workspaceId && current);
  const money = (micros: number) => formatMoney(micros, currency);
  const setField = (
    category: MessageCategory,
    field: "fixed" | "percent",
    value: string
  ) =>
    setDraft((prev) => ({
      ...prev,
      [category]: { ...prev[category], [field]: value },
    }));

  const invalid =
    !valid(draft.free) ||
    MESSAGE_CATEGORIES.some(
      (category) =>
        !valid(draft[category].fixed) || !valid(draft[category].percent)
    );

  const save = async () => {
    if (invalid) return;
    setBusy("save");
    const entry = (category: MessageCategory) => ({
      fixed: Number(draft[category].fixed),
      percent: Number(draft[category].percent),
    });
    try {
      await setMarkups({
        workspaceId,
        service: entry("service"),
        utility: entry("utility"),
        marketing: entry("marketing"),
        authentication: entry("authentication"),
        free: Number(draft.free),
      });
      toast.add({
        title: workspaceName ? `Markup saved for ${workspaceName}` : "Default markup saved",
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(draftOf(current ?? fallback ?? null));
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {workspaceName ? `Markup for ${workspaceName}` : "Default markup"}
          </DialogTitle>
          <DialogDescription>
            Added on top of Meta&apos;s rate for each message: a fixed amount, a
            percentage of Meta&apos;s rate, or both. Applies to messages sent
            from now on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {MESSAGE_CATEGORIES.map((category) => {
            const fixed = draft[category].fixed;
            const percent = draft[category].percent;
            const cost = sample ? metaCostOf(sample, category) : null;
            const price =
              cost !== null && valid(fixed) && valid(percent)
                ? cost +
                  markupOn(cost, {
                    fixedMicros: toMicros(Number(fixed)),
                    percent: Number(percent),
                  })
                : null;
            return (
              <div
                key={category}
                className="grid items-center gap-x-3 gap-y-2 sm:grid-cols-[1fr_7.5rem_6rem]"
              >
                <div className="min-w-0">
                  <Label
                    htmlFor={`markup-${category}-fixed`}
                    className="flex items-center gap-2"
                  >
                    <CategoryDot category={category} />
                    {CATEGORY_LABELS[category]}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cost !== null && price !== null && sample
                      ? `${sample.label}: Meta ${money(cost)} → ${money(price)}`
                      : CATEGORY_HINTS[category]}
                  </p>
                </div>
                <div className="relative">
                  <Input
                    id={`markup-${category}-fixed`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={fixed}
                    aria-label={`${CATEGORY_LABELS[category]} fixed markup`}
                    aria-invalid={!valid(fixed) || undefined}
                    className="pr-12 text-right tabular-nums"
                    onChange={(event) => setField(category, "fixed", event.target.value)}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                    {currency}
                  </span>
                </div>
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
                    onChange={(event) => setField(category, "percent", event.target.value)}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            );
          })}

          <div className="grid items-center gap-x-3 gap-y-2 border-t pt-3 sm:grid-cols-[1fr_7.5rem_6rem]">
            <div className="min-w-0">
              <Label htmlFor="markup-free">Messages Meta does not charge</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The monthly free service messages and replies to ads. Zero
                makes them free for the account too.
              </p>
            </div>
            <div className="relative">
              <Input
                id="markup-free"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={draft.free}
                aria-invalid={!valid(draft.free) || undefined}
                className="pr-12 text-right tabular-nums"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, free: event.target.value }))
                }
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                {currency}
              </span>
            </div>
          </div>

          {invalid ? (
            <p className="text-xs text-destructive">
              Every box needs a number, zero or more.
            </p>
          ) : null}
        </div>

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
            <Button disabled={busy !== null || invalid} onClick={() => void save()}>
              {busy === "save" ? <Spinner /> : null} Save markup
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
