"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { templateBlocker } from "@/convex/lib/marketing";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  HOURS,
  STATUS_VARIANT,
  type EventStatus,
  dayLabel,
  formatDate,
  hourLabel,
  pad,
  parts,
  previewTemplate,
  templateOptionLabel,
  templateReady,
} from "@/components/marketing/format";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
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
import { TestSendButton } from "@/components/marketing/test-send";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/convex-server";
import { cn } from "@/lib/utils";
import {
  CalendarBlankIcon,
  GiftIcon,
  MegaphoneIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";


export type Template = Doc<"marketingTemplates"> & { metaBody: string };
export type Occasion = Doc<"marketingTemplates">["occasion"];
export type CalendarEvent = Doc<"marketingEvents"> & { templateName: string | null };
export type Festival = { key: string; name: string; date: string };

/** The chip a greeting gets inside a calendar cell. */
const STATUS_CHIP: Record<EventStatus, string> = {
  draft: "border border-dashed border-border text-muted-foreground",
  scheduled: "bg-primary text-primary-foreground",
  sending: "bg-primary/80 text-primary-foreground",
  sent: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
  paused: "border border-border text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ------------------------------------------------------------------- dates

// Workspace-local "YYYY-MM-DD" throughout — see components/marketing/format.

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function localDate(instant: number, timeZone: string): string {
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

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The month as weeks of seven, Sunday first, blank either side. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    cells.push(ymd(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const monthLabel = (year: number, month: number) =>
  formatDate(ymd(year, month, 1), { month: "long", year: "numeric" });

/** "MM-DD" as "12 Mar". */
export function fail(title: string, error: unknown) {
  toast.add({ title, description: errorMessage(error), type: "error" });
}

// ---------------------------------------------------------------- calendar

export type DayInfo = {
  events: CalendarEvent[];
  birthdays: { contactId: Id<"contacts">; name: string }[];
  festivals: (Festival & { added: boolean })[];
};

export function MonthGrid({
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

export function DayPanel({
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

export type EventDraft = {
  eventId?: Id<"marketingEvents">;
  title: string;
  date: string;
  sendHour: number;
  templateId?: Id<"marketingTemplates">;
  presetKey?: string;
  saved?: CalendarEvent;
};

export function EventDialog({
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
                        label: templateOptionLabel(t),
                      })),
                    ]}
                  />
                )}
                {template ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    <p className="whitespace-pre-wrap">
                      {previewTemplate(template.body, {
                        business,
                        event: draft.title,
                        date: formatDate(draft.date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        }),
                      })}
                    </p>
                    {!templateReady(template) ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
                        <WarningCircleIcon className="size-3.5 shrink-0" />
                        {templateBlocker(template)} It will fail on the day unless it is
                        approved first.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              <div className="flex flex-wrap gap-2">
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
                {draft.eventId && saved?.templateId ? (
                  <TestSendButton
                    eventId={draft.eventId}
                    disabledReason={
                      draft.title.trim() !== saved.title ||
                      draft.templateId !== saved.templateId ||
                      draft.date !== saved.date
                        ? "Save the change first — the test sends what is saved."
                        : template
                          ? templateBlocker(template)
                          : null
                    }
                  />
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
