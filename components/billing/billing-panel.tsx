"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CATEGORY_LABELS,
  MESSAGE_CATEGORIES,
  SOURCE_LABELS,
  formatMoney,
  type MessageCategory,
} from "@/convex/lib/billing";
import { useWorkspace } from "@/components/workspace-provider";
import { useSession } from "@/components/use-session";
import { useHourBucket } from "@/components/use-now";
import { ActivityChart, StatTile } from "@/components/dashboard-charts";
import {
  CategoryBadge,
  CategoryDot,
  categoryBarClass,
} from "@/components/billing/category";
import { RateCardDialog } from "@/components/billing/rate-card-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  PencilSimpleIcon,
  ReceiptIcon,
  WarningIcon,
} from "@phosphor-icons/react";

const PAGE = 25;

type Filter = "all" | MessageCategory;

/**
 * An instant in the workspace's own timezone and locale — the ledger is read
 * by the company, and "sent at 14:05" means their 14:05.
 */
function useStamp() {
  const workspace = useWorkspace();
  return useMemo(() => {
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat(workspace.locale, {
        timeZone: workspace.timezone,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      formatter = new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return (timestamp: number) => formatter.format(timestamp);
  }, [workspace.locale, workspace.timezone]);
}

/**
 * A workspace's billing: what each WhatsApp message cost, by category, and
 * every one of them in a ledger.
 *
 * Read-only for the company. An administrator sees an edit button on the
 * rates, which is the same dialog the admin billing page uses.
 */
export function BillingPanel({ days }: { days: number }) {
  const workspace = useWorkspace();
  const { isAdmin } = useSession();
  const now = useHourBucket();
  const data = useQuery(api.billing.workspaceSummary, {
    workspaceId: workspace._id,
    days,
    now,
  });
  // Admin-only, for prefilling an account that has no rates of its own.
  const defaults = useQuery(api.billing.defaultRates, isAdmin ? {} : "skip");

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> Loading billing…
      </div>
    );
  }

  const money = (micros: number) =>
    formatMoney(micros, data.currency, data.locale);
  const series = data.daily.map((day) => ({
    date: day.date,
    spend: day.spend,
    amountMicros: day.amountMicros,
    messages: day.messages,
  }));
  const templates =
    data.totals.messages -
    (data.byCategory.find((row) => row.category === "service")?.messages ?? 0);
  const average =
    data.totals.messages > 0
      ? Math.round(data.totals.amountMicros / data.totals.messages)
      : 0;
  const rateOf = (category: MessageCategory) =>
    data.rates
      ? data.rates[`${category}Micros` as `${MessageCategory}Micros`]
      : null;

  const editRates = isAdmin ? (
    <RateCardDialog
      workspaceId={workspace._id}
      workspaceName={workspace.name}
      current={data.rates?.scope === "workspace" ? data.rates : null}
      fallback={defaults ?? data.rates}
      defaultCurrency={workspace.currency}
      trigger={
        <Button size="sm" variant="outline">
          <PencilSimpleIcon /> Edit rates
        </Button>
      }
    />
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {!data.rates ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>No rates are set for this account yet</AlertTitle>
          <AlertDescription>
            Messages are still counted, at zero, so nothing is lost — they are
            priced from the moment an administrator sets the rates.
          </AlertDescription>
        </Alert>
      ) : null}

      {data.truncated ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Showing a partial window</AlertTitle>
          <AlertDescription>
            This period holds more messages than one read covers, so the totals
            are a floor. Narrow the period for exact figures.
          </AlertDescription>
        </Alert>
      ) : null}

      {data.otherCurrencies.length > 0 ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>Some of this period was billed in another currency</AlertTitle>
          <AlertDescription>
            The rates changed currency during the period. Also billed:{" "}
            {data.otherCurrencies
              .map(
                (row) =>
                  `${formatMoney(row.amountMicros, row.currency, data.locale)} over ${row.messages.toLocaleString()} messages`
              )
              .join(", ")}
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ------------------------------------------------------ tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Spent"
          value={data.totals.amountMicros}
          previous={data.previous.amountMicros}
          data={series}
          dataKey="spend"
          format={money}
          lowerIsBetter
        />
        <StatTile
          label="Messages billed"
          value={data.totals.messages}
          previous={data.previous.messages}
          data={series}
          dataKey="messages"
        />
        <StatTile
          label="Average per message"
          value={data.totals.messages > 0 ? average : null}
          previous={null}
          format={money}
        />
        <StatTile label="Template messages" value={templates} previous={null} />
      </div>

      {/* ----------------------------------------------- by category */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>By conversation type</CardTitle>
          {editRates}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Share of spend as one stacked bar: part-to-whole across four
              kinds, readable at a glance, with the figures beneath it. */}
          {data.totals.amountMicros > 0 ? (
            <div
              className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label="Share of spend by conversation type"
            >
              {data.byCategory
                .filter((row) => row.amountMicros > 0)
                .map((row) => (
                  <div
                    key={row.category}
                    className={categoryBarClass(row.category)}
                    style={{
                      width: `${(row.amountMicros / data.totals.amountMicros) * 100}%`,
                    }}
                  />
                ))}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.byCategory.map((row) => {
              const rate = rateOf(row.category);
              return (
                <div
                  key={row.category}
                  className="flex flex-col gap-2 rounded-lg border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <CategoryDot category={row.category} />
                      {CATEGORY_LABELS[row.category]}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {rate === null ? "no rate" : `${money(rate)} / msg`}
                    </span>
                  </div>
                  <p className="font-heading text-2xl leading-none font-semibold">
                    {money(row.amountMicros)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.messages.toLocaleString()}{" "}
                    {row.messages === 1 ? "message" : "messages"}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------ daily */}
      <Card>
        <CardHeader>
          <CardTitle>Spend per day</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityChart
            data={series}
            windowDays={data.windowDays}
            truncated={data.truncated}
            series={{
              key: "spend",
              label: `Spend (${data.currency})`,
              format: (value) => money(Math.round(value * 1_000_000)),
              fractional: true,
            }}
            columns={[
              { key: "amountMicros", label: "Spend", format: money },
              { key: "messages", label: "Messages" },
            ]}
            noun="spent"
            emptyLabel="Spend appears here once a WhatsApp message goes out."
          />
        </CardContent>
      </Card>

      <Ledger currency={data.currency} locale={data.locale} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The per-message ledger
// ---------------------------------------------------------------------------

function Ledger({ currency, locale }: { currency: string; locale: string }) {
  const workspace = useWorkspace();
  const stamp = useStamp();
  const [filter, setFilter] = useState<Filter>("all");
  const { results, status, loadMore } = usePaginatedQuery(
    api.billing.ledger,
    {
      workspaceId: workspace._id,
      category: filter === "all" ? undefined : filter,
    },
    { initialNumItems: PAGE }
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Every message</CardTitle>
        {/* Scrolls sideways rather than wrapping on a phone: five chips on
            one line is the control, and a wrapped second row reads as two. */}
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <ToggleGroup
            value={[filter]}
            onValueChange={(value) => {
              const next = value[0] as Filter | undefined;
              if (next) setFilter(next);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            {MESSAGE_CATEGORIES.map((category) => (
              <ToggleGroupItem key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        {status === "LoadingFirstPage" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Loading messages…
          </div>
        ) : results.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ReceiptIcon />
              </EmptyMedia>
              <EmptyTitle>
                {filter === "all"
                  ? "No billed messages yet"
                  : `No ${CATEGORY_LABELS[filter].toLowerCase()} messages yet`}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Sent</TableHead>
                    <TableHead className="min-w-36">To</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden md:table-cell">By</TableHead>
                    <TableHead className="hidden lg:table-cell">Message</TableHead>
                    <TableHead className="text-right">Charge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {stamp(row.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-48 min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {row.contactName ?? `+${row.to.replace(/^\+/, "")}`}
                        </span>
                        {row.contactName ? (
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            +{row.to.replace(/^\+/, "")}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <CategoryBadge category={row.category} />
                      </TableCell>
                      <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground md:table-cell">
                        {SOURCE_LABELS[row.source]}
                      </TableCell>
                      <TableCell className="hidden max-w-80 lg:table-cell">
                        <span
                          className="line-clamp-1 text-sm text-muted-foreground"
                          title={row.preview}
                        >
                          {row.templateName ? (
                            <span className="mr-1 font-mono text-xs">
                              {row.templateName} ·
                            </span>
                          ) : null}
                          {row.preview ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {row.rated ? (
                          formatMoney(row.amountMicros, row.currency, locale)
                        ) : (
                          <span
                            className="text-muted-foreground"
                            title="No rates were set when this was sent"
                          >
                            unrated
                          </span>
                        )}
                        {row.rated && row.currency !== currency ? (
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            {row.currency}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {status === "CanLoadMore" || status === "LoadingMore" ? (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={status === "LoadingMore"}
                  onClick={() => loadMore(PAGE)}
                >
                  {status === "LoadingMore" ? <Spinner /> : null} Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
