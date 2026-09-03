"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import {
  LeadStagesSheet,
  stageOutcomeBadge,
  type LeadStage,
} from "@/components/lead-stages-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ListSkeleton } from "@/components/skeletons";
import { toast } from "@/components/ui/toast";
import {
  FunnelIcon,
  PlusIcon,
  ChatsIcon,
  WhatsappLogoIcon,
  GlobeIcon,
  SignpostIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------

type Lead = {
  conversationId: Id<"conversations">;
  leadStageId: Id<"leadStages"> | null;
  leadStageNote: string | null;
  leadStagePinned: boolean;
  reviewedAt: number | null;
  followUpCount: number;
  status: string;
  channelType: "whatsapp" | "web";
  messageCount: number;
  lastMessageAt: number;
  lastMessagePreview: string | null;
  handledBy: string | null;
  contactLabel: string;
  contactCompany: string | null;
  remark: string | null;
};

function LeadRow({
  lead,
  stages,
  base,
}: {
  lead: Lead;
  stages: LeadStage[];
  base: string;
}) {
  const setStage = useMutation(api.leads.setStage);

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border p-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        {lead.channelType === "whatsapp" ? (
          <WhatsappLogoIcon className="size-4" />
        ) : (
          <GlobeIcon className="size-4" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate">{lead.contactLabel}</span>
          {lead.contactCompany ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {lead.contactCompany}
            </span>
          ) : null}
          {lead.status === "escalated" ? (
            <Badge variant="destructive">escalated</Badge>
          ) : null}
          {lead.leadStagePinned ? (
            <Badge variant="outline" title="Filed by hand — reviews will not move it">
              pinned
            </Badge>
          ) : null}
          {lead.followUpCount > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {lead.followUpCount} nudge{lead.followUpCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </p>

        {lead.lastMessagePreview ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {lead.lastMessagePreview}
          </p>
        ) : null}

        {/* Why the desk filed it here. The single most useful thing on this
            page when a stage looks wrong. */}
        {lead.leadStageNote ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground italic">
            {lead.leadStageNote}
          </p>
        ) : null}

        {lead.remark ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            Remark: {lead.remark}
          </p>
        ) : null}

        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{formatDistanceToNow(lead.lastMessageAt, { addSuffix: true })}</span>
          <span>{lead.messageCount} messages</span>
          {lead.handledBy ? <span>{lead.handledBy}</span> : null}

        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <SelectField
          aria-label={`Stage for ${lead.contactLabel}`}
          value={lead.leadStageId ?? "none"}
          onValueChange={async (next) => {
            try {
              await setStage({
                conversationId: lead.conversationId,
                stageId:
                  next === "none" ? undefined : (next as Id<"leadStages">),
              });
            } catch (error) {
              toast.add({
                title: "Could not move the lead",
                description:
                  error instanceof Error ? error.message : String(error),
                type: "error",
              });
            }
          }}
          options={[
            { value: "none", label: "Unfiled" },
            ...stages.map((stage) => ({
              value: stage._id as string,
              label: stage.name,
            })),
          ]}
        />
        <Button
          size="icon-lg"
          variant="ghost"
          aria-label={`Open the conversation with ${lead.contactLabel}`}
          nativeButton={false}
          render={
            <Link href={`${base}/conversations?c=${lead.conversationId}`} />
          }
        >
          <ChatsIcon />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function LeadsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const stages = useQuery(api.leads.listStages, {
    workspaceId: workspace._id,
  }) as LeadStage[] | undefined;
  const leads = useQuery(api.leads.pipeline, {
    workspaceId: workspace._id,
  }) as Lead[] | undefined;
  const ensureStages = useMutation(api.leads.ensureDefaultStages);
  const ensureDesk = useMutation(api.agents.ensureDefaultFollowUpDesk);
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const [stagesOpen, setStagesOpen] = useState(false);

  const desk = (agents ?? []).find((agent) => agent.kind === "follow_up");

  // Grouped in pipeline order, with the unfiled last: they are the ones the
  // desk has not read yet, which is a queue rather than a stage.
  const grouped = useMemo(() => {
    if (!stages || !leads) return [];
    const byStage = new Map<string, Lead[]>();
    const unfiled: Lead[] = [];
    for (const lead of leads) {
      if (!lead.leadStageId) {
        unfiled.push(lead);
        continue;
      }
      const list = byStage.get(lead.leadStageId) ?? [];
      list.push(lead);
      byStage.set(lead.leadStageId, list);
    }
    return [
      ...stages.map((stage) => ({
        key: stage._id as string,
        title: stage.name,
        outcome: stage.outcome,
        description: stage.description,
        rows: byStage.get(stage._id) ?? [],
      })),
      {
        key: "unfiled",
        title: "Not yet reviewed",
        outcome: "open" as const,
        description:
          "The follow-up desk reads a conversation an hour after it goes quiet. These have not reached that point, or nothing matched.",
        rows: unfiled,
      },
    ];
  }, [stages, leads]);

  const loading = stages === undefined || leads === undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Leads
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every conversation, filed at the stage it has actually reached. An
            hour after a thread goes quiet the follow-up desk reads it, files
            it, and sends one nudge if it is worth sending.
          </p>
        </div>
        <Button
          size="lg"
          variant="outline"
          className="shrink-0"
          onClick={() => setStagesOpen(true)}
        >
          <SignpostIcon /> Manage stages
        </Button>
      </header>

      {stages ? (
        <LeadStagesSheet
          workspaceId={workspace._id}
          stages={stages}
          open={stagesOpen}
          onOpenChange={setStagesOpen}
        />
      ) : null}

      <Separator />

      {!desk && agents !== undefined ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>No follow-up desk yet</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              Nothing will be filed or followed up until this workspace has one.
              It reads conversations after they go quiet; it never takes a live
              turn and never appears in the front desk&apos;s roster.
            </span>
            <Button
              size="lg"
              onClick={async () => {
                await ensureStages({ workspaceId: workspace._id });
                await ensureDesk({ workspaceId: workspace._id });
                toast.add({ title: "Follow-up desk created", type: "success" });
              }}
            >
              <PlusIcon /> Create the follow-up desk
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <ListSkeleton rows={6} />
      ) : leads.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FunnelIcon />
            </EmptyMedia>
            <EmptyTitle>No leads yet</EmptyTitle>
            <EmptyDescription>
              Every conversation becomes a lead. Talk to an agent in the
              playground, or send a WhatsApp message to a connected number, and
              it will appear here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link href={`${base}/conversations`} />}
            >
              <ChatsIcon /> Open conversations
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped
            // A stage nobody is at is noise on a page about who is where.
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <section key={group.key} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-sm font-semibold">
                    {group.title}
                  </h2>
                  {stageOutcomeBadge(group.outcome)}
                  <Badge variant="ghost" className="tabular-nums">
                    {group.rows.length}
                  </Badge>
                </div>
                {group.rows.map((lead) => (
                  <LeadRow
                    key={lead.conversationId}
                    lead={lead}
                    stages={stages}
                    base={base}
                  />
                ))}
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
