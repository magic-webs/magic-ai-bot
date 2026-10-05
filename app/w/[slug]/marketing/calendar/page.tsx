"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import {
  DayPanel,
  EventDialog,
  MonthGrid,
  daysInMonth,
  localDate,
  monthLabel,
  ymd,
  type CalendarEvent,
  type DayInfo,
  type EventDraft,
  type Festival,
  type Occasion,
} from "@/components/marketing/calendar";
import { TouchDialog } from "@/components/marketing/events";
import { formatDate, parts, templateReady } from "@/components/marketing/format";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react";

export default function MarketingCalendarPage() {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const timezone = workspace.timezone;
  const today = localDate(now, timezone);

  const [cursor, setCursor] = useState(() => {
    const { year, month } = parts(today);
    return { year, month };
  });
  const [selected, setSelected] = useState(today);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [touchId, setTouchId] = useState<Id<"marketingEvents"> | null>(null);

  const from = ymd(cursor.year, cursor.month, 1);
  const to = ymd(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));

  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const calendar = useQuery(api.marketing.calendar, { workspaceId: workspace._id, from, to });
  const upcoming = useQuery(api.marketing.upcomingFestivals, {
    workspaceId: workspace._id,
    today,
    days: 120,
  });
  const campaigns = useQuery(api.marketingCampaigns.list, { workspaceId: workspace._id });
  const openCampaign = touchId
    ? (campaigns ?? []).find((c) => c.touches.some((t) => t._id === touchId))
    : undefined;
  const openTouch = openCampaign?.touches.find((t) => t._id === touchId);
  const templates = useMemo(() => overview?.templates ?? [], [overview]);

  const byDay = useMemo(() => {
    const map = new Map<string, DayInfo>();
    const slot = (date: string) => {
      const found = map.get(date) ?? { events: [], birthdays: [], festivals: [] };
      map.set(date, found);
      return found;
    };
    for (const event of calendar?.events ?? []) slot(event.date).events.push(event);
    for (const row of calendar?.birthdays ?? []) slot(`${cursor.year}-${row.birthday}`).birthdays.push(row);
    for (const festival of calendar?.festivals ?? []) slot(festival.date).festivals.push(festival);
    return map;
  }, [calendar, cursor.year]);

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

  const defaultTemplate = (occasion: Occasion) =>
    templates.find((t) => t.occasion === occasion && templateReady(t))?._id ??
    templates.find((t) => t.occasion === occasion)?._id;

  const newEvent = (date: string, title = "", presetKey?: string) =>
    setEventDraft({
      title,
      date: date < today ? today : date,
      sendHour: 9,
      presetKey,
      templateId: defaultTemplate(presetKey ? "festival" : "offer"),
    });

  const openEvent = (event: CalendarEvent) => {
    if (event.campaignId) {
      setTouchId(event._id);
      return;
    }
    setEventDraft({
      eventId: event._id,
      title: event.title,
      date: event.date,
      sendHour: event.sendHour,
      templateId: event.templateId,
      presetKey: event.presetKey,
      saved: event,
    });
  };

  const newFromFestival = (festival: Festival) => newEvent(festival.date, festival.name, festival.key);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Calendar</h2>
          <p className="text-sm text-muted-foreground">
            Festival greetings, one-off sends, event reminders and birthdays, by day.
          </p>
        </div>
        <Button onClick={() => newEvent(selected)}>
          <CalendarBlankIcon /> Schedule greeting
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => moveMonth(-1)}>
              <CaretLeftIcon />
            </Button>
            <Button size="icon" variant="outline" aria-label="Next month" onClick={() => moveMonth(1)}>
              <CaretRightIcon />
            </Button>
            <h3 className="ml-1 text-lg font-semibold">{monthLabel(cursor.year, cursor.month)}</h3>
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
              <span className="size-2 rounded-full border border-primary" /> Festival you can schedule
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
                The next four months. Dates of lunar festivals can shift a day by region — check
                before scheduling.
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

      <EventDialog
        draft={eventDraft}
        setDraft={setEventDraft}
        templates={templates}
        today={today}
        timezone={timezone}
        business={workspace.name}
      />
      <TouchDialog
        key={`touch:${touchId ?? "none"}`}
        campaign={openCampaign ?? null}
        touch={openTouch ?? null}
        templates={templates}
        onClose={() => setTouchId(null)}
      />
    </div>
  );
}
