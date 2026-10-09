"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CATEGORY_LABELS,
  MESSAGE_CATEGORIES,
  formatMoney,
} from "@/convex/lib/billing";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { CompanyLogo } from "@/components/company-logo";
import { CategoryDot } from "@/components/billing/category";
import { MarkupDialog } from "@/components/billing/markup-dialog";
import {
  ImportMetaRatesDialog,
  MetaRatesDialog,
} from "@/components/billing/meta-rates";
import {
  describeMarkup,
  priceOf,
  ratesInForce,
} from "@/components/billing/pricing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatTilesSkeleton, TableSkeleton } from "@/components/skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TableIcon,
  UploadSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";

type Spend = Array<{
  currency: string;
  amountMicros: number;
  messages: number;
}>;
type Margin = Array<{ currency: string; marginMicros: number }>;

/** Several currencies side by side, never summed. */
function SpendList({ spend, locale }: { spend: Spend; locale?: string }) {
  if (spend.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      {spend.map((row) => (
        <span key={row.currency}>
          {formatMoney(row.amountMicros, row.currency, locale)}
        </span>
      ))}
    </span>
  );
}

function MarginList({ margin, locale }: { margin: Margin; locale?: string }) {
  if (margin.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      {margin.map((row) => (
        <span key={row.currency}>
          {formatMoney(row.marginMicros, row.currency, locale)}
        </span>
      ))}
    </span>
  );
}

