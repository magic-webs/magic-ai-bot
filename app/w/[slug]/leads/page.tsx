"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  PencilSimpleIcon,
  TrashIcon,
  ChatsIcon,
  WhatsappLogoIcon,
  GlobeIcon,
  SignpostIcon,
  WarningIcon,
  FloppyDiskIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

const OUTCOMES = [
  { value: "open", label: "Open — still in play" },
  { value: "won", label: "Won — closes the lead" },
  { value: "lost", label: "Lost — closes the lead" },
];

type Stage = {
  _id: Id<"leadStages">;
  name: string;
  description: string;
  position: number;
  outcome: "open" | "won" | "lost";
  leadCount: number;
};

function outcomeBadge(outcome: Stage["outcome"]) {
  if (outcome === "won") return <Badge>won</Badge>;
  if (outcome === "lost") return <Badge variant="secondary">lost</Badge>;
  return null;
}

// ---------------------------------------------------------------------------

function StageDialog({
  workspaceId,
  stage,
  trigger,
}: {
  workspaceId: Id<"workspaces">;
  /** Absent when adding. */
  stage?: Stage;
  trigger: React.ReactElement;
}) {
  const createStage = useMutation(api.leads.createStage);
  const updateStage = useMutation(api.leads.updateStage);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(stage?.name ?? "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [outcome, setOutcome] = useState(stage?.outcome ?? "open");

  const save = async () => {
    setBusy(true);
    try {
      if (stage) {
        await updateStage({
          stageId: stage._id,
          name,
          description,
          outcome: outcome as Stage["outcome"],
        });
      } else {
        await createStage({
          workspaceId,
          name,
          description,
          outcome: outcome as Stage["outcome"],
        });
      }
      toast.add({ title: stage ? "Stage saved" : "Stage added", type: "success" });
      setOpen(false);
      if (!stage) {
        setName("");
        setDescription("");
        setOutcome("open");
      }
    } catch (error) {
      toast.add({
        title: "Could not save the stage",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stage ? `Edit ${stage.name}` : "Add a stage"}</DialogTitle>
          <DialogDescription>
            The description is what the follow-up desk reads when it decides
            where a conversation belongs, so write it as a test someone could
            apply — not as a label.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stage-name">Name</Label>
            <Input
              id="stage-name"
              value={name}
              placeholder="Site visit booked"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stage-description">What belongs here</Label>
            <Textarea
              id="stage-description"
              rows={4}
              value={description}
              placeholder="They have agreed a date to visit the site and it has been confirmed with them."
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stage-outcome">Outcome</Label>
            <SelectField
              id="stage-outcome"
              value={outcome}
              onValueChange={(next) => setOutcome(next as Stage["outcome"])}
              options={OUTCOMES}
            />
            <p className="text-xs text-muted-foreground">
              A won or lost stage stops the follow-ups. Nothing is chased once
              it has been bought or turned down.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim() || !description.trim()}>
            {busy ? <Spinner /> : <FloppyDiskIcon />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function StagesPanel({
  workspaceId,
  stages,
}: {
  workspaceId: Id<"workspaces">;
  stages: Stage[];
}) {
  const removeStage = useMutation(api.leads.removeStage);

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <SignpostIcon className="size-4 shrink-0 text-muted-foreground" />
          Lead stages
          <StageDialog
            workspaceId={workspaceId}
            trigger={
              <Button size="lg" variant="outline" className="ml-auto">
                <PlusIcon /> Add stage
              </Button>
            }
          />
        </CardTitle>
        <CardDescription>
          Seven generalised stages come as standard. Rename them, add your own,
          or delete what does not apply — the follow-up desk only ever files a
          conversation into one of these.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {stages.map((stage) => (
          <div
            key={stage._id}
            className="flex flex-wrap items-start gap-2 rounded-lg border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {stage.name}
                {outcomeBadge(stage.outcome)}
                <Badge variant="ghost" className="tabular-nums">
                  {stage.leadCount} {stage.leadCount === 1 ? "lead" : "leads"}
                </Badge>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stage.description}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <StageDialog
                workspaceId={workspaceId}
                stage={stage}
                trigger={
                  <Button
                    size="icon-lg"
                    variant="ghost"
                    aria-label={`Edit ${stage.name}`}
                  >
                    <PencilSimpleIcon />
                  </Button>
                }
              />
              <Button
                size="icon-lg"
                variant="ghost"
                aria-label={`Delete ${stage.name}`}
                onClick={async () => {
                  try {
                    const result = await removeStage({ stageId: stage._id });
                    toast.add({
                      title: `Deleted ${stage.name}`,
                      description: result.cleared
                        ? `${result.cleared} lead(s) are now unfiled and will be judged again on the next review.`
                        : undefined,
                      type: "success",
                    });
                  } catch (error) {
                    toast.add({
                      title: "Could not delete the stage",
                      description:
                        error instanceof Error ? error.message : String(error),
                      type: "error",
                    });
                  }
                }}
              >
                <TrashIcon />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

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
  stages: Stage[];
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
  }) as Stage[] | undefined;
  const leads = useQuery(api.leads.pipeline, {
    workspaceId: workspace._id,
  }) as Lead[] | undefined;
  const ensureStages = useMutation(api.leads.ensureDefaultStages);
  const ensureDesk = useMutation(api.agents.ensureDefaultFollowUpDesk);
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const [showStages, setShowStages] = useState(false);

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
          variant={showStages ? "secondary" : "outline"}
          className="shrink-0"
          onClick={() => setShowStages((open) => !open)}
        >
          <SignpostIcon /> {showStages ? "Hide stages" : "Manage stages"}
        </Button>
      </header>

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

      {showStages && stages ? (
        <StagesPanel workspaceId={workspace._id} stages={stages} />
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
                  {outcomeBadge(group.outcome)}
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
