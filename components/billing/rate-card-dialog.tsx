"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  MESSAGE_CATEGORIES,
  fromMicros,
  formatMoney,
  toMicros,
  type MessageCategory,
} from "@/convex/lib/billing";
import { CurrencyPicker } from "@/components/regional-pickers";
import { CategoryDot } from "@/components/billing/category";
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

/** A rate card as the billing queries return it. */
export type RateView = {
  scope: "workspace" | "default";
  currency: string;
  serviceMicros: number;
  utilityMicros: number;
  marketingMicros: number;
  authenticationMicros: number;
  updatedAt: number;
};

type Draft = { currency: string } & Record<MessageCategory, string>;

function draftOf(card: RateView | null, currency: string): Draft {
  // Plain decimals, not formatMoney: this is what goes back in the box, and
  // "TSh 150.00" is not a number the box can hold.
  const show = (micros: number | undefined) =>
    micros === undefined ? "" : String(fromMicros(micros));
  return {
    currency: card?.currency ?? currency,
    service: show(card?.serviceMicros) || "0",
    utility: show(card?.utilityMicros) || "0",
    marketing: show(card?.marketingMicros) || "0",
    authentication: show(card?.authenticationMicros) || "0",
  };
}

/**
 * Edit what one message of each category costs.
 *
 * With a workspace, that account's own rates — prefilled from the platform
 * default when it has none yet, since the usual edit is "the same, but
 * cheaper marketing". Without one, the platform default itself.
 */
export function RateCardDialog({
  workspaceId,
  workspaceName,
  current,
  fallback,
  defaultCurrency,
  trigger,
}: {
  workspaceId?: Id<"workspaces">;
  workspaceName?: string;
  /** The card being edited: the account's own, or the default. */
  current: RateView | null;
  /** The platform default, to prefill an account that has no card yet. */
  fallback?: RateView | null;
  /** The currency a brand-new card opens on — the account's own. */
  defaultCurrency: string;
  trigger: React.ReactElement;
}) {
  const setRates = useMutation(api.billing.setRates);
  const clearRates = useMutation(api.billing.clearRates);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(current ?? fallback ?? null, defaultCurrency)
  );

  const custom = Boolean(workspaceId && current?.scope === "workspace");
  const set = (key: keyof Draft, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const parsed = MESSAGE_CATEGORIES.map((category) => ({
    category,
    value: Number(draft[category]),
  }));
  const invalid = parsed.find(
    (rate) => draft[rate.category].trim() === "" || !(rate.value >= 0)
  );

  const save = async () => {
    if (invalid) return;
    setBusy("save");
    try {
      await setRates({
        workspaceId,
        currency: draft.currency,
        service: Number(draft.service),
        utility: Number(draft.utility),
        marketing: Number(draft.marketing),
        authentication: Number(draft.authentication),
      });
      toast.add({
        title: workspaceName ? `Rates saved for ${workspaceName}` : "Default rates saved",
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not save the rates",
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
      await clearRates({ workspaceId });
      toast.add({
        title: `${workspaceName ?? "This account"} is back on the default rates`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not reset the rates",
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
        // Reopened fresh each time, so a cancelled edit is not waiting there
        // next time and the form reflects whatever was saved since.
        if (next) setDraft(draftOf(current ?? fallback ?? null, defaultCurrency));
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {workspaceName ? `Rates for ${workspaceName}` : "Platform default rates"}
          </DialogTitle>
          <DialogDescription>
            {workspaceName
              ? "What this account pays per WhatsApp message, by the category Meta bills it under."
              : "What every account without rates of its own pays per WhatsApp message."}{" "}
            Changes apply to messages sent from now on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rate-currency">Billed in</Label>
            <CurrencyPicker
              id="rate-currency"
              value={draft.currency}
              onValueChange={(code) => set("currency", code)}
            />
          </div>

          <div className="flex flex-col gap-3">
            {MESSAGE_CATEGORIES.map((category) => {
              const value = Number(draft[category]);
              const bad = draft[category].trim() === "" || !(value >= 0);
              return (
                <div
                  key={category}
                  className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[1fr_9rem]"
                >
                  <div className="min-w-0">
                    <Label
                      htmlFor={`rate-${category}`}
                      className="flex items-center gap-2"
                    >
                      <CategoryDot category={category} />
                      {CATEGORY_LABELS[category]}
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {CATEGORY_HINTS[category]}
                    </p>
                  </div>
                  <div className="relative">
                    <Input
                      id={`rate-${category}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={draft[category]}
                      aria-invalid={bad || undefined}
                      className="pr-12 text-right tabular-nums"
                      onChange={(event) => set(category, event.target.value)}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      {draft.currency}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* One worked figure, because a rate typed as 0.0107 is easy to
              get a decimal place wrong on and hard to sanity-check bare. */}
          {!invalid ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              A campaign to 1,000 customers would cost{" "}
              <span className="font-medium text-foreground">
                {formatMoney(
                  toMicros(Number(draft.marketing) * 1000),
                  draft.currency
                )}
              </span>{" "}
              in marketing messages.
            </p>
          ) : (
            <p className="text-xs text-destructive">
              Every rate needs a number — zero if that category is free.
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {custom ? (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void resetToDefault()}
            >
              {busy === "clear" ? <Spinner /> : null} Use default rates
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null || Boolean(invalid)}
              onClick={() => void save()}
            >
              {busy === "save" ? <Spinner /> : null} Save rates
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
