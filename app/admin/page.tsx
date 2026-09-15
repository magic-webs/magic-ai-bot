"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RankedBars, StatTile } from "@/components/dashboard-charts";
import { DashboardSkeleton } from "@/components/skeletons";
import { useHourBucket } from "@/components/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRightIcon,
  BuildingsIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";

const NANO = 1_000_000_000;
const WINDOW_DAYS = 30;

/** Small sums need decimals a cent cannot carry — the usage page's rule. */
function usd(nano: number): string {
  const value = nano / NANO;
  if (value === 0) return "$0";
  if (value < 0.0001) return "<$0.0001";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function tokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * The platform at a glance.
 *
 * Deliberately not a second usage page: the tiles say what the estate is and
 * what it costs, and everything that needs doing is a row that links to the
 * page where it is done. The detail lives one click away, under Tokens & cost.
 */
export default function AdminOverviewPage() {
  const now = useHourBucket();
  const workspaces = useQuery(api.workspaces.list, {});
  const access = useQuery(api.authDb.accessSummary, {});
  const usage = useQuery(api.usage.adminSummary, { days: WINDOW_DAYS, now });

  if (workspaces === undefined || access === undefined || usage === undefined) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        <DashboardSkeleton />
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingsIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing running yet</EmptyTitle>
            <EmptyDescription>
              A workspace is one company or project, with its own agents,
              catalogue and channels. Create the first one and this page starts
              reporting on it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              nativeButton={false}
              render={<Link href="/admin/workspaces" />}
            >
              Go to workspaces <ArrowRightIcon />
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const accessById = new Map(
    access.map((row) => [row.workspaceId as string, row])
  );
  const active = workspaces.filter((row) => row.status !== "archived");
  const costSeries = usage.daily.map((day) => ({
    date: day.date,
    cost: day.costNanoUsd / NANO,
    tokens: day.totalTokens,
  }));

  // What an operator would otherwise have to go looking for: a tenant that
  // cannot sign in, or one that has been put on ice.
  const attention = [
    ...workspaces
      .filter((row) => !accessById.has(row._id as string))
      .map((row) => ({
        id: `${row._id}-nopass`,
        name: row.name,
        slug: row.slug,
        note: "No sign-in issued",
      })),
    ...workspaces
      .filter((row) => accessById.get(row._id as string)?.status === "revoked")
      .map((row) => ({
        id: `${row._id}-revoked`,
        name: row.name,
        slug: row.slug,
        note: "Access revoked",
      })),
    ...workspaces
      .filter((row) => row.status === "archived")
      .map((row) => ({
        id: `${row._id}-archived`,
        name: row.name,
        slug: row.slug,
        note: "Archived",
      })),
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every workspace on this deployment, and what they have spent over
            the last {WINDOW_DAYS} days.
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/admin/workspaces" />}
        >
          <BuildingsIcon /> Workspaces
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Workspaces" value={workspaces.length} previous={null} />
        <StatTile label="Active" value={active.length} previous={null} />
        <StatTile
          label={`Cost · ${WINDOW_DAYS}d`}
          value={usage.totals.costNanoUsd}
          previous={usage.previous.costNanoUsd}
          data={costSeries}
          dataKey="cost"
          format={usd}
        />
        <StatTile
          label={`Tokens · ${WINDOW_DAYS}d`}
          value={usage.totals.totalTokens}
          previous={usage.previous.totalTokens}
          data={costSeries}
          dataKey="tokens"
          format={tokens}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Token use by workspace</CardTitle>
            <CardDescription>
              Tokens spent over {WINDOW_DAYS} days, per company.{" "}
              <Link href="/admin/usage" className="underline">
                Cost breakdown
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              data={usage.byWorkspace.slice(0, 8).map((row) => ({
                workspace: row.name,
                tokens: row.totalTokens,
              }))}
              categoryKey="workspace"
              valueKey="tokens"
              valueLabel="Tokens"
              emptyLabel="No model calls in this period."
              formatValue={tokens}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              Tenants that cannot sign in, or are not meant to.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {attention.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <CheckCircleIcon className="size-4" />
                Every workspace is active and has a password.
              </div>
            ) : (
              attention.slice(0, 8).map((item, index) => (
                <div key={item.id} className="flex flex-col gap-2">
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/w/${item.slug}`}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                    <Badge variant="outline" className="shrink-0">
                      {item.note}
                    </Badge>
                  </div>
                </div>
              ))
            )}
            {attention.length > 0 ? (
              <Link
                href="/admin/access"
                className="pt-1 text-xs text-muted-foreground underline"
              >
                Manage access
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
