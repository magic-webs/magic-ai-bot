"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatMoney } from "@/convex/lib/billing";
import { templateBlocker } from "@/convex/lib/marketing";
import {
  HOURS,
  dayLabel,
  hourLabel,
  previewTemplate,
  templateOptionLabel,
  templateReady,
} from "@/components/marketing/format";
import { TestSendButton } from "@/components/marketing/test-send";
import {
  AudiencePicker,
  EVERYONE,
  type AudienceChoice,
} from "@/components/marketing/audience/audience-picker";
import { fail, plural, type Category } from "@/components/marketing/audience/shared";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import { PaperPlaneTiltIcon, WarningCircleIcon } from "@phosphor-icons/react";

type Template = Doc<"marketingTemplates"> & { metaBody: string };

export type CampaignDraft = {
  eventId?: Id<"marketingEvents">;
  title: string;
  templateId?: Id<"marketingTemplates">;
  message: string;
  audience: AudienceChoice;
  date: string;
  sendHour: number;
  ratePerMinute?: number;
  trackLinks: boolean;
  when: "now" | "later";
};

export function emptyCampaign(today: string): CampaignDraft {
  return {
    title: "",
    message: "",
    audience: EVERYONE,
    date: today,
    sendHour: 10,
    trackLinks: true,
    when: "later",
  };
}

const SPEEDS = [
  { value: "0", label: "As fast as allowed" },
  { value: "300", label: "300 a minute" },
  { value: "100", label: "100 a minute" },
  { value: "30", label: "30 a minute" },
];

