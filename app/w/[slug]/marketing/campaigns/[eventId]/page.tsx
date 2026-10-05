"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { CampaignReport } from "@/components/marketing/campaigns/report";

export default function CampaignReportPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { eventId } = use(params);
  const workspace = useWorkspace();
  const router = useRouter();
  const base = `/w/${workspace.slug}/marketing/campaigns`;
  return (
    <div className="rounded-lg border border-border p-4 sm:p-6">
      <CampaignReport
        eventId={eventId as Id<"marketingEvents">}
        onClose={() => router.push(base)}
        onDuplicate={() => router.push(`${base}/new?from=${eventId}`)}
      />
    </div>
  );
}
