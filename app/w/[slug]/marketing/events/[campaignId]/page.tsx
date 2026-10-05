"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  CampaignDialog,
  EventCard,
  TouchDialog,
  draftForCampaign,
  type CampaignDraft,
} from "@/components/marketing/events";
import { GuestsPanel } from "@/components/marketing/events/guests-panel";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@phosphor-icons/react";

export default function MarketingEventPage({
  params,
}: {
  params: Promise<{ slug: string; campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const workspace = useWorkspace();
  const back = `/w/${workspace.slug}/marketing/events`;
  const campaign = useQuery(api.marketingCampaigns.get, {
    campaignId: campaignId as Id<"marketingCampaigns">,
  });
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const templates = useMemo(() => overview?.templates ?? [], [overview]);
  const [touchId, setTouchId] = useState<Id<"marketingEvents"> | null>(null);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const openTouch = campaign?.touches.find((t) => t._id === touchId);

  return (
    <div className="flex flex-col gap-4">
      <Button
        size="sm"
        variant="ghost"
        className="w-fit"
        nativeButton={false}
        render={<Link href={back} />}
      >
        <ArrowLeftIcon /> All events
      </Button>

      {campaign === undefined ? (
        <TableSkeleton rows={4} columns={3} />
      ) : (
        <>
          <EventCard
            campaign={campaign}
            templates={templates}
            locale={workspace.locale}
            onEdit={() => setDraft(draftForCampaign(campaign))}
            onGuests={() => document.getElementById("guests")?.scrollIntoView({ behavior: "smooth" })}
            onOpenTouch={(touch) => setTouchId(touch._id)}
          />
          <div id="guests">
            <GuestsPanel campaign={campaign} />
          </div>
          <CampaignDialog
            draft={draft}
            setDraft={setDraft}
            templates={templates}
            categories={overview?.categories ?? []}
          />
          <TouchDialog
            key={`touch:${touchId ?? "none"}`}
            campaign={campaign}
            touch={openTouch ?? null}
            templates={templates}
            onClose={() => setTouchId(null)}
          />
        </>
      )}
    </div>
  );
}