export default function AdminBillingPage() {
  const [days, setDays] = useState("30");
  const [search, setSearch] = useState("");
  const now = useHourBucket();
  const data = useQuery(api.billing.adminOverview, {
    days: Number(days),
    now,
  });
  const meta = useQuery(api.billing.metaRates, {});
  const [tab, setTab] = useState<string | null>(null);
  // INR first, then the rest, whichever is the default.
  const currencies = [...(meta?.currencies ?? ["INR"])].sort(
    (a, b) => Number(b === "INR") - Number(a === "INR") || a.localeCompare(b)
  );
  const currency = tab ?? currencies[0];
  const inForceIn = (code: string) =>
    ratesInForce(
      (meta?.rows ?? []).filter((row) => row.currency === code),
      now
    );
  const inForce = inForceIn(currency);
  const india = inForce.get("IN");
  const indiaIn = (code: string) => inForceIn(code).get("IN");
  const money = (micros: number) => formatMoney(micros, currency);

  const needle = search.trim().toLowerCase();
  const accounts = (data?.workspaces ?? []).filter(
    (row) => row.billedIn === currency
  );
  const rows = accounts.filter(
    (row) =>
      !needle ||
      row.name.toLowerCase().includes(needle) ||
      row.slug.includes(needle)
  );
  const ownCards = accounts.filter((row) => row.markups).length;
  const inCurrency = <T extends { currency: string }>(list: T[]) =>
    list.filter((entry) => entry.currency === currency);
  const totals = {
    messages: accounts.reduce((sum, row) => sum + row.messages, 0),
    byCategory: Object.fromEntries(
      MESSAGE_CATEGORIES.map((category) => [
        category,
        accounts.reduce((sum, row) => sum + row.byCategory[category], 0),
      ])
    ) as Record<(typeof MESSAGE_CATEGORIES)[number], number>,
    spend: inCurrency(data?.totals.spend ?? []),
    margin: inCurrency(data?.totals.margin ?? []),
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Message billing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Meta&apos;s rate for each WhatsApp message plus the platform markup,
            what each account consumed, and what the platform kept.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-wide text-muted-foreground uppercase">
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
      </header>

      {data === undefined || meta === undefined ? (
        <>
          <StatTilesSkeleton count={3} className="lg:grid-cols-3" />
          <TableSkeleton rows={6} columns={5} />
        </>
      ) : (
        <>
          {data.truncated ? (
            <Alert variant="destructive">
              <WarningIcon />
              <AlertTitle>Showing a partial window</AlertTitle>
              <AlertDescription>
                The read cap was reached, so these totals are a floor. Narrow
                the period.
              </AlertDescription>
            </Alert>
          ) : null}

          {currencies.length > 1 ? (
            <Tabs
              value={currency}
              onValueChange={(value) => setTab(String(value))}
            >
              <TabsList>
                {currencies.map((code) => (
                  <TabsTrigger key={code} value={code}>
                    {code}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-3">
            {/* ---------------------------------------------- Meta's rates */}
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Meta&apos;s rates</CardTitle>
                  <CardDescription>
                    {inForce.size > 0
                      ? `${inForce.size} markets in force, in ${currency}. India shown.`
                      : `No ${currency} rates. Messages count at zero until they are imported.`}
                  </CardDescription>
                </div>
                <div className="flex gap-1.5">
                  {meta && meta.rows.length > 0 ? (
                    <MetaRatesDialog
                      key={currency}
                      rows={meta.rows}
                      billedIn={currency}
                      now={now}
                      trigger={
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label="Every market"
                        >
                          <TableIcon />
                        </Button>
                      }
                    />
                  ) : null}
                  <ImportMetaRatesDialog
                    defaultCurrency={currency}
                    trigger={
                      <Button size="sm" variant="outline">
                        <UploadSimpleIcon /> Import
                      </Button>
                    }
                  />
                </div>
              </CardHeader>
              <CardContent>
                {india ? (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {MESSAGE_CATEGORIES.map((category) => (
                      <li
                        key={category}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <CategoryDot category={category} />
                          {CATEGORY_LABELS[category]}
                        </span>
                        <span className="tabular-nums">
                          {money(india[`${category}Micros`])}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Import the rates CSV from Meta&apos;s pricing page.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* -------------------------------------------- default markup */}
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Default markup</CardTitle>
                  <CardDescription>
                    For every {currency} account without its own —{" "}
                    {accounts.length - ownCards} of {accounts.length}. The
                    percentages are shared by every currency.
                  </CardDescription>
                </div>
                <MarkupDialog
                  current={data.defaultMarkups}
                  currencies={currencies}
                  currency={currency}
                  sample={india}
                  trigger={
                    <Button size="sm" variant="outline">
                      <PencilSimpleIcon />
                      {data.defaultMarkups ? "Edit" : "Set markup"}
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent>
                {data.defaultMarkups ? (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {MESSAGE_CATEGORIES.map((category) => (
                      <li
                        key={category}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <CategoryDot category={category} />
                          {CATEGORY_LABELS[category]}
                        </span>
                        <span className="text-right tabular-nums">
                          {describeMarkup(data.defaultMarkups!, category, [
                            currency,
                          ])}
                          {india ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ={" "}
                              {money(
                                priceOf(india, data.defaultMarkups, category)
                              )}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between gap-2 border-t pt-1.5">
                      <span className="text-muted-foreground">
                        Free from Meta
                      </span>
                      <span className="tabular-nums">
                        {data.defaultMarkups.chargeFree
                          ? "Charged as usual"
                          : "Free"}
                      </span>
                    </li>
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Not set. Accounts pay Meta&apos;s rate and nothing more.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ------------------------------------------------ consumption */}
            <Card>
              <CardHeader>
                <CardTitle>Across {currency} accounts</CardTitle>
                <CardDescription>
                  {totals.messages.toLocaleString()} messages billed in{" "}
                  {data.windowDays} days.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col gap-1.5 text-sm">
                  {MESSAGE_CATEGORIES.map((category) => (
                    <li
                      key={category}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <CategoryDot category={category} />
                        {CATEGORY_LABELS[category]}
                      </span>
                      <span className="tabular-nums">
                        {totals.byCategory[category].toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground">Billed</span>
                    <span className="text-right font-medium tabular-nums">
                      <SpendList spend={totals.spend} />
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground">
                      Margin over Meta
                    </span>
                    <span className="text-right font-medium tabular-nums">
                      <MarginList margin={totals.margin} />
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ------------------------------------------------ accounts */}
          <Card className="shrink-0">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{currency} accounts</CardTitle>
                <CardDescription>
                  Price per message to India, and what each account consumed in
                  the period. Open one for its per-message ledger.
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  placeholder="Find an account"
                  className="pl-8"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              {/* Scrolls inside the card, so a long list of accounts does not
                  push the rest of the page away and the search box stays in
                  reach. The height goes on Table's own container — it already
                  scrolls sideways, and a second scroller around it would leave
                  the sticky header pinned to the wrong box. */}
              <div className="overflow-hidden rounded-md border *:data-[slot=table-container]:max-h-[min(48rem,75svh)] *:data-[slot=table-container]:overflow-y-auto *:data-[slot=table-container]:overscroll-contain">
                <Table>
                  {/* The row border does not travel with a sticky header, so
                      the rule under it is an inset shadow instead. */}
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                    <TableRow>
                      <TableHead className="min-w-48">Account</TableHead>
                      {MESSAGE_CATEGORIES.map((category) => (
                        <TableHead
                          key={category}
                          className="hidden text-right md:table-cell"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <CategoryDot category={category} />
                            {CATEGORY_LABELS[category]}
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Messages</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">
                        Margin
                      </TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const markups = row.markups ?? data.defaultMarkups;
                      const rates = indiaIn(row.billedIn);
                      return (
                        <TableRow key={row.workspaceId}>
                          <TableCell className="max-w-64 min-w-0">
                            <Link
                              href={`/w/${row.slug}/billing`}
                              className="flex min-w-0 items-center gap-2.5 hover:underline"
                            >
                              <CompanyLogo
                                src={row.logoSrc}
                                className="size-8 rounded-md"
                              />
                              <span className="grid min-w-0 leading-tight">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-medium">
                                    {row.name}
                                  </span>
                                  {row.status === "archived" ? (
                                    <Badge variant="secondary">archived</Badge>
                                  ) : null}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {row.billedIn} ·{" "}
                                  {row.markups
                                    ? "own markup"
                                    : data.defaultMarkups
                                      ? "default markup"
                                      : "no markup"}
                                </span>
                              </span>
                            </Link>
                          </TableCell>
                          {MESSAGE_CATEGORIES.map((category) => (
                            <TableCell
                              key={category}
                              className="hidden text-right whitespace-nowrap tabular-nums md:table-cell"
                            >
                              {rates ? (
                                <span
                                  className={
                                    row.markups ? "" : "text-muted-foreground"
                                  }
                                >
                                  {formatMoney(
                                    priceOf(rates, markups, category),
                                    rates.currency,
                                    row.locale
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              <span className="block text-[11px] text-muted-foreground">
                                {row.byCategory[category].toLocaleString()} sent
                              </span>
                            </TableCell>
                          ))}
                          <TableCell className="text-right tabular-nums">
                            {row.messages.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                            <SpendList
                              spend={inCurrency(row.spend)}
                              locale={row.locale}
                            />
                          </TableCell>
                          <TableCell className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">
                            <MarginList
                              margin={inCurrency(row.margin)}
                              locale={row.locale}
                            />
                          </TableCell>
                          <TableCell>
                            <MarkupDialog
                              workspaceId={row.workspaceId}
                              workspaceName={row.name}
                              current={row.markups}
                              fallback={data.defaultMarkups}
                              currencies={currencies}
                              currency={row.billedIn}
                              sample={rates}
                              trigger={
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Edit markup for ${row.name}`}
                                >
                                  <PencilSimpleIcon />
                                </Button>
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {data.deleted && !needle ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground italic">
                          Deleted workspaces
                        </TableCell>
                        {MESSAGE_CATEGORIES.map((category) => (
                          <TableCell
                            key={category}
                            className="hidden text-right text-[11px] text-muted-foreground md:table-cell"
                          >
                            {data.deleted!.byCategory[
                              category
                            ].toLocaleString()}{" "}
                            sent
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">
                          {data.deleted.messages.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <SpendList spend={inCurrency(data.deleted.spend)} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell" />
                        <TableCell />
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {needle ? "No account matches that." : "No accounts yet."}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
