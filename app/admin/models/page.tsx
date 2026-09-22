"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/skeletons";
import {
  ArrowsClockwiseIcon,
  CpuIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";

type Catalogue = NonNullable<
  ReturnType<typeof useQuery<typeof api.models.list>>
>;
type Entry = Catalogue[number];

/**
 * A price per million tokens, at a precision that survives being small.
 *
 * The cheapest model on the gateway is $0.03/1M, and the free tier is a real
 * $0 rather than a rounding of one — so trailing zeros are trimmed instead of
 * padded, and a genuine zero reads as "Free".
 */
function per1M(value: number): string {
  if (value === 0) return "Free";
  return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
}

const SOURCE_LABEL: Record<Entry["source"], string> = {
  builtin: "Built in",
  // Not "Repriced": the row may exist only because someone flipped the
  // picker toggle on a shipped model, which writes an override too.
  override: "Customised",
  custom: "Added here",
};

type Draft = {
  modelId: string;
  label: string;
  kind: "chat" | "embedding";
  inputPer1M: string;
  outputPer1M: string;
  enabled: boolean;
  notes: string;
};

const BLANK: Draft = {
  modelId: "",
  label: "",
  kind: "chat",
  inputPer1M: "",
  outputPer1M: "",
  enabled: true,
  notes: "",
};

/**
 * One dialog for both adding and editing.
 *
 * `upsert` keys on the model id, so editing is adding the same id again —
 * splitting the form in two would be two copies of the same six fields to keep
 * in step. Editing locks the id, because changing it would leave the old row
 * behind and quietly unprice every call made under it.
 */
function ModelDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: Entry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const upsert = useMutation(api.models.upsert);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Draft>(BLANK);
  // The dialog mounts once and is reused, so the draft is seeded whenever it
  // opens rather than from an initial state that would be a turn stale.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = open ? (entry?.modelId ?? "__new__") : null;
  if (key !== seededFor) {
    setSeededFor(key);
    setForm(
      entry
        ? {
            modelId: entry.modelId,
            label: entry.label,
            kind: entry.kind,
            inputPer1M: String(entry.inputPer1M),
            outputPer1M: String(entry.outputPer1M),
            enabled: entry.enabled,
            notes: entry.notes ?? "",
          }
        : BLANK
    );
  }

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async () => {
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
      const { created } = await upsert({
        modelId: form.modelId,
        label: form.label,
        kind: form.kind,
        inputPer1M: input,
        outputPer1M: output,
        enabled: form.enabled,
        notes: form.notes || undefined,
      });
      toast.add({
        title: created
          ? `${form.modelId} added`
          : `${form.modelId} updated`,
        description: created
          ? "New calls are costed at this price straight away."
          : "Calls already recorded keep the cost they were charged at.",
        type: "success",
      });
      onOpenChange(false);
    } catch (error) {
      toast.add({
        title: "Could not save the model",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const editing = entry !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit model" : "Add a model"}</DialogTitle>
          <DialogDescription>
            Prices are USD per million tokens, read off the gateway&apos;s own
            catalogue at ai-gateway.vercel.sh/v1/models. They are list prices
            and they move.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-id">Model id</Label>
            <Input
              id="m-id"
              className="font-mono"
              value={form.modelId}
              disabled={editing}
              placeholder="xiaomi/mimo-v2.6-flash"
              onChange={(event) => set("modelId", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {editing
                ? "The id is the identity of every usage row already recorded, so it cannot be changed. Add a second model instead."
                : "The creator/model form the gateway uses. A bare id is sent to OpenAI, so it is rejected here."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-label">Label</Label>
            <Input
              id="m-label"
              value={form.label}
              placeholder="MiMo V2.6 Flash — fast, cheap, tool-capable"
              onChange={(event) => set("label", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              What the agent screen&apos;s picker shows. Say what it is for, the
              way the models already in the list do.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-kind">Kind</Label>
              <SelectField
                id="m-kind"
                className="w-full"
                value={form.kind}
                onValueChange={(value) =>
                  set("kind", value as Draft["kind"])
                }
                options={[
                  { value: "chat", label: "Chat" },
                  { value: "embedding", label: "Embedding" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-in">Input · $/1M</Label>
              <Input
                id="m-in"
                inputMode="decimal"
                value={form.inputPer1M}
                placeholder="0.13"
                onChange={(event) => set("inputPer1M", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-out">Output · $/1M</Label>
              <Input
                id="m-out"
                inputMode="decimal"
                value={form.outputPer1M}
                // An embedding model produces no completion tokens, so the
                // field is off rather than a box that accepts a number the
                // costing can never reach.
                disabled={form.kind === "embedding"}
                placeholder={form.kind === "embedding" ? "n/a" : "0.26"}
                onChange={(event) => set("outputPer1M", event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md border p-3">
            <div className="flex flex-col">
              <Label htmlFor="m-enabled" className="font-normal">
                Offer it in the model picker
              </Label>
              <span className="text-xs text-muted-foreground">
                Off still prices it — that is how a retired model keeps costing
                the calls it already made.
              </span>
            </div>
            <Switch
              id="m-enabled"
              checked={form.enabled}
              onCheckedChange={(checked) => set("enabled", checked)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-notes">Notes</Label>
            <Textarea
              id="m-notes"
              rows={2}
              value={form.notes}
              placeholder="Free tier until March; re-check the catalogue then."
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {editing ? "Save model" : "Add model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The price list, and the only place a model can be added without a deploy.
 *
 * Built-in models are listed alongside the added ones rather than hidden: an
 * operator repricing gpt-4.1 needs to see what it currently costs, and a row
 * that says where its number came from is the difference between "this is the
 * price" and "this is the price someone typed".
 */
export default function AdminModelsPage() {
  const models = useQuery(api.models.list, {});
  const setEnabled = useMutation(api.models.setEnabled);
  const remove = useMutation(api.models.remove);
  const reprice = useMutation(api.models.repriceUnpriced);

  const [editing, setEditing] = useState<Entry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [repricing, setRepricing] = useState(false);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (entry: Entry) => {
    setEditing(entry);
    setDialogOpen(true);
  };

  const toggle = async (entry: Entry, enabled: boolean) => {
    try {
      await setEnabled({ modelId: entry.modelId, enabled });
    } catch (error) {
      toast.add({
        title: "Could not change the model",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

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
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setRepricing(false);
    }
  };

  const offered = models?.filter(
    (model) => model.kind === "chat" && model.enabled
  ).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            AI models
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What every workspace may pick an agent&apos;s brain from, and what
            the platform is charged for it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={repricing}
            onClick={runReprice}
          >
            {repricing ? <Spinner /> : <ArrowsClockwiseIcon />} Reprice past
            usage
          </Button>
          <Button onClick={openNew}>
            <PlusIcon /> Add model
          </Button>
        </div>
      </header>

      <Alert>
        <CpuIcon />
        <AlertTitle>A model added here is live immediately</AlertTitle>
        <AlertDescription>
          The picker and the cost table both read this list, so a new model is
          offered to every workspace and its calls are priced from the next one
          onwards. Calls already recorded keep the cost they were charged at —
          use <span className="font-medium">Reprice past usage</span> to fix
          ones that were recorded before a price existed.
        </AlertDescription>
      </Alert>

      {models === undefined ? (
        <TableSkeleton rows={8} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Catalogue</CardTitle>
            <CardDescription>
              {models.length} priced · {offered} offered in the model picker.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">In · $/1M</TableHead>
                    <TableHead className="text-right">Out · $/1M</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-center">Offered</TableHead>
                    <TableHead className="text-right">Edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model) => (
                    <TableRow key={model.modelId}>
                      <TableCell className="min-w-0">
                        <div className="font-mono text-xs">
                          {model.modelId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {model.label}
                        </div>
                        {model.notes ? (
                          <div className="mt-0.5 text-xs text-muted-foreground italic">
                            {model.notes}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">{model.kind}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {per1M(model.inputPer1M)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {model.kind === "embedding"
                          ? "—"
                          : per1M(model.outputPer1M)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            model.source === "builtin" ? "outline" : "secondary"
                          }
                        >
                          {SOURCE_LABEL[model.source]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          aria-label={`Offer ${model.modelId} in the model picker`}
                          checked={model.enabled}
                          // The picker is for an agent's brain, so an
                          // embedding model has nowhere to be offered. The
                          // toggle would do nothing visible; better that it
                          // says so than that it moves.
                          disabled={model.kind === "embedding"}
                          onCheckedChange={(checked) =>
                            void toggle(model, checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="lg"
                            variant="ghost"
                            aria-label={`Edit ${model.modelId}`}
                            onClick={() => openEdit(model)}
                          >
                            <PencilSimpleIcon />
                          </Button>
                          {model.source === "builtin" ? null : (
                            <AlertDialog>
                              <AlertDialogTrigger
                                render={
                                  <Button
                                    size="lg"
                                    variant="ghost"
                                    aria-label={
                                      model.source === "override"
                                        ? `Reset ${model.modelId}`
                                        : `Delete ${model.modelId}`
                                    }
                                  >
                                    <TrashIcon />
                                  </Button>
                                }
                              />
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {model.source === "override"
                                      ? "Restore the shipped price?"
                                      : `Remove ${model.modelId}?`}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {model.source === "override"
                                      ? "The model stays, priced and labelled the way this deployment ships it. Your edits are lost."
                                      : "It disappears from the model picker and stops being priced, so any call it has already made is counted but costed at zero. An agent still configured with it keeps running it. Turning it off instead keeps the price."}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel
                                    render={
                                      <Button variant="ghost">Cancel</Button>
                                    }
                                  />
                                  <AlertDialogAction
                                    render={
                                      <Button
                                        variant="destructive"
                                        onClick={async () => {
                                          try {
                                            await remove({
                                              modelId: model.modelId,
                                            });
                                            toast.add({
                                              title:
                                                model.source === "override"
                                                  ? `${model.modelId} reset`
                                                  : `${model.modelId} removed`,
                                              type: "success",
                                            });
                                          } catch (error) {
                                            toast.add({
                                              title: "Could not remove it",
                                              description:
                                                error instanceof Error
                                                  ? error.message
                                                  : String(error),
                                              type: "error",
                                            });
                                          }
                                        }}
                                      >
                                        {model.source === "override"
                                          ? "Reset"
                                          : "Remove"}
                                      </Button>
                                    }
                                  />
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <ModelDialog
        entry={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
