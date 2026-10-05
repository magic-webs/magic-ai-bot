"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { STATUS_VARIANT, hourLabel, shortDayLabel } from "@/components/marketing/format";
import { EVERYONE } from "@/components/marketing/audience/audience-picker";
import type { Category } from "@/components/marketing/audience/shared";
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
import { ComposerDialog, emptyCampaign, type CampaignDraft } from "./composer-dialog";
import { ReportDialog } from "./report-dialog";

type Template = Doc<"marketingTemplates"> & { metaBody: string };

const rate = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

let keySeq = 0;
const nextKey = () => ++keySeq;

export function CampaignsTab({
  templates,
  categories,
  today,
}: {
  templates: Template[];
  categories: Category[];
  today: string;
}) {
  const workspace = useWorkspace();
  const { results, status, loadMore } = usePaginatedQuery(
    api.marketingBroadcasts.list,
    { workspaceId: workspace._id },
    { initialNumItems: 25 }
  );
  const [draft, setDraft] = useState<{ value: CampaignDraft; key: number } | null>(null);
  const [reportId, setReportId] = useState<Id<"marketingEvents"> | null>(null);

  const open = (row: (typeof results)[number]) => {
    if (row.startedAt || row.status === "sent" || row.status === "failed" || row.status === "cancelled") {
      setReportId(row._id);
      return;
    }
    setDraft({
      key: nextKey(),
      value: {
        eventId: row._id,
        title: row.title,
        templateId: row.templateId,
        message: row.note ?? "",
        audience: row.audience ?? EVERYONE,
        date: row.date < today ? today : row.date,
        sendHour: row.sendHour,
        ratePerMinute: row.ratePerMinute,
        when: "later",
      },
    });
  };

  const duplicate = (eventId: Id<"marketingEvents">) => {
    const row = results.find((item) => item._id === eventId);
    setReportId(null);
    setDraft({
      key: nextKey(),
      value: {
        ...emptyCampaign(today),
        title: row ? `${row.title} (copy)` : "",
        templateId: row?.templateId,
        message: row?.note ?? "",
        audience: row?.audience ?? EVERYONE,
        ratePerMinute: row?.ratePerMinute,
      },
    });
  };

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
        <Button onClick={() => setDraft({ key: nextKey(), value: emptyCampaign(today) })}>
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
          <Button onClick={() => setDraft({ key: nextKey(), value: emptyCampaign(today) })}>
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

      {draft ? (
        <ComposerDialog
          key={draft.key}
          draft={draft.value}
          templates={templates}
          categories={categories}
          today={today}
          onClose={() => setDraft(null)}
          onSaved={(eventId, sentNow) => {
            setDraft(null);
            if (sentNow) setReportId(eventId);
          }}
        />
      ) : null}
      {reportId ? (
        <ReportDialog
          key={reportId}
          eventId={reportId}
          onClose={() => setReportId(null)}
          onDuplicate={() => duplicate(reportId)}
        />
      ) : null}
    </div>
  );
}
