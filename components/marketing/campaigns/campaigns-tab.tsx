"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { STATUS_VARIANT, hourLabel, shortDayLabel } from "@/components/marketing/format";
import { useWorkspace } from "@/components/workspace-provider";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
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
import { MegaphoneSimpleIcon, PlusIcon } from "@phosphor-icons/react";

const rate = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";


export function CampaignsTab() {
  const workspace = useWorkspace();
  const { results, status, loadMore } = usePaginatedQuery(
    api.marketingBroadcasts.list,
    { workspaceId: workspace._id },
    { initialNumItems: 25 }
  );
  const router = useRouter();
  const base = `/w/${workspace.slug}/marketing/campaigns`;
  const open = (row: (typeof results)[number]) =>
    router.push(
      row.startedAt || row.status === "sent" || row.status === "failed" || row.status === "cancelled"
        ? `${base}/${row._id}`
        : `${base}/new?edit=${row._id}`
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Campaigns</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            One-off broadcasts — offers, launches, announcements and festival greetings — with
            delivery, reads and replies tracked for each.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
          <PlusIcon /> New campaign
        </Button>
      </div>

      {status === "LoadingFirstPage" ? (
        <TableSkeleton rows={5} columns={6} />
      ) : results.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MegaphoneSimpleIcon />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Pick an audience and an approved template, and send now or at a time you choose.
            </EmptyDescription>
          </EmptyHeader>
          <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
            <PlusIcon /> New campaign
          </Button>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="hidden text-right md:table-cell">Delivered</TableHead>
                <TableHead className="hidden text-right md:table-cell">Read</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Replied</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((row) => (
                <TableRow key={row._id} className="cursor-pointer" onClick={() => open(row)}>
                  <TableCell>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {shortDayLabel(row.date)} · {hourLabel(row.sendHour)}
                      {row.templateName ? ` · ${row.templateName}` : ""}
                      {row.audience ? " · chosen audience" : " · everyone"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]} className="gap-1">
                      {row.status === "sending" ? <Spinner className="size-3" /> : null}
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.stats.sent.toLocaleString()}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {rate(row.stats.delivered, row.stats.sent)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {rate(row.stats.read, row.stats.sent)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {rate(row.stats.replied, row.stats.sent)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {row.stats.failed ? row.stats.failed.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {status === "CanLoadMore" ? (
            <div className="flex justify-center border-t border-border p-2">
              <Button size="sm" variant="ghost" onClick={() => loadMore(25)}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
