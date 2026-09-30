"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CATEGORY_LABELS,
  MESSAGE_CATEGORIES,
  formatMoney,
  type MessageCategory,
} from "@/convex/lib/billing";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { CompanyLogo } from "@/components/company-logo";
import { CategoryDot } from "@/components/billing/category";
import {
  RateCardDialog,
  type RateView,
} from "@/components/billing/rate-card-dialog";
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
import {
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";

type Spend = Array<{ currency: string; amountMicros: number; messages: number }>;

const rateOf = (card: RateView, category: MessageCategory) =>
  card[`${category}Micros` as `${MessageCategory}Micros`];

/** Several currencies side by side, never summed. */
function SpendList({ spend, locale }: { spend: Spend; locale?: string }) {
  if (spend.length === 0) return <span className="text-muted-foreground">—</span>;
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

export default function AdminBillingPage() {
  const [days, setDays] = useState("30");
  const [search, setSearch] = useState("");
  const now = useHourBucket();
  const data = useQuery(api.billing.adminOverview, {
    days: Number(days),
    now,
  });

  const needle = search.trim().toLowerCase();
  const rows = (data?.workspaces ?? []).filter(
    (row) =>
      !needle ||
      row.name.toLowerCase().includes(needle) ||
      row.slug.includes(needle)
  );
  const ownCards = (data?.workspaces ?? []).filter((row) => row.rates).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Message billing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What each account pays per WhatsApp message — service, utility,
            marketing and authentication — and what each has consumed.
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

      {data === undefined ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner /> Loading billing…
        </div>
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

          <div className="grid gap-3 lg:grid-cols-5">
            {/* ------------------------------------------- default rates */}
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Platform default rates</CardTitle>
                  <CardDescription>
                    Billed to every account without rates of its own —{" "}
                    {data.workspaces.length - ownCards} of{" "}
                    {data.workspaces.length} right now.
                  </CardDescription>
                </div>
                <RateCardDialog
                  current={data.defaultRates}
                  defaultCurrency="USD"
                  trigger={
                    <Button size="sm" variant="outline">
                      <PencilSimpleIcon />
                      {data.defaultRates ? "Edit" : "Set default rates"}
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent>
                {data.defaultRates ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {MESSAGE_CATEGORIES.map((category) => (
                      <div
                        key={category}
                        className="flex flex-col gap-1 rounded-lg border p-3"
                      >
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CategoryDot category={category} />
                          {CATEGORY_LABELS[category]}
                        </span>
                        <span className="font-heading text-lg leading-tight font-semibold tabular-nums">
                          {formatMoney(
                            rateOf(data.defaultRates!, category),
                            data.defaultRates!.currency
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          per message
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Not set. Accounts without their own rates have their
                    messages counted at zero until you set these.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* --------------------------------------------- consumption */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Across every account</CardTitle>
                <CardDescription>
                  {data.totals.messages.toLocaleString()} messages billed in{" "}
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
                        {data.totals.byCategory[category].toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-start justify-between gap-2 border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Billed</span>
                  <span className="text-right font-medium tabular-nums">
                    <SpendList spend={data.totals.spend} />
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ------------------------------------------------ accounts */}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Accounts</CardTitle>
                <CardDescription>
                  Rates per message, and what each account consumed in the
                  period. Open one for its per-message ledger.
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
              <div className="overflow-hidden rounded-md border *:data-[slot=table-container]:max-h-[min(36rem,65svh)] *:data-[slot=table-container]:overflow-y-auto *:data-[slot=table-container]:overscroll-contain">
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
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const card = row.rates ?? data.defaultRates;
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
                                  {row.rates
                                    ? `Own rates · ${row.rates.currency}`
                                    : data.defaultRates
                                      ? `Default rates · ${data.defaultRates.currency}`
                                      : "No rates"}
                                </span>
                              </span>
                            </Link>
                          </TableCell>
                          {MESSAGE_CATEGORIES.map((category) => (
                            <TableCell
                              key={category}
                              className="hidden text-right whitespace-nowrap tabular-nums md:table-cell"
                            >
                              {card ? (
                                <span
                                  className={
                                    row.rates ? "" : "text-muted-foreground"
                                  }
                                >
                                  {formatMoney(
                                    rateOf(card, category),
                                    card.currency,
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
                            <SpendList spend={row.spend} locale={row.locale} />
                          </TableCell>
                          <TableCell>
                            <RateCardDialog
                              workspaceId={row.workspaceId}
                              workspaceName={row.name}
                              current={row.rates}
                              fallback={data.defaultRates}
                              defaultCurrency={row.currency}
                              trigger={
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Edit rates for ${row.name}`}
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
                            {data.deleted!.byCategory[category].toLocaleString()} sent
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">
                          {data.deleted.messages.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <SpendList spend={data.deleted.spend} />
                        </TableCell>
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
