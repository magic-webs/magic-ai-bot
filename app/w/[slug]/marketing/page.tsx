"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { AgentAvatar } from "@/components/agent-avatar";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/convex-server";
import { cn } from "@/lib/utils";
import {
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
  GiftIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";

/**
 * The marketing desk — birthday wishes and festival greetings, on a calendar.
 *
 * Everything here goes out as an approved WhatsApp template. A greeting
 * reaches people who have not written in the last 24 hours, and outside that
 * window Meta delivers nothing else. So a template is written here, submitted
 * in WhatsApp Manager in the numbered form this page shows, and only sends
 * once the name Meta approved it under is pasted back. The page says so
 * wherever it matters, rather than letting a scheduled Diwali greeting fail on
 * the morning.
 */

type Template = Doc<"marketingTemplates"> & { metaBody: string };
type Occasion = Doc<"marketingTemplates">["occasion"];
type EventStatus = Doc<"marketingEvents">["status"];
type CalendarEvent = Doc<"marketingEvents"> & { templateName: string | null };
type Festival = { key: string; name: string; date: string };

const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: "festival", label: "Festival" },
  { value: "birthday", label: "Birthday" },
  { value: "offer", label: "Offer" },
  { value: "general", label: "General" },
];

const STATUS_VARIANT: Record<
  EventStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  scheduled: "default",
  sending: "default",
  sent: "secondary",
  failed: "destructive",
};

/** The chip a greeting gets inside a calendar cell. */
const STATUS_CHIP: Record<EventStatus, string> = {
  draft: "border border-dashed border-border text-muted-foreground",
  scheduled: "bg-primary text-primary-foreground",
  sending: "bg-primary/80 text-primary-foreground",
  sent: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: hourLabel(hour),
}));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ------------------------------------------------------------------- dates

/*
 * Every date on this page is a workspace-local calendar date, "YYYY-MM-DD",
 * and the arithmetic runs on those strings through UTC. The browser's own
 * timezone never enters into it: an owner working from Dubai still sees
 * Diwali on the day their Kolkata customers do.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function localDate(instant: number, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The month as weeks of seven, Sunday first, blank either side. */
