"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_EVENT_TOUCHES,
  EVENT_TOUCHES,
  addDays,
  eventDateLabel,
  templateBlocker,
  touchLabel,
  zonedToInstant,
} from "@/convex/lib/marketing";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { TableSkeleton } from "@/components/skeletons";
import { TestSendButton } from "@/components/marketing/test-send";
import {
  HOURS,
  STATUS_VARIANT,
  dayLabel,
  formatDate,
  hourLabel,
  previewTemplate,
  shortDayLabel,
  templateOptionLabel,
  templateReady,
} from "@/components/marketing/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/convex-server";
import { cn } from "@/lib/utils";
import {
  CalendarCheckIcon,
  MegaphoneIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

/**
 * The Events tab: the business's own events, each with the reminders the
 * marketing desk writes and sends for it — before, on the day and after.
 *
 * A reminder is an ordinary calendar entry, so it also shows on the Calendar
 * tab; opening it from either place lands on the same dialog.
 */

export type Campaign = FunctionReturnType<typeof api.marketingCampaigns.list>[number];
type Touch = Campaign["touches"][number];
type Template = Doc<"marketingTemplates"> & { metaBody: string };

const MESSAGE_VARIABLE = /\{\{\s*message\s*\}\}/;
const VENUE_VARIABLE = /\{\{\s*venue\s*\}\}/;

const isPending = (touch: Touch) =>
  touch.status === "draft" || touch.status === "scheduled";

function fail(title: string, error: unknown) {
  toast.add({ title, description: errorMessage(error), type: "error" });
}

/** Templates for events first, then the rest, so the right one is on top. */
function templateOptions(templates: Template[]) {
  return [...templates]
    .sort((a, b) => Number(b.occasion === "event") - Number(a.occasion === "event"))
    .map((template) => ({
      value: template._id as string,
      label: templateOptionLabel(template),
    }));
}

// ------------------------------------------------------------------ the tab

export function EventsTab({
  campaigns,
  templates,
  today,
  onOpenTouch,
  onCreateTemplate,
}: {
  campaigns: Campaign[] | undefined;
  templates: Template[];
  today: string;
  onOpenTouch: (touch: Touch) => void;
  onCreateTemplate: () => void;
}) {
  const workspace = useWorkspace();
  const [draft, setDraft] = useState<CampaignDraft | null>(null);

  const eventTemplate =
    templates.find((t) => t.occasion === "event" && templateReady(t)) ??
    templates.find((t) => t.occasion === "event");

  const newCampaign = () =>
    setDraft({
      title: "",
      date: addDays(today, 7),
      startTime: "",
      venue: "",
      details: "",
      offer: "",
      link: "",
      templateId: eventTemplate?._id,
      sendHour: 10,
      touches: [...DEFAULT_EVENT_TOUCHES],
    });

  const openCampaign = (campaign: Campaign) =>
    setDraft({
      campaignId: campaign._id,
      title: campaign.title,
      date: campaign.date,
      startTime: campaign.startTime ?? "",
      venue: campaign.venue ?? "",
      details: campaign.details,
      offer: campaign.offer ?? "",
      link: campaign.link ?? "",
      templateId: campaign.templateId,
      sendHour: campaign.sendHour,
      touches: campaign.touches
        .filter(isPending)
        .map((touch) => touch.offsetDays ?? 0),
      sent: campaign.touches.filter((touch) => !isPending(touch)),
    });

  // Upcoming until its last reminder has gone: an event yesterday still has
  // its thank-you to send today.
  const upcoming = (campaigns ?? [])
    .filter((c) => c.date >= today || c.touches.some(isPending))
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = (campaigns ?? []).filter((c) => !upcoming.includes(c));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Events</h2>
          <p className="text-sm text-muted-foreground">
            Put an event on and the marketing desk writes and sends its reminders.
          </p>
        </div>
        <Button onClick={newCampaign}>
          <PlusIcon /> New event
        </Button>
      </div>

      {!eventTemplate ? (
        <Alert>
          <MegaphoneIcon />
          <AlertTitle>Reminders need an event template</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <p>
              One approved WhatsApp template carries every reminder, with the desk&apos;s
              line for each in <code>{"{{message}}"}</code>.
            </p>
            <Button size="sm" variant="outline" onClick={onCreateTemplate}>
              <PlusIcon /> Create the reminder template
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {campaigns === undefined ? (
        <TableSkeleton rows={3} columns={3} />
      ) : campaigns.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No events yet</EmptyTitle>
            <EmptyDescription>
              A launch, a workshop, a sale weekend — add it with its details and the
              desk sends the reminders on its own.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={newCampaign}>
            <PlusIcon /> New event
          </Button>
        </Empty>
      ) : (
        <>
          {upcoming.map((campaign) => (
            <EventCard
              key={campaign._id}
              campaign={campaign}
              templates={templates}
              locale={workspace.locale}
              onEdit={() => openCampaign(campaign)}
              onOpenTouch={onOpenTouch}
            />
          ))}
          {past.length > 0 ? (
            <>
              <h3 className="mt-2 text-sm font-medium text-muted-foreground">Past</h3>
              {past.map((campaign) => (
                <EventCard
                  key={campaign._id}
                  campaign={campaign}
                  templates={templates}
                  locale={workspace.locale}
                  onEdit={() => openCampaign(campaign)}
                  onOpenTouch={onOpenTouch}
                />
              ))}
            </>
          ) : null}
        </>
      )}

      <CampaignDialog draft={draft} setDraft={setDraft} templates={templates} />
    </div>
  );
}

function EventCard({
  campaign,
  templates,
  locale,
  onEdit,
  onOpenTouch,
}: {
  campaign: Campaign;
  templates: Template[];
  locale: string;
  onEdit: () => void;
  onOpenTouch: (touch: Touch) => void;
}) {
  const template = templates.find((t) => t._id === campaign.templateId);
  const waiting = campaign.touches.some(isPending);

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex w-12 shrink-0 flex-col items-center rounded-md border border-border py-1">
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {formatDate(campaign.date, { month: "short" })}
            </span>
            <span className="text-lg leading-none font-semibold tabular-nums">
              {formatDate(campaign.date, { day: "numeric" })}
            </span>
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate">{campaign.title}</CardTitle>
            <CardDescription className="truncate">
              {eventDateLabel(campaign.date, campaign.startTime, locale)}
              {campaign.venue ? ` · ${campaign.venue}` : ""}
            </CardDescription>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <PencilSimpleIcon /> Edit
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {waiting && !campaign.templateId ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <WarningCircleIcon className="size-3.5 shrink-0" />
            No template picked, so the reminders are drafts and will not send.
          </p>
        ) : waiting && template && !templateReady(template) ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <WarningCircleIcon className="size-3.5 shrink-0" />
            {templateBlocker(template)}
          </p>
        ) : null}

        {campaign.touches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {campaign.touches.map((touch) => (
              <li key={touch._id}>
                <button
                  type="button"
                  onClick={() => onOpenTouch(touch)}
                  className="flex w-full flex-col gap-1 p-3 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-start sm:gap-3"
                >
                  <span className="flex shrink-0 items-center justify-between gap-2 sm:w-36 sm:flex-col sm:items-start sm:gap-0">
                    <span className="text-sm font-medium">
                      {touchLabel(touch.offsetDays ?? 0)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {shortDayLabel(touch.date)} · {hourLabel(touch.sendHour)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-sm",
                      touch.message ? "line-clamp-2 text-muted-foreground" : "text-muted-foreground italic"
                    )}
                  >
                    {touch.message ??
                      (isPending(touch) ? "The desk is writing this one…" : "—")}
                  </span>
                  <Badge variant={STATUS_VARIANT[touch.status]} className="self-start">
                    {touch.status === "sent"
                      ? `sent to ${touch.sentCount}`
                      : touch.status}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------- the editor

type CampaignDraft = {
  campaignId?: Id<"marketingCampaigns">;
  title: string;
  date: string;
  startTime: string;
  venue: string;
  details: string;
  offer: string;
  link: string;
  templateId?: Id<"marketingTemplates">;
  sendHour: number;
  touches: number[];
  /** Reminders already gone out, which a save leaves alone. */
  sent?: Touch[];
};

function CampaignDialog({
  draft,
  setDraft,
  templates,
}: {
  draft: CampaignDraft | null;
  setDraft: (next: CampaignDraft | null) => void;
  templates: Template[];
}) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const save = useMutation(api.marketingCampaigns.save);
  const remove = useMutation(api.marketingCampaigns.remove);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  if (!draft) return <Dialog open={false} />;

  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const template = templates.find((t) => t._id === draft.templateId);
  const sentOffsets = new Set((draft.sent ?? []).map((touch) => touch.offsetDays ?? 0));

  const toggle = (offset: number, on: boolean) =>
    set(
      "touches",
      on
        ? [...draft.touches, offset]
        : draft.touches.filter((row) => row !== offset)
    );

  const submit = async () => {
    setBusy("save");
    try {
      const result = await save({
        workspaceId: workspace._id,
        campaignId: draft.campaignId,
        title: draft.title,
        date: draft.date,
        startTime: draft.startTime || undefined,
        venue: draft.venue,
        details: draft.details,
        offer: draft.offer,
        link: draft.link,
        templateId: draft.templateId,
        sendHour: draft.sendHour,
        touches: draft.touches,
      });
      toast.add({
        title: `${draft.title.trim()} saved`,
        description: draft.templateId
          ? `${result.scheduled} ${result.scheduled === 1 ? "reminder" : "reminders"} scheduled${
              result.passed ? `, ${result.passed} already past` : ""
            }. The desk is writing them now.`
          : "Pick a template to schedule the reminders.",
        type: "success",
      });
      setDraft(null);
    } catch (error) {
      fail("Could not save the event", error);
    } finally {
      setBusy(null);
    }
  };

  const drop = async () => {
    if (!draft.campaignId) return;
    setBusy("remove");
    try {
      await remove({ campaignId: draft.campaignId });
      toast.add({ title: "Event deleted", type: "success" });
      setDraft(null);
    } catch (error) {
      fail("Could not delete the event", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : setDraft(null))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft.campaignId ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>
            The marketing desk writes each reminder from these details and sends it to
            every WhatsApp customer, in {workspace.timezone}.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-title">Event</Label>
            <Input
              id="campaign-title"
              value={draft.title}
              maxLength={80}
              placeholder="Store launch, pottery workshop, monsoon sale…"
              onChange={(event) => set("title", event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-date">Day</Label>
              <Input
                id="campaign-date"
                type="date"
                value={draft.date}
                onChange={(event) => event.target.value && set("date", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-time">Starts at</Label>
              <Input
                id="campaign-time"
                type="time"
                value={draft.startTime}
                onChange={(event) => set("startTime", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-venue">Where</Label>
              <Input
                id="campaign-venue"
                value={draft.venue}
                maxLength={120}
                placeholder="MG Road store, or online"
                onChange={(event) => set("venue", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-details">What it is</Label>
            <Textarea
              id="campaign-details"
              rows={4}
              maxLength={2000}
              value={draft.details}
              placeholder="What is happening, who it is for, what to expect or bring. The desk writes every reminder from this."
              onChange={(event) => set("details", event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-offer">Offer</Label>
              <Input
                id="campaign-offer"
                value={draft.offer}
                maxLength={200}
                placeholder="Optional — 20% off for anyone who comes"
                onChange={(event) => set("offer", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-link">Link</Label>
              <Input
                id="campaign-link"
                value={draft.link}
                maxLength={300}
                placeholder="Optional — a booking or map link"
                onChange={(event) => set("link", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Messages</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Send at</span>
                <SelectField
                  size="sm"
                  aria-label="Send reminders at"
                  value={String(draft.sendHour)}
                  onValueChange={(next) => set("sendHour", Number(next))}
                  options={HOURS}
                />
              </div>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EVENT_TOUCHES.map((touch) => {
                const date = addDays(draft.date, touch.offset);
                const sent = sentOffsets.has(touch.offset);
                const passed =
                  !sent &&
                  zonedToInstant(date, draft.sendHour, workspace.timezone) <= now;
                const checked = sent || draft.touches.includes(touch.offset);
                return (
                  <label
                    key={touch.offset}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                      sent || passed ? "text-muted-foreground" : "cursor-pointer hover:bg-muted/40"
                    )}
                  >
                    <Checkbox
                      checked={checked && !passed}
                      disabled={sent || passed}
                      onCheckedChange={(on) => toggle(touch.offset, on === true)}
                    />
                    <span className="min-w-0 flex-1">
                      {touch.label}
                      <span className="block text-xs text-muted-foreground">
                        {sent ? "Already sent" : passed ? "Already past" : shortDayLabel(date)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No templates yet. Save the event now and pick one once it is written.
              </p>
            ) : (
              <SelectField
                aria-label="Template"
                value={draft.templateId ?? "none"}
                onValueChange={(next) =>
                  set(
                    "templateId",
                    next === "none" ? undefined : (next as Id<"marketingTemplates">)
                  )
                }
                options={[
                  { value: "none", label: "None yet — keep the reminders as drafts" },
                  ...templateOptions(templates),
                ]}
              />
            )}
            {template ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="whitespace-pre-wrap">
                  {previewTemplate(template.body, {
                    business: workspace.name,
                    event: draft.title,
                    date: eventDateLabel(
                      draft.date,
                      draft.startTime || undefined,
                      workspace.locale
                    ),
                    venue: draft.venue,
                    message: "[the desk's line for each reminder]",
                  })}
                </p>
                {!MESSAGE_VARIABLE.test(template.body) ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <WarningCircleIcon className="size-3.5 shrink-0" />
                    It has no <code>{"{{message}}"}</code>, so every reminder says the same
                    thing.
                  </p>
                ) : null}
                {VENUE_VARIABLE.test(template.body) && !draft.venue.trim() ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <WarningCircleIcon className="size-3.5 shrink-0" />
                    It uses <code>{"{{venue}}"}</code> — say where the event is, or it
                    cannot send.
                  </p>
                ) : null}
                {!templateReady(template) ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <WarningCircleIcon className="size-3.5 shrink-0" />
                    {templateBlocker(template)} The reminders cannot send until it is
                    approved.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {draft.campaignId ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void drop()}>
              {busy === "remove" ? <Spinner /> : <TrashIcon />} Delete event
            </Button>
          ) : (
            <span />
          )}
          <Button
            disabled={busy !== null || !draft.title.trim() || !draft.details.trim()}
            onClick={() => void submit()}
          >
            {busy === "save" ? <Spinner /> : <CalendarCheckIcon />}
            {draft.templateId ? "Save and schedule" : "Save as draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ one reminder

/**
 * One reminder: its line, which the owner can change or have rewritten until
 * it goes, and what it came to once it has.
 */
export function TouchDialog({
  campaign,
  touch,
  templates,
  onClose,
}: {
  campaign: Campaign | null;
  touch: Touch | null;
  templates: Template[];
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const updateMessage = useMutation(api.marketingCampaigns.updateMessage);
  const rewrite = useAction(api.marketingAi.rewriteTouches);
  const sendNow = useMutation(api.marketing.sendEventNow);
  const removeEvent = useMutation(api.marketing.removeEvent);
  // Null until the owner types, so a rewrite that lands shows straight away.
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "write" | "send" | "remove" | null>(null);

  if (!campaign || !touch) return <Dialog open={false} />;

  const pending = isPending(touch);
  const template = templates.find((t) => t._id === touch.templateId);
  const message = edited ?? touch.message ?? "";
  const changed = edited !== null && edited.trim() !== (touch.message ?? "");

  const run = async (
    key: "save" | "write" | "send" | "remove",
    failure: string,
    work: () => Promise<unknown>,
    done?: string,
    close = false
  ) => {
    setBusy(key);
    try {
      await work();
      if (done) toast.add({ title: done, type: "success" });
      if (close) onClose();
    } catch (error) {
      fail(failure, error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {campaign.title} · {touchLabel(touch.offsetDays ?? 0)}
            <Badge variant={STATUS_VARIANT[touch.status]}>{touch.status}</Badge>
          </DialogTitle>
          <DialogDescription>
            {dayLabel(touch.date)} at {hourLabel(touch.sendHour)} ({workspace.timezone})
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {pending ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="touch-message">Message</Label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("write", "The desk could not rewrite it", async () => {
                      await rewrite({ campaignId: campaign._id, eventId: touch._id });
                      setEdited(null);
                    })
                  }
                >
                  {busy === "write" ? <Spinner /> : <SparkleIcon />}
                  {busy === "write" ? "Writing…" : touch.message ? "Rewrite" : "Write it now"}
                </Button>
              </div>
              <Textarea
                id="touch-message"
                rows={3}
                maxLength={400}
                value={message}
                placeholder="The desk writes this from the event's details."
                onChange={(event) => setEdited(event.target.value)}
              />
            </div>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Delivered</dt>
              <dd>
                {touch.status === "sending" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner /> {touch.sentCount} so far
                  </span>
                ) : (
                  `${touch.sentCount} sent${touch.failedCount ? ` · ${touch.failedCount} failed` : ""}`
                )}
              </dd>
              {touch.lastError ? (
                <>
                  <dt className="text-muted-foreground">Last error</dt>
                  <dd className="font-mono text-xs break-all text-destructive">
                    {touch.lastError}
                  </dd>
                </>
              ) : null}
            </dl>
          )}

          {template ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                What a customer reads
              </p>
              <p className="whitespace-pre-wrap">
                {previewTemplate(template.body, {
                  business: workspace.name,
                  event: campaign.title,
                  date: eventDateLabel(campaign.date, campaign.startTime, workspace.locale),
                  venue: campaign.venue,
                  message,
                })}
              </p>
            </div>
          ) : pending ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <WarningCircleIcon className="size-3.5 shrink-0" />
              The event has no template, so this is a draft and will not send.
            </p>
          ) : null}
        </DialogBody>

        {pending ? (
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "remove",
                  "Could not skip it",
                  () => removeEvent({ eventId: touch._id }),
                  "Reminder skipped",
                  true
                )
              }
            >
              {busy === "remove" ? <Spinner /> : <TrashIcon />} Skip this one
            </Button>
            <div className="flex flex-wrap gap-2">
              <TestSendButton
                eventId={touch._id}
                disabledReason={
                  changed
                    ? "Save the change first — the test sends what is saved."
                    : template
                      ? templateBlocker(template)
                      : "The event has no template yet."
                }
              />
              {touch.templateId ? (
                <Button
                  variant="outline"
                  disabled={busy !== null || changed}
                  title={changed ? "Save the change first" : undefined}
                  onClick={() =>
                    void run(
                      "send",
                      "Could not send it",
                      () => sendNow({ eventId: touch._id }),
                      "Sending now",
                      true
                    )
                  }
                >
                  {busy === "send" ? <Spinner /> : <PaperPlaneTiltIcon />} Send now
                </Button>
              ) : null}
              <Button
                disabled={busy !== null || !changed || !message.trim()}
                onClick={() =>
                  void run(
                    "save",
                    "Could not save the message",
                    async () => {
                      await updateMessage({ eventId: touch._id, message });
                      setEdited(null);
                    },
                    "Message saved"
                  )
                }
              >
                {busy === "save" ? <Spinner /> : null} Save
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
