"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  DEFAULT_CHAT_MODEL,
  supportsPromptCaching,
  type ModelRole,
} from "@/convex/lib/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
} from "@/components/ui/dialog";
import { TableSkeleton } from "@/components/skeletons";
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  ChatCircleDotsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  RobotIcon,
  TagIcon,
  type Icon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

type Catalogue = NonNullable<
  ReturnType<typeof useQuery<typeof api.models.list>>
>;
type Entry = Catalogue[number];

const ROLES: Array<{
  role: ModelRole;
  title: string;
  description: string;
  icon: Icon;
}> = [
  {
    role: "chat",
    title: "Chat",
    description:
      "What agents reply with. A workspace's agents run on the models offered here.",
    icon: ChatCircleDotsIcon,
  },
  {
    role: "embedding",
    title: "Embedding",
    description:
      "Turns knowledge sources and customer questions into vectors for retrieval.",
    icon: MagnifyingGlassIcon,
  },
  {
    role: "classification",
    title: "Classification",
    description: "Sorts and scores guests and imported contacts.",
    icon: TagIcon,
  },
];

/**
 * A price per million tokens, at a precision that survives being small.
 * Trailing zeros are trimmed, and a genuine zero reads as "Free".
 */
function per1M(value: number): string {
  if (value === 0) return "Free";
  return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
}

type Draft = {
  label: string;
  inputPer1M: string;
  outputPer1M: string;
  notes: string;
};

