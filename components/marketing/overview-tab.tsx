"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatMoney } from "@/convex/lib/billing";
import { ActivityChart, StatTile } from "@/components/dashboard-charts";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BroomIcon, CalendarCheckIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export function OverviewTab({ onGo }: { onGo: (tab: string) => void }) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const [days, setDays] = useState("30");
  const data = useQuery(api.marketingOverview.summary, {
    workspaceId: workspace._id,
    days: Number(days),
    now,
  });

  if (!data) return <TableSkeleton rows={6} columns={4} />;
  const { totals, previous, series } = data;
  const rateSeries = series.map((row) => ({
    date: row.date,
    sent: row.sent,
    readRate: row.sent ? Math.round((row.read / row.sent) * 100) : null,
    replyRate: row.sent ? Math.round((row.replied / row.sent) * 100) : null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground">
            How your WhatsApp marketing is landing, across every campaign, event and greeting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectField aria-label="Period" className="w-40" value={days} onValueChange={setDays} options={PERIODS} />
          <Button variant="outline" onClick={() => onGo("audience")}>
            <BroomIcon /> Import contacts
          </Button>
          <Button variant="outline" onClick={() => onGo("events")}>
            <CalendarCheckIcon /> New event
          </Button>
          <Button onClick={() => onGo("campaigns")}>
            <PaperPlaneTiltIcon /> New campaign
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Messages sent" value={totals.sent} previous={previous.sent} data={series} dataKey="sent" />
        <StatTile
          label="Delivered"
          value={pct(totals.delivered, totals.sent)}
          previous={pct(previous.delivered, previous.sent)}
          suffix="%"
        />
        <StatTile
          label="Read"
          value={pct(totals.read, totals.sent)}
          previous={pct(previous.read, previous.sent)}
          suffix="%"
          data={rateSeries}
          dataKey="readRate"
        />
        <StatTile
          label="Replied"
          value={pct(totals.replied, totals.sent)}
          previous={pct(previous.replied, previous.sent)}
          suffix="%"
          data={rateSeries}
          dataKey="replyRate"
        />
        <StatTile label="Link clicks" value={totals.clicked} previous={previous.clicked} data={series} dataKey="clicked" />
        <StatTile label="Orders and bookings" value={totals.converted} previous={previous.converted} data={series} dataKey="converted" />
        <StatTile
          label="Unsubscribed"
          value={totals.optedOut}
          previous={previous.optedOut}
          lowerIsBetter
        />
        <StatTile
          label="Spent on campaigns"
          value={data.spend.currency ? data.spend.micros : null}
          previous={null}
          format={(value) => formatMoney(value, data.spend.currency ?? "USD", workspace.locale)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Messages sent each day</p>
          <ActivityChart
            data={series}
            windowDays={data.days}
            series={{ key: "sent", label: "Sent" }}
            columns={[
              { key: "sent", label: "Sent" },
              { key: "delivered", label: "Delivered" },
              { key: "read", label: "Read" },
              { key: "replied", label: "Replied" },
              { key: "clicked", label: "Clicked" },
              { key: "failed", label: "Failed" },
            ]}
            noun="messages"
            emptyLabel="Nothing sent in this period."
          />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">Audience</p>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Can be messaged</dt>
              <dd className="font-medium tabular-nums">
                {data.audience.reachable.toLocaleString()}
                {data.audience.partial ? "+" : ""}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">New in this period</dt>
              <dd className="tabular-nums">{data.audience.newContacts.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Unsubscribed in this period</dt>
              <dd className="tabular-nums">{data.audience.newOptOuts.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Unsubscribed in all</dt>
              <dd className="tabular-nums">{data.audience.optedOut.toLocaleString()}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            An unsubscribe rate above 2% of a send usually means the message reached people who
            didn&apos;t expect it — check who it went to.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">What went out</p>
        {data.campaigns.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No campaigns or reminders went out in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Read</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Replied</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Clicked</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.campaigns.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell>
                      <span className="font-medium">{row.title}</span>
                      {row.isReminder ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          event
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.stats.sent.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(row.stats.read, row.stats.sent) ?? "—"}%</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {pct(row.stats.replied, row.stats.sent) ?? "—"}%
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{row.stats.clicked}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{row.stats.converted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