const MESSAGE_VARIABLE = /\{\{\s*message\s*\}\}/;

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">
          {step}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function CampaignComposer({
  draft: initial,
  templates,
  categories,
  today,
  onClose,
  onSaved,
}: {
  draft: CampaignDraft;
  templates: Template[];
  categories: Category[];
  today: string;
  onClose: () => void;
  onSaved: (eventId: Id<"marketingEvents">, sentNow: boolean) => void;
}) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const save = useMutation(api.marketingBroadcasts.save);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const template = templates.find((t) => t._id === draft.templateId);
  const estimate = useQuery(api.marketingBroadcasts.estimate, {
    workspaceId: workspace._id,
    templateId: draft.templateId,
    audience: draft.audience,
    now,
  });
  const needsMessage = template ? MESSAGE_VARIABLE.test(template.body) : false;
  const blocker = template ? templateBlocker(template) : null;
  const short =
    estimate?.balanceMicros !== null &&
    estimate?.balanceMicros !== undefined &&
    estimate.costMicros > estimate.balanceMicros;

  const sortedTemplates = [...templates].sort(
    (a, b) => Number(templateReady(b)) - Number(templateReady(a))
  );

  const submit = async () => {
    if (!draft.templateId) return;
    setBusy(true);
    try {
      const eventId = await save({
        workspaceId: workspace._id,
        eventId: draft.eventId,
        title: draft.title,
        templateId: draft.templateId,
        message: draft.message,
        audience: draft.audience,
        date: draft.when === "now" ? today : draft.date,
        sendHour: draft.sendHour,
        ratePerMinute: draft.ratePerMinute,
        trackLinks: draft.trackLinks,
        sendNow: draft.when === "now",
      });
      toast.add({
        title: draft.when === "now" ? "Sending now" : "Campaign scheduled",
        description:
          draft.when === "now"
            ? "Watch it go out in the report."
            : `${dayLabel(draft.date)} at ${hourLabel(draft.sendHour)}.`,
        type: "success",
      });
      onSaved(eventId, draft.when === "now");
    } catch (error) {
      fail("Could not save the campaign", error);
    } finally {
      setBusy(false);
    }
  };

  const money = (micros: number) =>
    estimate?.currency ? formatMoney(micros, estimate.currency) : null;

  return (
    <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{draft.eventId ? "Edit campaign" : "New campaign"}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            One approved WhatsApp template, sent to the people you choose. Unsubscribed contacts are
            always left out.
          </p>
        </div>
        <div className="flex flex-col gap-6">
          <Section step={1} title="Name it">
            <Input
              value={draft.title}
              maxLength={80}
              placeholder="e.g. Monsoon sale — early access"
              onChange={(e) => set({ title: e.target.value })}
            />
          </Section>

          <Section step={2} title="Who gets it">
            <AudiencePicker
              value={draft.audience}
              categories={categories}
              onChange={(audience) => set({ audience })}
            />
          </Section>

          <Section step={3} title="What they read">
            <SelectField
              aria-label="Template"
              value={draft.templateId ?? ""}
              placeholder="Pick an approved template"
              onValueChange={(value) => set({ templateId: value as Id<"marketingTemplates"> })}
              options={sortedTemplates.map((t) => ({ value: t._id, label: templateOptionLabel(t) }))}
            />
            {blocker ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <WarningCircleIcon className="size-3.5" /> {blocker}
              </p>
            ) : null}
            {needsMessage ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="campaign-message">The line that fills {"{{message}}"}</Label>
                <Textarea
                  id="campaign-message"
                  rows={2}
                  maxLength={400}
                  value={draft.message}
                  placeholder="Flat 20% off everything this weekend, in store and online."
                  onChange={(e) => set({ message: e.target.value })}
                />
              </div>
            ) : null}
            {template ? (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">What a customer reads</p>
                <p className="max-w-md rounded-lg rounded-tl-none bg-background p-3 text-sm whitespace-pre-wrap shadow-sm">
                  {previewTemplate(template.body, {
                    business: workspace.name,
                    event: draft.title,
                    date: dayLabel(draft.when === "now" ? today : draft.date),
                    message: draft.message,
                  })}
                </p>
                <TestSendButton templateId={template._id} />
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={draft.trackLinks}
                onCheckedChange={(next) => set({ trackLinks: next === true })}
              />
              <span>
                Track link clicks
                <span className="block text-xs text-muted-foreground">
                  A link in the message is swapped for a short one per person, so clicks are
                  counted, and tagged for Google Analytics (utm_source=whatsapp).
                </span>
              </span>
            </label>
          </Section>

          <Section step={4} title="When it goes">
            <ToggleGroup
              variant="outline"
              value={[draft.when]}
              onValueChange={(next) => next[0] && set({ when: next[0] as CampaignDraft["when"] })}
            >
              <ToggleGroupItem value="later">Schedule</ToggleGroupItem>
              <ToggleGroupItem value="now">Send now</ToggleGroupItem>
            </ToggleGroup>
            <div className="grid gap-3 sm:grid-cols-3">
              {draft.when === "later" ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="campaign-date">Day</Label>
                    <Input
                      id="campaign-date"
                      type="date"
                      min={today}
                      value={draft.date}
                      onChange={(e) => set({ date: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>At ({workspace.timezone})</Label>
                    <SelectField
                      aria-label="Hour"
                      value={String(draft.sendHour)}
                      onValueChange={(value) => set({ sendHour: Number(value) })}
                      options={HOURS}
                    />
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label>Speed</Label>
                <SelectField
                  aria-label="Speed"
                  value={String(draft.ratePerMinute ?? 0)}
                  onValueChange={(value) => set({ ratePerMinute: Number(value) || undefined })}
                  options={SPEEDS}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sending slower spreads replies out so your team can keep up, and is gentler on a new
              number&apos;s quality rating.
            </p>
          </Section>

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Before it goes</p>
            {estimate === undefined ? (
              <Spinner />
            ) : (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Will receive it</dt>
                  <dd className="font-medium tabular-nums">
                    {plural(estimate.reachable, "person", "people")}
                    {estimate.partial ? "+" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Left out</dt>
                  <dd className="tabular-nums">
                    {estimate.optedOut} unsubscribed · {estimate.overCap} over the limit
                  </dd>
                </div>
                {money(estimate.costMicros) ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Estimated cost</dt>
                    <dd className="font-medium tabular-nums">{money(estimate.costMicros)}</dd>
                  </div>
                ) : null}
                {estimate.balanceMicros !== null && money(estimate.balanceMicros) ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Wallet</dt>
                    <dd className={short ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>
                      {money(estimate.balanceMicros)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
            {short ? (
              <p className="text-xs text-destructive">
                The wallet does not cover everyone. Sending stops when it runs out — top up on the
                Billing page first.
              </p>
            ) : null}
            {estimate && estimate.reachable === 0 ? (
              <Badge variant="outline" className="w-fit">
                Nobody matches these choices yet
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              busy ||
              !draft.title.trim() ||
              !draft.templateId ||
              (needsMessage && !draft.message.trim()) ||
              (draft.when === "now" && Boolean(blocker))
            }
          >
            {busy ? <Spinner /> : <PaperPlaneTiltIcon />}
            {draft.when === "now" ? "Send now" : "Schedule"}
          </Button>
        </div>
    </div>
  );
}
