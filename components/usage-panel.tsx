"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useHourBucket } from "@/components/use-now";
import { RankedBars, StatTile, ActivityChart } from "@/components/dashboard-charts";
import { SelectField } from "@/components/select-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { WarningIcon, CoinsIcon } from "@phosphor-icons/react";

const NANO = 1_000_000_000;

/**
 * Money, at a precision that survives being small.
 *
 * A single web-playground turn on gpt-4.1-mini costs well under a cent, so
 * rounding to 2dp would show every real figure as $0.00 and make the page look
 * broken. Small amounts get 4dp; only sums past a dollar drop to cents.
 */
function usd(nano: number): string {
  const value = nano / NANO;
  if (value === 0) return "$0";
  // Below a hundredth of a cent, 4dp rounds to "$0.0000", which reads as zero
  // and makes a real cost look like a bug.
  if (value < 0.0001) return "<$0.0001";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function tokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/** What the spend was for, in words an operator recognises. */
const SOURCE_LABELS: Record<string, string> = {
  chat: "Agent replies",
  retrieval: "Knowledge search",
  ingest: "Embedding knowledge",
  draft_agent: "Drafting agents",
  draft_tool: "Drafting tools",
  draft_catalogue: "Drafting catalogues",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  web: "Web playground",
  internal: "Dashboard (no channel)",
};

export function UsagePanel() {
  const [days, setDays] = useState("30");
  const now = useHourBucket();
  const data = useQuery(api.usage.adminSummary, {
    days: Number(days),
    now,
  });

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> Loading usage…
      </div>
    );
  }

  const { totals, previous } = data;
  const costSeries = data.daily.map((d) => ({
    date: d.date,
    cost: d.costNanoUsd / NANO,
    tokens: d.totalTokens,
    calls: d.calls,
  }));
  const nothingYet = totals.calls === 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          One row is recorded for every model call, priced from a per-model
          table. Figures are OpenAI list prices and exclude tax — treat them as
          an attribution of spend, not an invoice.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Period
          </span>
          <SelectField
            value={days}
            onValueChange={setDays}
            options={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ]}
          />
        </div>
      </div>

      {data.truncated ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Showing a partial window</AlertTitle>
          <AlertDescription>
            The read cap was reached, so these totals are a floor, not the full
            figure. Narrow the period.
          </AlertDescription>
        </Alert>
      ) : null}

      {data.unpricedModels.length > 0 ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>
            {data.unpricedModels.length} model
            {data.unpricedModels.length === 1 ? "" : "s"} not in the price table
          </AlertTitle>
          <AlertDescription>
            Tokens for{" "}
            <span className="font-mono">{data.unpricedModels.join(", ")}</span>{" "}
            are counted but costed at zero, so the cost below is understated.
            Add {data.unpricedModels.length === 1 ? "it" : "them"} to
            convex/lib/pricing.ts.
          </AlertDescription>
        </Alert>
      ) : null}

      {nothingYet ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CoinsIcon />
            </EmptyMedia>
            <EmptyTitle>No model calls in this period</EmptyTitle>
            <EmptyDescription>
              Usage is recorded from the moment an agent answers a message, a
              knowledge source is embedded, or something is drafted with AI.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Cost"
              value={totals.costNanoUsd}
              previous={previous.costNanoUsd}
              data={costSeries}
              dataKey="cost"
              format={usd}
            />
            <StatTile
              label="Tokens"
              value={totals.totalTokens}
              previous={previous.totalTokens}
              data={costSeries}
              dataKey="tokens"
              format={tokens}
            />
            <StatTile
              label="Model calls"
              value={totals.calls}
              previous={previous.calls}
              data={costSeries}
              dataKey="calls"
            />
            <StatTile
              label="Output tokens"
              value={totals.outputTokens}
              previous={previous.outputTokens}
              format={tokens}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Cost per day</CardTitle>
                <CardDescription>
                  {usd(totals.costNanoUsd)} over {data.windowDays} days across
                  every workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityChart
                  data={costSeries}
                  windowDays={data.windowDays}
                  truncated={data.truncated}
                  kind="bar"
                  series={{
                    key: "cost",
                    label: "Cost (USD)",
                    format: (value) => `$${value.toFixed(4)}`,
                    fractional: true,
                  }}
                  columns={[
                    {
                      key: "cost",
                      label: "Cost",
                      format: (value) => `$${value.toFixed(4)}`,
                    },
                    { key: "tokens", label: "Tokens", format: tokens },
                    { key: "calls", label: "Calls" },
                  ]}
                  noun="spent"
                  emptyLabel="Cost appears here once a model has been called."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Where it went</CardTitle>
                <CardDescription>Cost by what the tokens were for.</CardDescription>
              </CardHeader>
              <CardContent>
                <RankedBars
                  data={data.bySource.map((row) => ({
                    source: SOURCE_LABELS[row.key] ?? row.key,
                    cost: row.costNanoUsd,
                  }))}
                  categoryKey="source"
                  valueKey="cost"
                  valueLabel="Cost"
                  emptyLabel="No spend yet."
                  formatValue={usd}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By workspace</CardTitle>
              <CardDescription>
                Which company&apos;s bot is actually spending the money.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">In</TableHead>
                      <TableHead className="text-right">Out</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byWorkspace.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.calls.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tokens(row.inputTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tokens(row.outputTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tokens(row.totalTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {usd(row.costNanoUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By model</CardTitle>
                <CardDescription>
                  {data.pricedModels} models in the price table.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byModel.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-mono text-xs">
                            {row.key}
                            {!row.priced ? (
                              <Badge variant="destructive" className="ml-1">
                                unpriced
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.calls.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {tokens(row.totalTokens)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {usd(row.costNanoUsd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By channel</CardTitle>
                <CardDescription>
                  Where the conversation that spent it came from.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RankedBars
                  data={data.byChannel.map((row) => ({
                    channel: CHANNEL_LABELS[row.key] ?? row.key,
                    cost: row.costNanoUsd,
                  }))}
                  categoryKey="channel"
                  valueKey="cost"
                  valueLabel="Cost"
                  emptyLabel="No spend yet."
                  formatValue={usd}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
