"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  ArrowLeftIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";

export type LeadStage = {
  _id: Id<"leadStages">;
  name: string;
  description: string;
  position: number;
  outcome: "open" | "won" | "lost";
  leadCount: number;
};

const OUTCOMES = [
  { value: "open", label: "Open — still in play" },
  { value: "won", label: "Won — closes the lead" },
  { value: "lost", label: "Lost — closes the lead" },
];

/** Only the terminal outcomes get a badge; "open" is the unremarkable case. */
export function stageOutcomeBadge(outcome: LeadStage["outcome"]) {
  if (outcome === "won") return <Badge>won</Badge>;
  if (outcome === "lost") return <Badge variant="secondary">lost</Badge>;
  return null;
}

// ---------------------------------------------------------------------------

function StageList({
  stages,
  onEdit,
}: {
  stages: LeadStage[];
  onEdit: (target: LeadStage | "new") => void;
}) {
  const removeStage = useMutation(api.leads.removeStage);

  return (
    <>
      {/* pr-14 leaves the sheet's own close button somewhere to sit. */}
      <SheetHeader className="border-b p-4 pr-14">
        <SheetTitle>Lead stages</SheetTitle>
        <SheetDescription>
          Seven generalised stages come as standard. Rename them, add your own,
          or delete what does not apply — the follow-up desk only ever files a
          conversation into one of these.
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4">
        {stages.map((stage) => (
          <div
            key={stage._id}
            className="flex items-start gap-2 rounded-lg border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {stage.name}
                {stageOutcomeBadge(stage.outcome)}
                <Badge variant="ghost" className="tabular-nums">
                  {stage.leadCount} {stage.leadCount === 1 ? "lead" : "leads"}
                </Badge>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stage.description}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon-lg"
                variant="ghost"
                aria-label={`Edit ${stage.name}`}
                onClick={() => onEdit(stage)}
              >
                <PencilSimpleIcon />
              </Button>
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
      </div>

      <SheetFooter className="border-t p-4">
        <Button size="lg" onClick={() => onEdit("new")}>
          <PlusIcon /> Add stage
        </Button>
      </SheetFooter>
    </>
  );
}

// ---------------------------------------------------------------------------

function StageForm({
  workspaceId,
  stage,
  onDone,
}: {
  workspaceId: Id<"workspaces">;
  /** Absent when adding. */
  stage?: LeadStage;
  onDone: () => void;
}) {
  const createStage = useMutation(api.leads.createStage);
  const updateStage = useMutation(api.leads.updateStage);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(stage?.name ?? "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [outcome, setOutcome] = useState<LeadStage["outcome"]>(
    stage?.outcome ?? "open"
  );

  const save = async () => {
    setBusy(true);
    try {
      if (stage) {
        await updateStage({
          stageId: stage._id,
          name,
          description,
          outcome,
        });
      } else {
        await createStage({ workspaceId, name, description, outcome });
      }
      toast.add({
        title: stage ? "Stage saved" : "Stage added",
        type: "success",
      });
      // Back to the list rather than closing the sheet: adding two stages in a
      // row is the common case, and so is checking the one just written.
      onDone();
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
    <>
      <SheetHeader className="gap-2 border-b p-4 pr-14">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit"
          onClick={onDone}
        >
          <ArrowLeftIcon /> All stages
        </Button>
        <SheetTitle>
          {stage ? `Edit ${stage.name}` : "Add a stage"}
        </SheetTitle>
        <SheetDescription>
          The description is what the follow-up desk reads when it decides where
          a conversation belongs, so write it as a test someone could apply —
          not as a label.
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
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
            rows={5}
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
            onValueChange={(next) => setOutcome(next as LeadStage["outcome"])}
            options={OUTCOMES}
          />
          <p className="text-xs text-muted-foreground">
            A won or lost stage stops the follow-ups. Nothing is chased once it
            has been bought or turned down.
          </p>
        </div>
      </div>

      <SheetFooter className="flex-row justify-end border-t p-4">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={busy || !name.trim() || !description.trim()}
        >
          {busy ? <Spinner /> : <FloppyDiskIcon />} Save
        </Button>
      </SheetFooter>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Stage management, in a drawer off the right edge.
 *
 * One sheet with two panes rather than a sheet that opens a second sheet:
 * stacked overlays on a phone leave nothing of the page visible and two
 * backdrops to dismiss. The form replaces the list and a back button returns,
 * which is the pattern the conversations page already uses at this width.
 */
export function LeadStagesSheet({
  workspaceId,
  stages,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">;
  stages: LeadStage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /** null is the list; "new" is the add form; a stage is that stage's form. */
  const [editing, setEditing] = useState<LeadStage | "new" | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // Reopening lands on the list rather than on a half-typed form.
        if (!next) setEditing(null);
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {editing ? (
          <StageForm
            // Remounting on a change of target is what re-seeds the fields.
            key={editing === "new" ? "new" : editing._id}
            workspaceId={workspaceId}
            stage={editing === "new" ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        ) : (
          <StageList stages={stages} onEdit={setEditing} />
        )}
      </SheetContent>
    </Sheet>
  );
}