function EditDialog({
  entry,
  onOpenChange,
}: {
  entry: Entry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useMutation(api.models.update);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Draft | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = entry?.modelId ?? null;
  if (key !== seededFor) {
    setSeededFor(key);
    setForm(
      entry && {
        label: entry.label,
        inputPer1M: String(entry.inputPer1M),
        outputPer1M: String(entry.outputPer1M),
        notes: entry.notes ?? "",
      }
    );
  }

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));

  const chat = entry?.role === "chat";

  const submit = async () => {
    if (!entry || !form) return;
    const input = Number(form.inputPer1M);
    const output = Number(form.outputPer1M || "0");
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      toast.add({
        title: "Prices must be numbers",
        description: "USD per 1M tokens, as the gateway catalogue lists them.",
        type: "error",
      });
      return;
    }

    setBusy(true);
    try {
      await update({
        modelId: entry.modelId,
        label: form.label,
        inputPer1M: input,
        outputPer1M: output,
        notes: form.notes || undefined,
      });
      toast.add({
        title: `${entry.modelId} updated`,
        description: "Calls already recorded keep the cost they were charged at.",
        type: "success",
      });
      onOpenChange(false);
    } catch (error) {
      toast.add({
        title: "Could not save the model",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit model</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{entry?.modelId}</span>. Prices are USD
            per million tokens, from ai-gateway.vercel.sh/v1/models.
          </DialogDescription>
        </DialogHeader>

        {form ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-label">Label</Label>
              <Input
                id="m-label"
                value={form.label}
                onChange={(event) => set("label", event.target.value)}
              />
            </div>

            <div className={chat ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-in">Input · $/1M</Label>
                <Input
                  id="m-in"
                  inputMode="decimal"
                  value={form.inputPer1M}
                  onChange={(event) => set("inputPer1M", event.target.value)}
                />
              </div>
              {chat ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-out">Output · $/1M</Label>
                  <Input
                    id="m-out"
                    inputMode="decimal"
                    value={form.outputPer1M}
                    onChange={(event) => set("outputPer1M", event.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-notes">Notes</Label>
              <Textarea
                id="m-notes"
                rows={2}
                value={form.notes}
                placeholder="Re-check the catalogue price in March."
                onChange={(event) => set("notes", event.target.value)}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelRow({
  model,
  onEdit,
}: {
  model: Entry;
  onEdit: (entry: Entry) => void;
}) {
  const setEnabled = useMutation(api.models.setEnabled);
  const setPromptCaching = useMutation(api.models.setPromptCaching);
  const reset = useMutation(api.models.reset);

  const run = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.add({ title, description: friendlyError(error), type: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{model.label}</span>
          {model.isDefault ? <Badge>Default</Badge> : null}
          {model.customised ? (
            <Badge variant="secondary">Customised</Badge>
          ) : null}
        </div>
        <div className="mt-0.5 font-mono text-xs break-all text-muted-foreground">
          {model.modelId}
        </div>
        {model.notes ? (
          <div className="mt-1 text-xs text-muted-foreground italic">
            {model.notes}
          </div>
        ) : null}
      </div>

      <div className="text-sm tabular-nums md:w-44 md:text-right">
        <span className="font-medium">{per1M(model.inputPer1M)}</span>
        <span className="text-muted-foreground"> in</span>
        {model.role === "chat" ? (
          <>
            <span className="text-muted-foreground"> · </span>
            <span className="font-medium">{per1M(model.outputPer1M)}</span>
            <span className="text-muted-foreground"> out</span>
          </>
        ) : null}
        <div className="text-xs text-muted-foreground">per 1M tokens</div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:justify-end">
        {model.role === "chat" ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={model.enabled}
              disabled={model.isDefault}
              onCheckedChange={(enabled) =>
                void run("Could not change the model", () =>
                  setEnabled({ modelId: model.modelId, enabled })
                )
              }
            />
            Offered
          </label>
        ) : null}
        {supportsPromptCaching(model.modelId) ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={model.promptCaching}
              onCheckedChange={(promptCaching) =>
                void run("Could not change prompt caching", () =>
                  setPromptCaching({ modelId: model.modelId, promptCaching })
                )
              }
            />
            Prompt cache
          </label>
        ) : null}

        <div className="flex gap-1">
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label={`Edit ${model.modelId}`}
            onClick={() => onEdit(model)}
          >
            <PencilSimpleIcon />
          </Button>
          {model.customised ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    size="icon-lg"
                    variant="ghost"
                    aria-label={`Reset ${model.modelId}`}
                  >
                    <ArrowCounterClockwiseIcon />
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset {model.modelId}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its label, price, picker and prompt cache settings go back
                    to what ships.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    render={<Button variant="ghost">Cancel</Button>}
                  />
                  <AlertDialogAction
                    render={
                      <Button
                        onClick={() =>
                          void run("Could not reset it", () =>
                            reset({ modelId: model.modelId })
                          )
                        }
                      >
                        Reset
                      </Button>
                    }
                  />
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AdminModelsPage() {
  const models = useQuery(api.models.list, {});
  const reprice = useMutation(api.models.repriceUnpriced);
  const moveAgents = useMutation(api.models.moveAgentsToDefault);

  const [editing, setEditing] = useState<Entry | null>(null);
  const [repricing, setRepricing] = useState(false);
  const [moving, setMoving] = useState(false);

  const defaultLabel =
    models?.find((model) => model.modelId === DEFAULT_CHAT_MODEL)?.label ??
    DEFAULT_CHAT_MODEL;

  const runReprice = async () => {
    setRepricing(true);
    try {
      const result = await reprice({});
      toast.add({
        title:
          result.repriced === 0
            ? "Nothing to reprice"
            : `${result.repriced} call${result.repriced === 1 ? "" : "s"} repriced`,
        description:
          result.stillUnpriced > 0
            ? `${result.stillUnpriced} call${result.stillUnpriced === 1 ? " is" : "s are"} still on a model with no price.`
            : result.truncated
              ? "The scan cap was reached — run it again to keep going."
              : "Every recorded call now has a price.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not reprice",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setRepricing(false);
    }
  };

  const runMove = async () => {
    setMoving(true);
    let moved = 0;
    let scanned = 0;
    try {
      let cursor: string | null = null;
      for (;;) {
        const result: Awaited<ReturnType<typeof moveAgents>> =
          await moveAgents({ cursor });
        moved += result.moved;
        scanned += result.scanned;
        if (result.done) break;
        cursor = result.cursor;
      }
      toast.add({
        title:
          moved === 0
            ? "Every agent is already on the default"
            : `${moved} agent${moved === 1 ? "" : "s"} moved to ${DEFAULT_CHAT_MODEL}`,
        description: `${scanned} agent${scanned === 1 ? "" : "s"} checked across every workspace.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not move every agent",
        description: `${moved} moved before it stopped. ${friendlyError(error)}`,
        type: "error",
      });
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            AI models
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The models the platform runs, and what it is charged for them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  disabled={moving}
                  aria-label="Move every agent to the default model"
                >
                  {moving ? <Spinner /> : <RobotIcon />}{" "}
                  <span className="hidden sm:inline">
                    Move all agents to default
                  </span>
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Move every agent to the default?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every agent in every workspace, front desks and desks
                  included, switches to{" "}
                  <span className="font-medium text-foreground">
                    {defaultLabel}
                  </span>
                  . Replies use it from the next message, and are costed at its
                  price.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  render={<Button variant="ghost">Cancel</Button>}
                />
                <AlertDialogAction
                  render={<Button onClick={runMove}>Move agents</Button>}
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="outline"
            disabled={repricing}
            onClick={runReprice}
            aria-label="Reprice past usage"
          >
            {repricing ? <Spinner /> : <ArrowsClockwiseIcon />}{" "}
            <span className="hidden sm:inline">Reprice past usage</span>
          </Button>
        </div>
      </header>

      {models === undefined ? (
        <TableSkeleton rows={6} />
      ) : (
        ROLES.map(({ role, title, description, icon: RoleIcon }) => {
          const entries = models.filter((model) => model.role === role);
          if (entries.length === 0) return null;
          return (
            // shrink-0: `Card` carries overflow-hidden, so as a flex item it
            // would shrink and clip instead of letting the column scroll.
            <Card key={role} className="shrink-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RoleIcon className="size-4 text-muted-foreground" />
                  {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent>
                {entries.map((model, index) => (
                  <Fragment key={model.modelId}>
                    {index > 0 ? <Separator /> : null}
                    <ModelRow model={model} onEdit={setEditing} />
                  </Fragment>
                ))}
              </CardContent>
            </Card>
          );
        })
      )}

      <EditDialog
        entry={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