function monthGrid(year: number, month: number): (string | null)[] {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    cells.push(ymd(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

const monthLabel = (year: number, month: number) =>
  formatDate(ymd(year, month, 1), { month: "long", year: "numeric" });

const dayLabel = (date: string) =>
  formatDate(date, { weekday: "long", day: "numeric", month: "long" });

/** "MM-DD" as "12 Mar". */
const birthdayLabel = (monthDay: string) =>
  formatDate(`2000-${monthDay}`, { day: "numeric", month: "short" });

function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

// --------------------------------------------------------------- templates

const VARIABLE = /\{\{\s*(name|business|event)\s*\}\}/g;

/** The body as it has to be submitted in Meta. Mirrors lib/marketing's. */
function metaBody(body: string): string {
  let index = 0;
  return body.replace(VARIABLE, () => `{{${++index}}}`);
}

/** The body as one customer would read it. */
function preview(body: string, business: string, event: string): string {
  return body.replace(VARIABLE, (_, name: string) =>
    name === "name" ? "Asha" : name === "business" ? business : event
  );
}

function fail(title: string, error: unknown) {
  toast.add({ title, description: errorMessage(error), type: "error" });
}

// ---------------------------------------------------------------- calendar

type DayInfo = {
  events: CalendarEvent[];
  birthdays: { contactId: Id<"contacts">; name: string }[];
  festivals: (Festival & { added: boolean })[];
};

function MonthGrid({
  year,
  month,
  today,
  selected,
  byDay,
  onSelect,
  onEvent,
  onFestival,
}: {
  year: number;
  month: number;
  today: string;
  selected: string;
  byDay: Map<string, DayInfo>;
  onSelect: (date: string) => void;
  onEvent: (event: CalendarEvent) => void;
  onFestival: (festival: Festival) => void;
}) {
  const cells = useMemo(() => monthGrid(year, month), [year, month]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
          >
            <span className="sm:hidden">{day[0]}</span>
            <span className="hidden sm:inline">{day}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, index) => {
          const edge = cn(
            "min-h-16 border-border sm:min-h-28",
            index % 7 !== 6 && "border-r",
            index < cells.length - 7 && "border-b"
          );
          if (!date) {
            return <div key={`blank-${index}`} className={cn(edge, "bg-muted/20")} />;
          }

          const info = byDay.get(date);
          const suggestions = (info?.festivals ?? []).filter((f) => !f.added);
          const chips = info?.events.length ?? 0;
          const isSelected = date === selected;
          const isToday = date === today;

          return (
            // A div rather than a button: the chips inside are buttons of their
            // own, and a button may not hold another.
            <div
              key={date}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={dayLabel(date)}
              onClick={() => onSelect(date)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(date);
                }
              }}
              className={cn(
                edge,
                "flex cursor-pointer flex-col gap-1 p-1 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:p-1.5",
                isSelected && "bg-primary/5 hover:bg-primary/10",
                date < today && "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  isToday && "bg-primary font-semibold text-primary-foreground",
                  !isToday && isSelected && "font-semibold text-primary"
                )}
              >
                {parts(date).day}
              </span>

              {/* Phones get dots; the chips need a column wider than a thumb. */}
              <div className="flex flex-wrap gap-0.5 sm:hidden">
                {chips ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                {info?.birthdays.length ? (
                  <span className="size-1.5 rounded-full bg-pink-600 dark:bg-pink-400" />
                ) : null}
                {suggestions.length ? (
                  <span className="size-1.5 rounded-full border border-primary" />
                ) : null}
              </div>

              <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {(info?.events ?? []).slice(0, 3).map((event) => (
                  <button
                    key={event._id}
                    type="button"
                    onClick={(click) => {
                      click.stopPropagation();
                      onEvent(event);
                    }}
                    title={`${event.title} · ${event.status}`}
                    className={cn(
                      "truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium",
                      STATUS_CHIP[event.status]
                    )}
                  >
                    {event.title}
                  </button>
                ))}
                {chips > 3 ? (
                  <span className="px-1.5 text-[11px] text-muted-foreground">
                    +{chips - 3} more
                  </span>
                ) : null}
                {info?.birthdays.length ? (
                  <span className="flex items-center gap-1 truncate px-1.5 text-[11px] font-medium text-pink-700 dark:text-pink-300">
                    <GiftIcon className="size-3 shrink-0" />
                    {info.birthdays.length === 1
                      ? info.birthdays[0].name
                      : `${info.birthdays.length} birthdays`}
                  </span>
                ) : null}
                {date >= today
                  ? suggestions.map((festival) => (
                      <button
                        key={festival.key}
                        type="button"
                        onClick={(click) => {
                          click.stopPropagation();
                          onFestival(festival);
                        }}
                        title={`Schedule a ${festival.name} greeting`}
                        className="flex items-center gap-1 truncate rounded border border-dashed border-primary/50 px-1.5 py-0.5 text-left text-[11px] text-primary hover:bg-primary/5"
                      >
                        <PlusIcon className="size-3 shrink-0" />
                        {festival.name}
                      </button>
                    ))
                  : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayPanel({
  date,
  today,
  info,
  onEvent,
  onNew,
  onFestival,
}: {
  date: string;
  today: string;
  info: DayInfo | undefined;
  onEvent: (event: CalendarEvent) => void;
  onNew: () => void;
  onFestival: (festival: Festival) => void;
}) {
  const past = date < today;
  const suggestions = (info?.festivals ?? []).filter((f) => !f.added);
  const empty =
    !info?.events.length && !info?.birthdays.length && !suggestions.length;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{dayLabel(date)}</CardTitle>
        <CardDescription>
          {date === today ? "Today" : past ? "In the past" : "Coming up"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {empty ? (
          <p className="text-sm text-muted-foreground">
            {past ? "Nothing went out on this day." : "Nothing planned yet."}
          </p>
        ) : null}

        {(info?.events ?? []).map((event) => (
          <button
            key={event._id}
            type="button"
            onClick={() => onEvent(event)}
            className="flex items-center gap-2.5 rounded-md border border-border p-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <MegaphoneIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{event.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {event.status === "sent" || event.status === "failed"
                  ? `${event.sentCount} sent${event.failedCount ? ` · ${event.failedCount} failed` : ""}`
                  : `${hourLabel(event.sendHour)} · ${event.templateName ?? "no template yet"}`}
              </span>
            </span>
            <Badge variant={STATUS_VARIANT[event.status]}>{event.status}</Badge>
          </button>
        ))}

        {info?.birthdays.length ? (
          <div className="flex items-start gap-2.5 rounded-md border border-border p-2.5">
            <GiftIcon className="mt-0.5 size-4 shrink-0 text-pink-600 dark:text-pink-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {info.birthdays.length === 1
                  ? "1 birthday"
                  : `${info.birthdays.length} birthdays`}
              </span>
              <span className="block text-xs text-muted-foreground">
                {info.birthdays.map((row) => row.name).join(", ")}
              </span>
            </span>
          </div>
        ) : null}

        {!past
          ? suggestions.map((festival) => (
              <button
                key={festival.key}
                type="button"
                onClick={() => onFestival(festival)}
                className="flex items-center gap-2.5 rounded-md border border-dashed border-primary/50 p-2.5 text-left transition-colors hover:bg-primary/5"
              >
                <SparkleIcon className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{festival.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    Festival — schedule a greeting
                  </span>
                </span>
                <PlusIcon className="size-4 text-primary" />
              </button>
            ))
          : null}

        {!past ? (
          <Button variant="outline" size="sm" onClick={onNew} className="mt-1">
            <PlusIcon /> Schedule on this day
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- dialogs

type EventDraft = {
  eventId?: Id<"marketingEvents">;
  title: string;
  date: string;
  sendHour: number;
  templateId?: Id<"marketingTemplates">;
  presetKey?: string;
  saved?: CalendarEvent;
};

function EventDialog({
  draft,
  setDraft,
  templates,
  today,
  timezone,
  business,
}: {
  draft: EventDraft | null;
  setDraft: (next: EventDraft | null) => void;
  templates: Template[];
  today: string;
  timezone: string;
  business: string;
}) {
  const workspace = useWorkspace();
  const saveEvent = useMutation(api.marketing.saveEvent);
  const removeEvent = useMutation(api.marketing.removeEvent);
  const sendNow = useMutation(api.marketing.sendEventNow);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, title: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await work();
      toast.add({ title: done, type: "success" });
      setDraft(null);
    } catch (error) {
      fail(title, error);
    } finally {
      setBusy(null);
    }
  };

  const saved = draft?.saved;
  const locked =
    saved?.status === "sent" || saved?.status === "sending" || saved?.status === "failed";
  const template = templates.find((t) => t._id === draft?.templateId);

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
      <DialogContent className="sm:max-w-lg">
        {draft && locked && saved ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {saved.title}
                <Badge variant={STATUS_VARIANT[saved.status]}>{saved.status}</Badge>
              </DialogTitle>
              <DialogDescription>
                {dayLabel(saved.date)} at {hourLabel(saved.sendHour)} ({timezone})
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Template</dt>
              <dd>{saved.templateName ?? "Removed"}</dd>
              <dt className="text-muted-foreground">Delivered</dt>
              <dd>
                {saved.status === "sending" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner /> {saved.sentCount} so far
                  </span>
                ) : (
                  `${saved.sentCount} sent${saved.failedCount ? ` · ${saved.failedCount} failed` : ""}`
                )}
              </dd>
              {saved.lastError ? (
                <>
                  <dt className="text-muted-foreground">Last error</dt>
                  <dd className="font-mono text-xs break-all text-destructive">
                    {saved.lastError}
                  </dd>
                </>
              ) : null}
            </dl>
            <DialogFooter>
              {saved.status !== "sending" ? (
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() =>
                    run("remove", "Could not remove it", () => removeEvent({ eventId: saved._id }), "Removed from the calendar")
                  }
                >
                  {busy === "remove" ? <Spinner /> : <TrashIcon />} Remove from calendar
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : draft ? (
          <>
            <DialogHeader>
              <DialogTitle>{draft.eventId ? "Edit greeting" : "Schedule a greeting"}</DialogTitle>
              <DialogDescription>
                Sent to every WhatsApp customer at the hour you pick, in {timezone}.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-title">Title</Label>
                <Input
                  id="event-title"
                  value={draft.title}
                  maxLength={80}
                  placeholder="Diwali, store anniversary, summer sale…"
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Fills <code>{"{{event}}"}</code> in the template.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="event-date">Day</Label>
                  <Input
                    id="event-date"
                    type="date"
                    value={draft.date}
                    min={today}
                    onChange={(event) =>
                      event.target.value && setDraft({ ...draft, date: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Send at</Label>
                  <SelectField
                    aria-label="Send at"
                    value={String(draft.sendHour)}
                    onValueChange={(next) => setDraft({ ...draft, sendHour: Number(next) })}
                    options={HOURS}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Template</Label>
                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No templates yet. Save this as a draft and write one on the Templates tab.
                  </p>
                ) : (
                  <SelectField
                    aria-label="Template"
                    value={draft.templateId ?? "none"}
                    onValueChange={(next) =>
                      setDraft({
                        ...draft,
                        templateId: next === "none" ? undefined : (next as Id<"marketingTemplates">),
                      })
                    }
                    options={[
                      { value: "none", label: "None yet — keep as draft" },
                      ...templates.map((t) => ({
                        value: t._id as string,
                        label: t.metaTemplateName ? t.name : `${t.name} (not linked)`,
                      })),
                    ]}
                  />
                )}
                {template ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    <p className="whitespace-pre-wrap">
                      {preview(template.body, business, draft.title || "the day")}
                    </p>
                    {!template.metaTemplateName ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
                        <WarningCircleIcon className="size-3.5" />
                        Not linked to an approved Meta template yet — link it before the day or
                        it will fail.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              <div className="flex gap-2">
                {draft.eventId ? (
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      run("remove", "Could not remove it", () => removeEvent({ eventId: draft.eventId! }), "Removed from the calendar")
                    }
                  >
                    {busy === "remove" ? <Spinner /> : <TrashIcon />} Remove
                  </Button>
                ) : null}
                {draft.eventId && draft.templateId ? (
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      run("send", "Could not send it", () => sendNow({ eventId: draft.eventId! }), "Sending now")
                    }
                  >
                    {busy === "send" ? <Spinner /> : <PaperPlaneTiltIcon />} Send now
                  </Button>
                ) : null}
              </div>
              <Button
                disabled={busy !== null || !draft.title.trim()}
                onClick={() =>
                  run(
                    "save",
                    "Could not save it",
                    () =>
                      saveEvent({
                        workspaceId: workspace._id,
                        eventId: draft.eventId,
                        title: draft.title,
                        date: draft.date,
                        sendHour: draft.sendHour,
                        templateId: draft.templateId,
                        presetKey: draft.presetKey,
                      }),
                    draft.templateId ? `${draft.title.trim()} scheduled` : "Saved as a draft"
                  )
                }
              >
                {busy === "save" ? <Spinner /> : <CalendarBlankIcon />}
                {draft.templateId ? "Schedule" : "Save draft"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type TemplateDraft = {
  templateId?: Id<"marketingTemplates">;
  name: string;
  occasion: Occasion;
  body: string;
  metaTemplateName: string;
  languageCode: string;
};

function TemplateDialog({
  draft,
  setDraft,
}: {
  draft: TemplateDraft | null;
  setDraft: (next: TemplateDraft | null) => void;
}) {
  const workspace = useWorkspace();
  const saveTemplate = useMutation(api.marketing.saveTemplate);
  const removeTemplate = useMutation(api.marketing.removeTemplate);
  const draftTemplate = useAction(api.marketingAi.draft);
  const [busy, setBusy] = useState<string | null>(null);

  if (!draft) {
    return <Dialog open={false} />;
  }

  const write = async () => {
    setBusy("write");
    try {
      const written = await draftTemplate({
        workspaceId: workspace._id,
        occasion: draft.occasion,
        eventTitle: draft.name.trim() || undefined,
        notes: draft.body.trim() || undefined,
      });
      setDraft({ ...draft, name: draft.name.trim() || written.name, body: written.body });
    } catch (error) {
      fail("The desk could not write a draft", error);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await saveTemplate({
        workspaceId: workspace._id,
        templateId: draft.templateId,
        name: draft.name,
        occasion: draft.occasion,
        body: draft.body,
        metaTemplateName: draft.metaTemplateName,
        languageCode: draft.languageCode,
      });
      toast.add({ title: `${draft.name.trim()} saved`, type: "success" });
      setDraft(null);
    } catch (error) {
      fail("Could not save the template", error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!draft.templateId) return;
    setBusy("remove");
    try {
      await removeTemplate({ templateId: draft.templateId });
      toast.add({ title: "Template deleted", type: "success" });
      setDraft(null);
    } catch (error) {
      fail("Could not delete the template", error);
    } finally {
      setBusy(null);
    }
  };

  const numbered = metaBody(draft.body.trim());

  return (
    <Dialog open onOpenChange={(open) => (open ? null : setDraft(null))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft.templateId ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            Use <code>{"{{name}}"}</code>, <code>{"{{business}}"}</code> and{" "}
            <code>{"{{event}}"}</code> — each customer gets their own.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={draft.name}
                maxLength={60}
                placeholder="Diwali wishes"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Occasion</Label>
              <SelectField
                aria-label="Occasion"
                value={draft.occasion}
                onValueChange={(next) => setDraft({ ...draft, occasion: next as Occasion })}
                options={OCCASIONS}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="template-body">Message</Label>
              <Button size="sm" variant="outline" onClick={() => void write()} disabled={busy !== null}>
                {busy === "write" ? <Spinner /> : <SparkleIcon />}
                {busy === "write" ? "Writing…" : draft.body.trim() ? "Rewrite" : "Write it for me"}
              </Button>
            </div>
            <Textarea
              id="template-body"
              value={draft.body}
              rows={5}
              maxLength={1024}
              placeholder="Happy {{event}}, {{name}}! Wishing you and your family joy and light. — {{business}}"
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Jot notes here first and “Write it for me” works from them — an offer, a
              language, a tone. The marketing desk writes it in your company’s voice.
            </p>
          </div>

          {numbered ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Submit this in WhatsApp Manager
              </p>
              <p className="font-mono text-sm whitespace-pre-wrap select-all">{numbered}</p>
              <p className="text-xs text-muted-foreground">
                Category <strong>Marketing</strong>. Keep the numbered variables in this order —
                they are filled in the same order the names appear above.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-meta">Approved name in Meta</Label>
              <Input
                id="template-meta"
                value={draft.metaTemplateName}
                placeholder="diwali_wishes"
                className="font-mono"
                onChange={(event) => setDraft({ ...draft, metaTemplateName: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Empty until Meta approves it. Nothing sends without it.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-language">Language</Label>
              <Input
                id="template-language"
                value={draft.languageCode}
                maxLength={10}
                placeholder="en"
                className="font-mono"
                onChange={(event) => setDraft({ ...draft, languageCode: event.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {draft.templateId ? (
            <Button variant="ghost" onClick={() => void remove()} disabled={busy !== null}>
              {busy === "remove" ? <Spinner /> : <TrashIcon />} Delete
            </Button>
          ) : (
            <span />
          )}
          <Button
            onClick={() => void save()}
            disabled={busy !== null || !draft.name.trim() || !draft.body.trim()}
          >
            {busy === "save" ? <Spinner /> : null} Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BirthdayDialog({
  contact,
  onClose,
}: {
  contact: { _id: Id<"contacts">; label: string; phone: string; birthday: string | null } | null;
  onClose: () => void;
}) {
  const update = useMutation(api.contacts.update);
  const [value, setValue] = useState(
    contact?.birthday ? `${contact.birthday.slice(3)}/${contact.birthday.slice(0, 2)}` : ""
  );
  const [busy, setBusy] = useState(false);

  const save = async (birthday: string) => {
    if (!contact) return;
    setBusy(true);
    try {
      await update({ contactId: contact._id, birthday });
      toast.add({
        title: birthday ? `Birthday saved for ${contact.label}` : "Birthday cleared",
        type: "success",
      });
      onClose();
    } catch (error) {
      fail("Could not save the birthday", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={contact !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{contact?.label}</DialogTitle>
          <DialogDescription>{contact?.phone}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="birthday">Birthday</Label>
          <Input
            id="birthday"
            value={value}
            autoFocus
            placeholder="25/12 or 25 December"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.trim()) void save(value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Day first. No year needed — the wish only needs the day.
          </p>
        </div>
        <DialogFooter>
          {contact?.birthday ? (
            <Button variant="ghost" onClick={() => void save("")} disabled={busy}>
              Clear
            </Button>
          ) : null}
          <Button onClick={() => void save(value)} disabled={busy || !value.trim()}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------- birthdays

/**
 * The standing birthday wish. Keyed on the saved settings by its parent, so
 * the form starts from what is stored and a save elsewhere resets it — no
 * effect copying the query into state.
 */
function BirthdaySettings({
  settings,
  templates,
  timezone,
  withBirthday,
}: {
  settings: {
    birthdayEnabled: boolean;
    birthdayTemplateId: Id<"marketingTemplates"> | null;
    birthdayHour: number;
    lastBirthdayRun: string | null;
  };
  templates: Template[];
  timezone: string;
  withBirthday: number;
}) {
  const workspace = useWorkspace();
  const saveSettings = useMutation(api.marketing.saveSettings);
  const [enabled, setEnabled] = useState(settings.birthdayEnabled);
  const [templateId, setTemplateId] = useState<string>(
    settings.birthdayTemplateId ??
      templates.find((t) => t.occasion === "birthday")?._id ??
      ""
  );
  const [hour, setHour] = useState(settings.birthdayHour);
  const [busy, setBusy] = useState(false);

  const dirty =
    enabled !== settings.birthdayEnabled ||
    templateId !== (settings.birthdayTemplateId ?? "") ||
    hour !== settings.birthdayHour;
  const chosen = templates.find((t) => t._id === templateId);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({
        workspaceId: workspace._id,
        birthdayEnabled: enabled,
        birthdayTemplateId: templateId ? (templateId as Id<"marketingTemplates">) : undefined,
        birthdayHour: hour,
      });
      toast.add({
        title: enabled ? "Birthday wishes are on" : "Birthday wishes are off",
        type: "success",
      });
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GiftIcon className="size-5 text-pink-600 dark:text-pink-400" />
          Birthday wishes
        </CardTitle>
        <CardDescription>
          Every customer whose birthday is today gets this, once, at the hour you pick.{" "}
          {withBirthday} {withBirthday === 1 ? "customer has" : "customers have"} a birthday on
          file.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          {enabled ? "On" : "Off"}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <SelectField
              aria-label="Birthday template"
              value={templateId}
              placeholder="Pick a template"
              onValueChange={setTemplateId}
              options={templates.map((t) => ({
                value: t._id as string,
                label: t.metaTemplateName ? t.name : `${t.name} (not linked)`,
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Send at ({timezone})</Label>
            <SelectField
              aria-label="Send birthday wishes at"
              value={String(hour)}
              onValueChange={(next) => setHour(Number(next))}
              options={HOURS}
            />
          </div>
        </div>

        {chosen && !chosen.metaTemplateName ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <WarningCircleIcon className="size-3.5" />
            “{chosen.name}” is not linked to an approved Meta template, so the wishes will not
            send until it is.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {settings.lastBirthdayRun
              ? `Last sent on ${dayLabel(settings.lastBirthdayRun)}.`
              : "Not sent yet."}
          </p>
          <Button onClick={() => void save()} disabled={busy || !dirty || (enabled && !templateId)}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------- page

export default function MarketingPage() {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const timezone = workspace.timezone;
  const today = localDate(now, timezone);

  const [tab, setTab] = useState("calendar");
  const [cursor, setCursor] = useState(() => {
    const { year, month } = parts(today);
    return { year, month };
  });
  const [selected, setSelected] = useState(today);
  const [search, setSearch] = useState("");

  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [birthdayContact, setBirthdayContact] = useState<{
    _id: Id<"contacts">;
    label: string;
    phone: string;
    birthday: string | null;
  } | null>(null);

  const from = ymd(cursor.year, cursor.month, 1);
  const to = ymd(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));

  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const calendar = useQuery(api.marketing.calendar, {
    workspaceId: workspace._id,
    from,
    to,
  });
  const upcoming = useQuery(api.marketing.upcomingFestivals, {
    workspaceId: workspace._id,
    today,
    days: 120,
  });
  const contacts = useQuery(
    api.marketing.contacts,
    tab === "birthdays"
      ? { workspaceId: workspace._id, search: search.trim() || undefined }
      : "skip"
  );
  const ensureDesk = useMutation(api.marketing.ensureDesk);
  const [creatingDesk, setCreatingDesk] = useState(false);

  const templates = useMemo(() => overview?.templates ?? [], [overview]);

  const byDay = useMemo(() => {
    const map = new Map<string, DayInfo>();
    const slot = (date: string) => {
      const found = map.get(date) ?? { events: [], birthdays: [], festivals: [] };
      map.set(date, found);
      return found;
    };
    for (const event of calendar?.events ?? []) slot(event.date).events.push(event);
    for (const row of calendar?.birthdays ?? []) {
      slot(`${cursor.year}-${row.birthday}`).birthdays.push(row);
    }
    for (const festival of calendar?.festivals ?? []) slot(festival.date).festivals.push(festival);
    return map;
  }, [calendar, cursor.year]);

  // ------------------------------------------------------------ openers

  const moveMonth = (by: number) => {
    const index = cursor.year * 12 + (cursor.month - 1) + by;
    const next = { year: Math.floor(index / 12), month: (index % 12) + 1 };
    setCursor(next);
    const first = ymd(next.year, next.month, 1);
    setSelected(today.slice(0, 7) === first.slice(0, 7) ? today : first);
  };

  const goToday = () => {
    const { year, month } = parts(today);
    setCursor({ year, month });
    setSelected(today);
  };

  /** A linked template for the occasion when there is one, so a new entry is usually ready to save. */
  const defaultTemplate = (occasion: Occasion) =>
    templates.find((t) => t.occasion === occasion && t.metaTemplateName)?._id ??
    templates.find((t) => t.occasion === occasion)?._id;

  const newEvent = (date: string, title = "", presetKey?: string) =>
    setEventDraft({
      title,
      date: date < today ? today : date,
      sendHour: 9,
      presetKey,
      templateId: defaultTemplate(presetKey ? "festival" : "offer"),
    });

  const openEvent = (event: CalendarEvent) =>
    setEventDraft({
      eventId: event._id,
      title: event.title,
      date: event.date,
      sendHour: event.sendHour,
      templateId: event.templateId,
      presetKey: event.presetKey,
      saved: event,
    });

  const newFromFestival = (festival: Festival) =>
    newEvent(festival.date, festival.name, festival.key);

  const openTemplate = (template?: Template) =>
    setTemplateDraft(
      template
        ? {
            templateId: template._id,
            name: template.name,
            occasion: template.occasion,
            body: template.body,
            metaTemplateName: template.metaTemplateName ?? "",
            languageCode: template.languageCode,
          }
        : { name: "", occasion: "festival", body: "", metaTemplateName: "", languageCode: "en" }
    );

  const unlinked = templates.filter((t) => !t.metaTemplateName).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Marketing</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Birthday wishes and festival greetings, sent on schedule by the marketing desk as
            approved WhatsApp templates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openTemplate()}>
            <PlusIcon /> New template
          </Button>
          <Button onClick={() => newEvent(selected)}>
            <CalendarBlankIcon /> Schedule greeting
          </Button>
        </div>
      </header>

      {/* ---------------------------------------------------------- the desk */}
      {overview === undefined ? (
        <TableSkeleton rows={1} columns={3} />
      ) : overview ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <AgentAvatar name={overview.desk?.botName ?? workspace.name} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Marketing desk</p>
            <p className="text-xs text-muted-foreground">
              {overview.channel ? (
                <>
                  <WhatsappLogoIcon className="mr-1 inline size-3.5 align-[-2px]" />
                  Sends from {overview.channel.phone ?? overview.channel.name} to{" "}
                  {overview.audience.whatsapp}
                  {overview.audience.capped ? "+" : ""} WhatsApp customers
                </>
              ) : (
                "No WhatsApp number connected — nothing can send until one is."
              )}
            </p>
          </div>
          {overview.desk ? (
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/w/${workspace.slug}/agents/${overview.desk._id}`} />}
            >
              Tone and rules
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={creatingDesk}
              onClick={async () => {
                setCreatingDesk(true);
                try {
                  await ensureDesk({ workspaceId: workspace._id });
                } catch (error) {
                  fail("Could not set up the desk", error);
                } finally {
                  setCreatingDesk(false);
                }
              }}
            >
              {creatingDesk ? <Spinner /> : <SparkleIcon />} Set up the desk
            </Button>
          )}
        </div>
      ) : null}

      {overview && !overview.channel ? (
        <Alert>
          <WarningCircleIcon />
          <AlertTitle>Connect WhatsApp first</AlertTitle>
          <AlertDescription>
            Greetings go out from the workspace’s WhatsApp number. Add one under{" "}
            <Link className="underline" href={`/w/${workspace.slug}/channels`}>
              Channels
            </Link>{" "}
            and anything scheduled here will send from it.
          </AlertDescription>
        </Alert>
      ) : null}

      <Separator />

      <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
        <TabsList>
          <TabsTrigger value="calendar">
            <CalendarBlankIcon /> Calendar
          </TabsTrigger>
          <TabsTrigger value="templates">
            <MegaphoneIcon /> Templates
            {unlinked > 0 ? (
              <Badge variant="outline" className="ml-1">
                {unlinked} to link
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="birthdays">
            <GiftIcon /> Birthdays
          </TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------- calendar */}
        <TabsContent value="calendar" className="pt-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => moveMonth(-1)}>
                  <CaretLeftIcon />
                </Button>
                <Button size="icon" variant="outline" aria-label="Next month" onClick={() => moveMonth(1)}>
                  <CaretRightIcon />
                </Button>
                <h2 className="ml-1 text-lg font-semibold">{monthLabel(cursor.year, cursor.month)}</h2>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={goToday}>
                  Today
                </Button>
              </div>

              {calendar === undefined ? (
                <TableSkeleton rows={5} columns={7} />
              ) : (
                <MonthGrid
                  year={cursor.year}
                  month={cursor.month}
                  today={today}
                  selected={selected}
                  byDay={byDay}
                  onSelect={setSelected}
                  onEvent={openEvent}
                  onFestival={newFromFestival}
                />
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary" /> Scheduled
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-muted-foreground/50" /> Sent
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-pink-600 dark:bg-pink-400" /> Birthday
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full border border-primary" /> Festival you can
                  schedule
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <DayPanel
                date={selected}
                today={today}
                info={byDay.get(selected)}
                onEvent={openEvent}
                onNew={() => newEvent(selected)}
                onFestival={newFromFestival}
              />

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Festivals coming up</CardTitle>
                  <CardDescription>
                    The next four months. Dates of lunar festivals can shift a day by region —
                    check before scheduling.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {upcoming === undefined ? (
                    <Spinner />
                  ) : upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Every festival in the next four months is on your calendar.
                    </p>
                  ) : (
                    upcoming.slice(0, 8).map((festival) => (
                      <button
                        key={`${festival.key}-${festival.date}`}
                        type="button"
                        onClick={() => newFromFestival(festival)}
                        className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDate(festival.date, { day: "numeric", month: "short" })}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{festival.name}</span>
                        <PlusIcon className="size-4 text-muted-foreground group-hover:text-primary" />
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* -------------------------------------------------------- templates */}
        <TabsContent value="templates" className="flex flex-col gap-4 pt-4">
          {unlinked > 0 ? (
            <Alert>
              <WhatsappLogoIcon />
              <AlertTitle>
                {unlinked === 1 ? "1 template is" : `${unlinked} templates are`} not linked to Meta
              </AlertTitle>
              <AlertDescription>
                WhatsApp only delivers marketing messages as templates Meta has approved. Open a
                template, submit the numbered text it shows in WhatsApp Manager, then paste back
                the name it was approved under. Until then it cannot send.
              </AlertDescription>
            </Alert>
          ) : null}

          {overview === undefined ? (
            <TableSkeleton rows={3} columns={3} />
          ) : templates.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MegaphoneIcon />
                </EmptyMedia>
                <EmptyTitle>No templates yet</EmptyTitle>
                <EmptyDescription>
                  Write a birthday wish or a festival greeting — or let the marketing desk draft
                  one in your company’s voice.
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={() => openTemplate()}>
                <PlusIcon /> New template
              </Button>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((template) => (
                <button
                  key={template._id}
                  type="button"
                  onClick={() => openTemplate(template)}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{template.name}</span>
                    <Badge variant="outline">{template.occasion}</Badge>
                    {template.metaTemplateName ? (
                      <Badge>linked</Badge>
                    ) : (
                      <Badge variant="secondary">not linked</Badge>
                    )}
                  </span>
                  <span className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
                    {template.body}
                  </span>
                  {template.metaTemplateName ? (
                    <span className="mt-auto flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <WhatsappLogoIcon className="size-3.5" />
                      {template.metaTemplateName} · {template.languageCode}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* -------------------------------------------------------- birthdays */}
        <TabsContent value="birthdays" className="flex flex-col gap-4 pt-4">
          {overview ? (
            <BirthdaySettings
              key={JSON.stringify(overview.settings)}
              settings={overview.settings}
              templates={templates}
              timezone={timezone}
              withBirthday={overview.audience.withBirthday}
            />
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Customers</h2>
              <p className="text-sm text-muted-foreground">
                Agents save a birthday when a customer mentions it. Add the rest here.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                placeholder="Search name or number"
                className="pl-8"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          {contacts === undefined ? (
            <TableSkeleton rows={6} columns={3} />
          ) : contacts.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WhatsappLogoIcon />
                </EmptyMedia>
                <EmptyTitle>{search ? "Nobody matches" : "No WhatsApp customers yet"}</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? "No customer has that name or number."
                    : "Everyone who messages you on WhatsApp appears here."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden sm:table-cell">Number</TableHead>
                    <TableHead>Birthday</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact._id}>
                      <TableCell className="font-medium">{contact.label}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                        {contact.phone}
                      </TableCell>
                      <TableCell>
                        {contact.birthday ? (
                          <span className="inline-flex items-center gap-1.5">
                            <GiftIcon className="size-4 text-pink-600 dark:text-pink-400" />
                            {birthdayLabel(contact.birthday)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setBirthdayContact(contact)}>
                          {contact.birthday ? "Edit" : "Add"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <EventDialog
        draft={eventDraft}
        setDraft={setEventDraft}
        templates={templates}
        today={today}
        timezone={timezone}
        business={workspace.name}
      />
      <TemplateDialog draft={templateDraft} setDraft={setTemplateDraft} />
      {/* Keyed on the contact so its field starts from their birthday. */}
      <BirthdayDialog
        key={birthdayContact?._id ?? "none"}
        contact={birthdayContact}
        onClose={() => setBirthdayContact(null)}
      />
    </div>
  );
}
