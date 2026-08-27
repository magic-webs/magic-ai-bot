"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ChartLineIcon, TableIcon } from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// Palette.
//
// The workspace design system ships one viz ramp (--chart-1…5), which is five
// steps of a single teal hue — a sequential ramp, not a categorical palette.
// So every chart here encodes magnitude with one hue and lets length or
// position carry the comparison; nothing needs a second series colour.
//
// Steps are chosen per mode rather than flipped: on white, --chart-1 measures
// 1.52:1 and fails the 2:1 ordinal floor, so light mode starts one step darker.
// Validated with the dataviz palette validator in --ordinal mode against the
// real card surfaces (#ffffff / #1d1d16) — all checks pass in both modes.
//
// The per-mode step lives in globals.css as --viz-series/--viz-series-alt, under
// :root and .dark. Referencing the token (not a hex pair, and not CSS
// light-dark(), which follows color-scheme — a declaration this app never makes)
// keeps the charts on the same class-based dark mode as the rest of the UI.
// ---------------------------------------------------------------------------

const SERIES = "var(--viz-series)"; // light --chart-2 / dark --chart-1
const SERIES_ALT = "var(--viz-series-alt)"; // light --chart-4 / dark --chart-3

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function NoData({ label }: { label: string }) {
  return (
    <Empty className="min-h-40 border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ChartLineIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing to plot yet</EmptyTitle>
        <EmptyDescription>{label}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Sparkline for a stat tile. No axes, no grid — it is a shape, not a plot,
// so the tile's value carries the number and this carries the direction.
// ---------------------------------------------------------------------------

export function Sparkline({
  data,
  dataKey,
  label,
}: {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  label: string;
}) {
  const config = {
    [dataKey]: { label, color: SERIES },
  } satisfies ChartConfig;

  // One data point cannot draw a line — render the point itself so the tile
  // does not look broken on a workspace with a single day of activity.
  const plotted = data.filter(
    (row) => row[dataKey] !== null && row[dataKey] !== undefined
  ).length;

  return (
    <ChartContainer
      config={config}
      className="h-10 w-full"
      aria-label={`${label} trend`}
    >
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            {/* Area fill is a ~10% wash of the series hue, never a block. */}
            <stop
              offset="0%"
              stopColor={`var(--color-${dataKey})`}
              stopOpacity={0.18}
            />
            <stop
              offset="100%"
              stopColor={`var(--color-${dataKey})`}
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <Area
          dataKey={dataKey}
          type="monotone"
          stroke={`var(--color-${dataKey})`}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={`url(#spark-${dataKey})`}
          dot={
            plotted === 1
              ? { r: 3, strokeWidth: 0, fill: `var(--color-${dataKey})` }
              : false
          }
          // Quiet days are gaps, not zeros — a missing reply time is unknown.
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Activity over time. One series, so no legend — the card title names it.
// Ships a table view so no value is reachable only by hovering.
// ---------------------------------------------------------------------------

export function ActivityChart({
  data,
  windowDays,
  truncated,
}: {
  data: Array<{ date: string; messages: number; conversations: number }>;
  windowDays: number;
  truncated: boolean;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");

  const config = {
    messages: { label: "Messages", color: SERIES },
  } satisfies ChartConfig;

  const total = data.reduce((sum, row) => sum + row.messages, 0);
  if (total === 0) {
    return <NoData label="Messages appear here once an agent starts replying." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.625rem] text-muted-foreground">
          {total.toLocaleString()} messages over {windowDays} days
          {truncated ? " · earliest days may be partial" : ""}
        </p>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant={view === "chart" ? "secondary" : "ghost"}
            onClick={() => setView("chart")}
          >
            <ChartLineIcon /> Chart
          </Button>
          <Button
            size="xs"
            variant={view === "table" ? "secondary" : "ghost"}
            onClick={() => setView("table")}
          >
            <TableIcon /> Values
          </Button>
        </div>
      </div>

      {view === "chart" ? (
        // Height includes the x-axis band so the axis labels are never cropped.
        <ChartContainer config={config} className="h-56 w-full">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-messages)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-messages)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            {/* Solid hairline grid, horizontal only, recessive. */}
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              allowDecimals={false}
              width={28}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={(l) => formatDay(String(l))} />}
            />
            <Area
              dataKey="messages"
              type="monotone"
              stroke="var(--color-messages)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#activity-fill)"
              // >= 8px markers with a 2px surface ring, only on hover.
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--card)",
                fill: "var(--color-messages)",
              }}
            />
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Conversations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data].reverse().map((row) => (
                <TableRow key={row.date}>
                  <TableCell>{formatDay(row.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.messages}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.conversations}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranked magnitude.
//
// Rendered as DOM rather than SVG on purpose: recharts drops the value label on
// a zero-width bar, so five empty statuses came out as bare names with no
// number — indistinguishable from missing data. Real text also means every
// value is readable without hovering, which is the table-view requirement met
// by construction.
//
// One colour for every bar: length already encodes the value, so a per-bar ramp
// would double-encode it and burn the only free channel.
// ---------------------------------------------------------------------------

export function RankedBars({
  data,
  categoryKey,
  valueKey,
  valueLabel,
  emptyLabel,
  formatCategory,
}: {
  data: Array<Record<string, string | number>>;
  categoryKey: string;
  valueKey: string;
  valueLabel: string;
  emptyLabel: string;
  formatCategory?: (value: string) => string;
}) {
  const rows = data.map((row) => ({
    category: String(row[categoryKey]),
    value: Number(row[valueKey] ?? 0),
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total === 0) return <NoData label={emptyLabel} />;

  const max = Math.max(...rows.map((row) => row.value));

  return (
    <table className="w-full border-separate border-spacing-y-1.5 text-xs">
      <caption className="sr-only">
        {valueLabel} by {categoryKey}
      </caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.category}>
            <th
              scope="row"
              className="w-[38%] pr-3 text-right align-middle font-normal text-muted-foreground"
            >
              {formatCategory ? formatCategory(row.category) : row.category}
            </th>
            <td className="align-middle">
              {/* Track is the surface; the bar grows from a single baseline
                  with a 4px rounded data-end. */}
              <div className="h-3.5 w-full">
                <div
                  className="h-full rounded-r-[4px]"
                  style={{
                    width: max > 0 ? `${(row.value / max) * 100}%` : "0%",
                    minWidth: row.value > 0 ? "2px" : "0",
                    background: SERIES,
                  }}
                />
              </div>
            </td>
            <td className="w-8 pl-2 text-right align-middle tabular-nums">
              {/* Value in text ink, never the data colour. */}
              <span className={row.value === 0 ? "text-muted-foreground" : ""}>
                {row.value}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Part-to-whole across two channels. A single stacked bar, two steps of the
// same hue, separated by a 2px surface gap — not a two-slice pie.
// ---------------------------------------------------------------------------

export function ChannelSplit({
  whatsapp,
  web,
}: {
  whatsapp: number;
  web: number;
}) {
  const total = whatsapp + web;
  if (total === 0) {
    return (
      <NoData label="Conversations are grouped by where they arrived from." />
    );
  }

  const rows = [
    { key: "whatsapp", label: "WhatsApp", value: whatsapp, tone: SERIES },
    { key: "web", label: "Web playground", value: web, tone: SERIES_ALT },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* The bar itself. flex + gap gives the 2px surface gap for free. */}
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`WhatsApp ${whatsapp}, web ${web}, of ${total} conversations`}
      >
        {rows
          .filter((row) => row.value > 0)
          .map((row) => (
            <div
              key={row.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(row.value / total) * 100}%`,
                background: row.tone,
              }}
            />
          ))}
      </div>

      {/* Legend doubles as the value table — identity is never colour-alone. */}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{
                background: row.tone,
              }}
            />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto tabular-nums">{row.value}</span>
            <Badge variant="ghost" className="tabular-nums">
              {Math.round((row.value / total) * 100)}%
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tile: label · value · delta · sparkline.
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  previous,
  data,
  dataKey,
  suffix,
  lowerIsBetter = false,
}: {
  label: string;
  value: number | null;
  previous: number | null;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  suffix?: string;
  lowerIsBetter?: boolean;
}) {
  const hasDelta =
    value !== null && previous !== null && previous !== 0 && value !== previous;
  const change = hasDelta
    ? Math.round(((value - previous) / previous) * 100)
    : 0;
  const improved = lowerIsBetter ? change < 0 : change > 0;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-end gap-2">
        {/* Proportional figures: tabular-nums makes big numbers look loose. */}
        <span className="font-heading text-2xl font-semibold leading-none">
          {value === null ? "—" : value.toLocaleString()}
          {value !== null && suffix ? (
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </span>
        {hasDelta ? (
          <span
            className={cn(
              "text-[0.625rem] leading-none",
              improved ? "text-primary" : "text-muted-foreground"
            )}
          >
            {change > 0 ? "+" : ""}
            {change}%
          </span>
        ) : null}
      </div>
      <Sparkline data={data} dataKey={dataKey} label={label} />
    </div>
  );
}
