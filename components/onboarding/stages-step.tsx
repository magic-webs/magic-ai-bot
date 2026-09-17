"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { FormRow, NothingYet } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import {
  CheckCircleIcon,
  PlusIcon,
  SparkleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * Step 6 — the enquiry stages.
 *
 * The pipeline is not a report. The follow-up desk sweeps conversations that
 * have gone quiet, reads each one against these stage descriptions, files it at
 * the one that fits and — unless the stage is terminal — writes the nudge. So
 * the description is the matching text, and a stage described as "Qualified"
 * and nothing more is one the desk can never confidently file anything into.
 *
 * `won` and `lost` are what stop the chasing. Without a stage of each, a
 * customer who has bought and one who has walked both keep being followed up,
 * which is the failure that costs a workspace its reputation rather than just
 * its time.
 */

type Outcome = Doc<"leadStages">["outcome"];

const OUTCOME_LABEL: Record<Outcome, string> = {
  open: "Still in play",
  won: "Won — stop chasing",
  lost: "Lost — stop chasing",
};

function OutcomePicker({
  value,
  onChange,
}: {
  value: Outcome;
  onChange: (next: Outcome) => void;
}) {
  return (
    <FormRow
      label="What this stage means"
      hint="A won or lost stage ends the follow-ups. Everything else keeps them going."
    >
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((outcome) => (
          <Button
            key={outcome}
            type="button"
            size="sm"
            variant={value === outcome ? "secondary" : "outline"}
            onClick={() => onChange(outcome)}
          >
            {OUTCOME_LABEL[outcome]}
          </Button>
        ))}
      </div>
    </FormRow>
  );
}

function StageRow({
  stage,
}: {
  stage: Doc<"leadStages"> & { leadCount: number };
}) {
  const updateStage = useMutation(api.leads.updateStage);
  const removeStage = useMutation(api.leads.removeStage);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [description, setDescription] = useState(stage.description);
  const [outcome, setOutcome] = useState<Outcome>(stage.outcome);
  const [busy, setBusy] = useState(false);

  const open = () => {
    // Seeded on open, not synced: the query is live, and a stage the follow-up
    // desk refiles while this is open would otherwise overwrite the edit.
    setName(stage.name);
    setDescription(stage.description);
    setOutcome(stage.outcome);
    setEditing(true);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateStage({
        stageId: stage._id,
        name: name.trim(),
        description: description.trim(),
        outcome,
      });
      toast.add({ title: `${name.trim()} saved`, type: "success" });
      setEditing(false);
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

  const drop = async () => {
    setBusy(true);
    try {
      const result = await removeStage({ stageId: stage._id });
      toast.add({
        title: `${stage.name} removed`,
        description:
          result.cleared && result.cleared > 0
            ? `${result.cleared} lead${result.cleared === 1 ? "" : "s"} went back to unfiled.`
            : undefined,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not remove the stage",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
        <FormRow label="Stage name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Quoted"
          />
        </FormRow>
        <FormRow label="What belongs at this stage">
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A price has been given and the customer has not yet said yes or no."
          />
        </FormRow>
        <OutcomePicker value={outcome} onChange={setOutcome} />
        <div className="flex gap-2">
          <Button
            onClick={() => void save()}
            disabled={busy || !name.trim() || !description.trim()}
          >
            {busy ? <Spinner /> : null} Save
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{stage.name}</p>
          <Badge variant={stage.outcome === "open" ? "outline" : "secondary"}>
            {OUTCOME_LABEL[stage.outcome]}
          </Badge>
          {stage.leadCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              {stage.leadCount} {stage.leadCount === 1 ? "lead" : "leads"}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {stage.description ||
            "No description — the follow-up desk has nothing to match against."}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={open}>
        Edit
      </Button>
      <Button
        size="icon-lg"
        variant="ghost"
        aria-label={`Remove the ${stage.name} stage`}
        disabled={busy}
        onClick={() => void drop()}
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function StagesStep() {
  const workspace = useWorkspace();
  const router = useRouter();
  const ensureDefaults = useMutation(api.leads.ensureDefaultStages);
  const createStage = useMutation(api.leads.createStage);
  const stages = useQuery(api.leads.listStages, {
    workspaceId: workspace._id,
  });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("open");
  const [busy, setBusy] = useState(false);

  if (stages === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading the pipeline…
      </div>
    );
  }

  const closable =
    stages.some((stage) => stage.outcome === "won") &&
    stages.some((stage) => stage.outcome === "lost");

  const seed = async () => {
    setBusy(true);
    try {
      const result = await ensureDefaults({ workspaceId: workspace._id });
      toast.add({
        title:
          result.created > 0
            ? `${result.created} stages added`
            : "This workspace already has a pipeline",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not set up the pipeline",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!name.trim() || !description.trim() || busy) return;
    setBusy(true);
    try {
      await createStage({
        workspaceId: workspace._id,
        name: name.trim(),
        description: description.trim(),
        outcome,
      });
      toast.add({ title: `${name.trim()} added`, type: "success" });
      setName("");
      setDescription("");
      setOutcome("open");
      setAdding(false);
    } catch (error) {
      toast.add({
        title: "Could not add the stage",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {stages.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Start from the standard pipeline</CardTitle>
            <CardDescription>
              Six stages that fit most businesses. Rename, reword or delete any
              of them afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void seed()} disabled={busy}>
              {busy ? <Spinner /> : <SparkleIcon />}
              {busy ? "Setting up…" : "Use the standard pipeline"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your pipeline</CardTitle>
          <CardDescription>
            In order. The follow-up desk files every quiet conversation into one
            of these.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {stages.length === 0 && !adding ? (
            <NothingYet>
              No stages yet. Take the standard pipeline above, or write your own.
            </NothingYet>
          ) : null}

          {stages.map((stage) => (
            <StageRow key={stage._id} stage={stage} />
          ))}

          {adding ? (
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
              <FormRow label="Stage name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Awaiting deposit"
                />
              </FormRow>
              <FormRow
                label="What belongs at this stage"
                hint="Written for the follow-up desk. This is the text it matches a conversation against, so describe the situation, not the label."
              >
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="The quote is accepted and we are waiting for the 50% deposit to land."
                />
              </FormRow>
              <OutcomePicker value={outcome} onChange={setOutcome} />
              <div className="flex gap-2">
                <Button
                  onClick={() => void submit()}
                  disabled={busy || !name.trim() || !description.trim()}
                >
                  {busy ? <Spinner /> : null} Add stage
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setAdding(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setAdding(true)}
            >
              <PlusIcon /> Add a stage
            </Button>
          )}
        </CardContent>
      </Card>

      {stages.length > 0 && !closable ? (
        <Alert>
          <WarningIcon />
          <AlertTitle className="font-normal">
            Without a won stage and a lost stage nothing ever leaves the
            pipeline — customers who have already bought keep being chased.
          </AlertTitle>
        </Alert>
      ) : null}

      <div>
        <Button onClick={() => router.push(`/w/${workspace.slug}/onboarding`)}>
          <CheckCircleIcon /> Finish setup
        </Button>
      </div>
    </div>
  );
}
