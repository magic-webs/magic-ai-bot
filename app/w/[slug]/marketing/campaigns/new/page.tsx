"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { localDate } from "@/components/marketing/calendar";
import { EVERYONE } from "@/components/marketing/audience/audience-picker";
import {
  CampaignComposer,
  emptyCampaign,
  type CampaignDraft,
} from "@/components/marketing/campaigns/composer";
import { TableSkeleton } from "@/components/skeletons";

export default function NewCampaignPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const now = useHourBucket();
  const today = localDate(now, workspace.timezone);
  const base = `/w/${workspace.slug}/marketing/campaigns`;
  const editId = params.get("edit") as Id<"marketingEvents"> | null;
  const fromId = params.get("from") as Id<"marketingEvents"> | null;
  const sourceId = editId ?? fromId;

  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const source = useQuery(api.marketingBroadcasts.get, sourceId ? { eventId: sourceId } : "skip");
  const templates = useMemo(() => overview?.templates ?? [], [overview]);

  if (!overview || (sourceId && source === undefined)) return <TableSkeleton rows={6} columns={3} />;

  const draft: CampaignDraft = source
    ? {
        ...emptyCampaign(today),
        eventId: editId ? source._id : undefined,
        title: editId ? source.title : `${source.title} (copy)`,
        templateId: source.templateId,
        message: source.note ?? "",
        audience: source.audience ?? EVERYONE,
        date: editId && source.date >= today ? source.date : today,
        sendHour: editId ? source.sendHour : 10,
        ratePerMinute: source.ratePerMinute,
        trackLinks: source.trackLinks ?? true,
      }
    : emptyCampaign(today);

  return (
    <div className="rounded-lg border border-border p-4 sm:p-6">
      <CampaignComposer
        key={sourceId ?? "new"}
        draft={draft}
        templates={templates}
        categories={overview.categories}
        today={today}
        onClose={() => router.push(base)}
        onSaved={(eventId, sentNow) => router.push(sentNow ? `${base}/${eventId}` : base)}
      />
    </div>
  );
}
