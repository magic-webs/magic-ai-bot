"use client";

import { useState } from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatMoney } from "@/convex/lib/billing";
import { failureCode, failureLabel } from "@/convex/lib/metaErrors";
import { RankedBars, StatTile } from "@/components/dashboard-charts";
import { STATUS_VARIANT, dayLabel, hourLabel } from "@/components/marketing/format";
import { fail, formatPhone, plural } from "@/components/marketing/audience/shared";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  CopyIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

type Outcome = "all" | "delivered" | "read" | "replied" | "clicked" | "failed" | "not_read" | "optedOut";

const OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: "all", label: "Everyone sent to" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "not_read", label: "Delivered, not read" },
  { value: "replied", label: "Replied" },
  { value: "clicked", label: "Clicked a link" },
  { value: "failed", label: "Failed" },
  { value: "optedOut", label: "Unsubscribed after" },
];

const READ_CHART: ChartConfig = { reads: { label: "Reads", color: "var(--viz-series)" } };

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

function time(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function ReportDialog({
  eventId,
  onClose,
  onDuplicate,
}: {
  eventId: Id<"marketingEvents">;
  onClose: () => void;
  onDuplicate: () => void;
}) {
  const now = useHourBucket();
  const campaign = useQuery(api.marketingBroadcasts.get, { eventId });
  const report = useQuery(api.marketingBroadcasts.report, { eventId, now });
  const pause = useMutation(api.marketingBroadcasts.pause);
  const resume = useMutation(api.marketingBroadcasts.resume);
  const cancel = useMutation(api.marketingBroadcasts.cancel);
  const [busy, setBusy] = useState(false);

  const act = async (task: () => Promise<unknown>, title: string) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      fail(title, error);
    } finally {
      setBusy(false);
    }
  };

  const stats = report?.stats;
  const sent = stats ? stats.sent : 0;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {campaign?.title ?? "Campaign"}
            {campaign ? <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            {campaign
              ? `${campaign.template?.name ?? "No template"} · ${
                  campaign.startedAt ? `started ${time(campaign.startedAt)}` : `${dayLabel(campaign.date)} at ${hourLabel(campaign.sendHour)}`
                }${campaign.audiences.length ? ` · ${campaign.audiences.map((a) => a.name).join(", ")}` : ""}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {!report || !stats ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : (
            <>
              {campaign?.lastError ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{campaign.lastError}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <StatTile label="Sent" value={sent} previous={null} />
                <StatTile label="Delivered" value={pct(stats.delivered, sent)} previous={null} suffix="%" />
                <StatTile label="Read" value={pct(stats.read, sent)} previous={null} suffix="%" />
                <StatTile label="Replied" value={pct(stats.replied, sent)} previous={null} suffix="%" />
                <StatTile label="Clicked" value={pct(stats.clicked, sent)} previous={null} suffix="%" />
                <StatTile label="Orders and bookings" value={stats.converted} previous={null} />
                <StatTile label="Failed" value={stats.failed} previous={null} lowerIsBetter />
                <StatTile label="Unsubscribed" value={stats.optedOut} previous={null} lowerIsBetter />
                <StatTile
                  label="Cost"
                  value={report.currency ? report.costMicros : null}
                  previous={null}
                  format={(value) => formatMoney(value, report.currency ?? "USD")}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
                  <p className="text-sm font-semibold">From send to reply</p>
                  <RankedBars
                    data={[
                      { step: "Sent", value: sent },
                      { step: "Delivered", value: stats.delivered },
                      { step: "Read", value: stats.read },
                      { step: "Replied", value: stats.replied },
                      { step: "Clicked", value: stats.clicked },
                      { step: "Ordered or booked", value: stats.converted },
                    ]}
                    categoryKey="step"
                    valueKey="value"
                    valueLabel="People"
                    emptyLabel="Nothing has gone out yet."
                    formatValue={(value) => `${value.toLocaleString()}${sent ? ` · ${pct(value, sent)}%` : ""}`}
                  />
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
                  <p className="text-sm font-semibold">When people read it</p>
                  {stats.read === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">No reads yet.</p>
                  ) : (
                    <ChartContainer config={READ_CHART} className="h-44 w-full">
                      <BarChart
                        data={report.readHours.map((reads, hour) => ({
                          hour: hour === 24 ? "24h+" : `${hour}h`,
                          reads,
                        }))}
                        margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} strokeOpacity={0.4} />
                        <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={3} fontSize={11} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} fontSize={11} />
                        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(label) => `${label} after sending`} />} />
                        <Bar dataKey="reads" fill="var(--color-reads)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  )}
                  <p className="text-xs text-muted-foreground">Hours between sending and the blue ticks.</p>
                </div>
              </div>

              {report.reasons.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
                  <p className="text-sm font-semibold">Why some did not arrive</p>
                  <RankedBars
                    data={report.reasons.map((row) => ({ reason: failureLabel(row.code), count: row.count }))}
                    categoryKey="reason"
                    valueKey="count"
                    valueLabel="Failures"
                    emptyLabel="No failures."
                  />
                </div>
              ) : null}

              <Recipients eventId={eventId} title={campaign?.title ?? "campaign"} />
            </>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          {campaign && (campaign.status === "sending" || campaign.status === "scheduled") ? (
            <Button variant="outline" disabled={busy} onClick={() => void act(() => pause({ eventId }), "Could not pause")}>
              <PauseIcon /> Pause
            </Button>
          ) : null}
          {campaign?.status === "paused" ? (
            <Button variant="outline" disabled={busy} onClick={() => void act(() => resume({ eventId }), "Could not resume")}>
              <PlayIcon /> Resume
            </Button>
          ) : null}
          {campaign && ["sending", "scheduled", "paused"].includes(campaign.status) ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await cancel({ eventId });
                  toast.add({ title: result.deleted ? "Campaign removed" : "Campaign stopped" });
                  if (result.deleted) onClose();
                }, "Could not stop it")
              }
            >
              <StopIcon /> {campaign.startedAt ? "Stop sending" : "Delete"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onDuplicate}>
            <CopyIcon /> Duplicate
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Recipients({ eventId, title }: { eventId: Id<"marketingEvents">; title: string }) {
  const convex = useConvex();
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [listName, setListName] = useState("");
  const [exporting, setExporting] = useState(false);
  const retarget = useMutation(api.marketingBroadcasts.retarget);
  const { results, status, loadMore } = usePaginatedQuery(
    api.marketingBroadcasts.recipients,
    { eventId, outcome },
    { initialNumItems: 50 }
  );
  const label = OUTCOMES.find((row) => row.value === outcome)?.label ?? "";

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: string[][] = [["name", "phone", "status", "sent", "delivered", "read", "replied", "clicked", "reason"]];
      let cursor: string | null = null;
      for (;;) {
        const page: FunctionReturnType<typeof api.marketingBroadcasts.recipients> =
          await convex.query(api.marketingBroadcasts.recipients, {
            eventId,
            outcome,
            paginationOpts: { numItems: 500, cursor },
          });
        for (const row of page.page) {
          rows.push([
            row.name ?? "",
            formatPhone(row.phone),
            row.delivery ?? row.status,
            time(row.sentAt),
            time(row.deliveredAt),
            time(row.readAt),
            time(row.repliedAt),
            time(row.clickedAt),
            row.error ? failureLabel(failureCode(row.error)) : "",
          ]);
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      downloadCsv(`${title.replace(/[^\w]+/g, "-").toLowerCase()}-recipients.csv`, toCsv(rows));
    } catch (error) {
      fail("Could not export", error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold">Recipients</p>
        <SelectField
          aria-label="Show"
          className="w-52"
          value={outcome}
          onValueChange={(value) => setOutcome(value as Outcome)}
          options={OUTCOMES}
        />
        <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportCsv()}>
          {exporting ? <Spinner /> : <DownloadSimpleIcon />} Export
        </Button>
      </div>
      {outcome !== "all" ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await retarget({ eventId, outcome, name: listName || `${title} — ${label}` });
              toast.add({ title: "List created", description: "Find it under Audience → Lists.", type: "success" });
              setListName("");
            } catch (error) {
              fail("Could not create the list", error);
            }
          }}
        >
          <UsersThreeIcon className="size-4 text-muted-foreground" />
          <span>Follow up with everyone here:</span>
          <Input
            className="h-7 w-56"
            value={listName}
            placeholder={`${title} — ${label}`}
            onChange={(e) => setListName(e.target.value)}
          />
          <Button size="sm" type="submit" variant="outline">
            Save as a list
          </Button>
        </form>
      ) : null}
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Read</TableHead>
              <TableHead className="hidden md:table-cell">Replied</TableHead>
              <TableHead className="hidden lg:table-cell">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((row) => (
              <TableRow key={row._id}>
                <TableCell>
                  <p className="font-medium">{row.name ?? "No name"}</p>
                  <p className="font-mono text-xs text-muted-foreground">{formatPhone(row.phone)}</p>
                </TableCell>
                <TableCell>
                  <Badge variant={row.status === "failed" || row.delivery === "failed" ? "destructive" : "secondary"}>
                    {row.repliedAt ? "replied" : row.delivery ?? row.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-xs md:table-cell">{time(row.readAt)}</TableCell>
                <TableCell className="hidden text-xs md:table-cell">{time(row.repliedAt)}</TableCell>
                <TableCell className="hidden max-w-60 truncate text-xs text-muted-foreground lg:table-cell">
                  {row.error ? failureLabel(failureCode(row.error)) : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {status === "LoadingFirstPage" ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nobody here {status === "CanLoadMore" ? "on this page" : "yet"}.</p>
        ) : null}
        {status === "CanLoadMore" ? (
          <div className="flex justify-center border-t border-border p-2">
            <Button size="sm" variant="ghost" onClick={() => loadMore(100)}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{plural(results.length, "row")} shown.</p>
    </div>
  );
}
