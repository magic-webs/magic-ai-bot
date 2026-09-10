"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { BUILTIN_TOOLS, CHAT_MODELS } from "@/convex/lib/shared";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { AgentFlow } from "@/components/agent-flow";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import {
  ChatsIcon,
  CursorClickIcon,
  SlidersIcon,
} from "@phosphor-icons/react";

const STATUSES = ["draft", "active", "paused"] as const;
type Status = (typeof STATUSES)[number];

/** The fields this panel edits. Everything else stays on the full form. */
type Draft = {
  routingDescription: string;
  acceptsHandoff: boolean;
  status: Status;
  knowledgeEnabled: boolean;
  knowledgeTopK: number;
  builtinTools: string[];
  model: string;
  temperature: number;
};

function draftOf(agent: Doc<"agents">): Draft {
  return {
    routingDescription: agent.routingDescription ?? "",
    acceptsHandoff: agent.acceptsHandoff !== false,
    status: agent.status,
    knowledgeEnabled: agent.knowledgeEnabled,
    knowledgeTopK: agent.knowledgeTopK,
    builtinTools: agent.builtinTools,
    model: agent.model,
    temperature: agent.temperature,
  };
}

function firstNumber(value: number | readonly number[]): number {
  return Array.isArray(value) ? (value[0] ?? 0) : (value as number);
}

// ---------------------------------------------------------------------------
// The inspector
//
// Keyed on the agent by its caller, so picking another node builds a fresh
// draft rather than carrying half-typed edits across to a different agent.
// ---------------------------------------------------------------------------

function Inspector({
  agent,
  base,
}: {
  agent: Doc<"agents">;
  base: string;
}) {
  const update = useMutation(api.agents.update);
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const saved = draftOf(agent);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const isRouter = agent.kind === "router";

  const save = async () => {
    setSaving(true);
    try {
      await update({ agentId: agent._id, ...draft });
      toast.add({ title: `${agent.botName} saved`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not save",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (key: string, on: boolean) =>
    set(
      "builtinTools",
      on
        ? [...draft.builtinTools, key]
        : draft.builtinTools.filter((tool) => tool !== key)
    );

  return (
    <>
      {/* SheetContent draws its own close button, so there is none here. The
          header stays inside the scroll-free top so the body below can own the
          overflow — a sheet whose whole contents scroll takes the title away
          with it. */}
      <SheetHeader className="gap-1 border-b pr-12">
        <SheetTitle className="flex min-w-0 items-center gap-2">
          <span className="truncate">{agent.botName}</span>
          {isRouter ? <Badge>front desk</Badge> : null}
        </SheetTitle>
        <SheetDescription className="truncate">{agent.role}</SheetDescription>
      </SheetHeader>

      {/* min-w-0 as well as min-h-0: a flex child defaults to its content's
          width, which is how one long label got to widen the whole sheet. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {/* --- status ------------------------------------------------------ */}
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <ToggleGroup
            value={[draft.status]}
            onValueChange={(value) => {
              const next = value[0] as Status | undefined;
              if (next) set("status", next);
            }}
            className="w-full"
          >
            {STATUSES.map((status) => (
              <ToggleGroupItem
                key={status}
                value={status}
                className="flex-1 capitalize"
                // The front desk answers every channel; the update mutation
                // promotes a draft back to active anyway, so offering it here
                // would be a control that silently undoes itself.
                disabled={isRouter && status === "draft"}
              >
                {status}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            Only an active agent receives handovers.
          </p>
        </div>

        <Separator />

        {/* --- routing ----------------------------------------------------- */}
        {isRouter ? (
          <p className="text-xs text-muted-foreground">
            The front desk answers first on every channel and hands each
            conversation on. It is never handed to, so it has no routing note.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routing">Hand over to me when…</Label>
            <Textarea
              id="routing"
              rows={4}
              value={draft.routingDescription}
              placeholder="…the person asks about escrow, payouts or when they will be paid."
              onChange={(event) =>
                set("routingDescription", event.target.value)
              }
            />
            {/* The single most consequential field on this page: it is the
                whole routing table the front desk reads. An agent without one
                is nearly invisible to it. */}
            {!draft.routingDescription.trim() ? (
              <p className="text-xs text-destructive">
                Without this, the front desk has almost nothing to route on.
              </p>
            ) : null}

            <div className="mt-1 flex items-center justify-between gap-2">
              <Label htmlFor="accepts" className="font-normal">
                Accepts handovers
              </Label>
              <Switch
                id="accepts"
                checked={draft.acceptsHandoff}
                onCheckedChange={(checked) => set("acceptsHandoff", checked)}
              />
            </div>
          </div>
        )}

        <Separator />

        {/* --- knowledge --------------------------------------------------- */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="knowledge" className="font-normal">
              Read the knowledge base
            </Label>
            <Switch
              id="knowledge"
              checked={draft.knowledgeEnabled}
              onCheckedChange={(checked) => set("knowledgeEnabled", checked)}
            />
          </div>
          {draft.knowledgeEnabled ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Passages per answer · {draft.knowledgeTopK}
              </Label>
              <Slider
                value={[draft.knowledgeTopK]}
                min={1}
                max={12}
                step={1}
                onValueChange={(value) =>
                  set("knowledgeTopK", firstNumber(value))
                }
              />
            </div>
          ) : null}
        </div>

        <Separator />

        {/* --- tools ------------------------------------------------------- */}
        <div className="flex flex-col gap-2">
          <Label>Tools</Label>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_TOOLS.map((tool) => {
              const on = draft.builtinTools.includes(tool.key);
              const locked = isRouter && tool.key === "transfer_to_agent";
              return (
                <button
                  key={tool.key}
                  type="button"
                  disabled={locked}
                  title={
                    locked
                      ? "The front desk cannot route without this."
                      : tool.summary
                  }
                  onClick={() => toggleTool(tool.key, !on)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
                    on
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                    locked && "opacity-70"
                  )}
                >
                  {tool.key}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Tap to turn on or off. Hover for what each one does.
          </p>
        </div>

        <Separator />

        {/* --- model ------------------------------------------------------- */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="model">Model</Label>
          <SelectField
            id="model"
            // SelectTrigger is `w-fit whitespace-nowrap`, so a long label —
            // "Ling 3.0 Flash Fin — finance-tuned, 256K context, free" — grew
            // the trigger past the panel and set the whole sheet scrolling
            // sideways. Full width with min-w-0 lets it shrink instead, and
            // the value's own line-clamp then does the trimming. The dropdown
            // still opens at its natural width, so nothing is unreadable.
            className="w-full min-w-0"
            value={draft.model}
            onValueChange={(value) => set("model", value)}
            options={[
              ...CHAT_MODELS.map((model) => ({
                value: model.id,
                label: model.label,
              })),
              // An agent saved before the gateway holds a bare id that is not
              // in the list; without this the picker would show empty and
              // saving would silently change the model.
              ...(CHAT_MODELS.some((model) => model.id === draft.model)
                ? []
                : [{ value: draft.model, label: `${draft.model} (current)` }]),
            ]}
          />
          <Label className="mt-1 text-xs text-muted-foreground">
            Temperature · {draft.temperature.toFixed(2)}
          </Label>
          <Slider
            value={[draft.temperature]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={(value) => set("temperature", firstNumber(value))}
          />
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agent._id}/test`} />}
          >
            <ChatsIcon /> Test in the playground
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agent._id}`} />}
          >
            <SlidersIcon /> Persona, tone, rules and prompt
          </Button>
        </div>
      </div>

      {/* An explicit save, not autosave: these are live agents answering
          customers, and a half-typed routing note saved on every keystroke
          would be in the front desk's routing table while you typed it. */}
      {/* Rendered only when there is something to save. It used to sit there
          at opacity-0, which kept its padding, its buttons' height and its
          top border in the layout — an empty band with a divider across the
          bottom of every panel that had no unsaved edit. */}
      {dirty ? (
        <SheetFooter className="flex-row items-center gap-2 border-t">
          {/* No `!dirty` on these any more: the whole footer is gone in that
              case, so the only thing left to guard is a save in flight. */}
          <Button
            className="flex-1"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : null} Save changes
          </Button>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => setDraft(draftOf(agent))}
          >
            Discard
          </Button>
        </SheetFooter>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function AgentConfigPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const [selected, setSelected] = useState<Id<"agents"> | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // No fallback selection any more: a sheet that opens itself the moment the
  // page loads is a sheet you have to dismiss before you can look at anything.
  // The canvas is the page; the sheet arrives when you pick a node.
  const active = (agents ?? []).find((agent) => agent._id === selected);

  if (agents === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading agents…
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No agents in this workspace yet.
        </p>
        <Button nativeButton={false} render={<Link href={`${base}/agents`} />}>
          Create the first agent
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CursorClickIcon className="size-4" />
          Pick a node to configure it
        </p>
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href={`${base}/agents`} />}
        >
          Card view
        </Button>
      </header>

      {/* The canvas and the sheet share this row. `relative` is what the
          sheet docks against: it is portaled in here rather than to the body,
          so it lands at this panel's right edge instead of the window's.
          min-h-0 on every ancestor is what gives the canvas its height —
          without it the flex column cannot shrink below its content and the
          graph renders taller than the viewport. */}
      <div ref={dockRef} className="relative flex min-h-0 min-w-0 flex-1">
        <AgentFlow
          agents={agents}
          base={base}
          className="min-h-0 min-w-0 flex-1 border-0"
          selectedId={active?._id ?? null}
          onSelectAgent={setSelected}
        />

        {/* Reserves the sheet's width in normal flow, so the graph shrinks
            beside it rather than sitting underneath it. A dialog popup is
            never in flow, so nothing else can make room for it. Below sm the
            sheet is three-quarter width and overlays instead. */}
        {active ? (
          <div className="hidden w-[28rem] shrink-0 sm:block" aria-hidden />
        ) : null}

        <Sheet
          open={Boolean(active)}
          // Non-modal: this is a panel beside the graph, not a layer over it,
          // so the canvas stays live and undimmed while it is open.
          modal={false}
          onOpenChange={(open, details) => {
            if (open) return;
            // Clicking the canvas — including the next node — must not shut
            // the panel, or picking another agent would close and reopen it.
            // The close button and Escape still do.
            if (
              details.reason === "outside-press" ||
              details.reason === "focus-out"
            ) {
              return;
            }
            setSelected(null);
          }}
        >
          <SheetContent
            side="right"
            container={dockRef}
            showOverlay={false}
            // 28rem, matched by the spacer above so the graph gives up
            // exactly this much room — wide enough for the tool chips and the
            // model label without either being clipped.
            //
            // It has to be written with SheetContent's own variant chain,
            // not a plain `sm:`. It sets `data-[side=right]:sm:max-w-sm`, and
            // tailwind-merge only drops a class when the variants match too —
            // so a bare `sm:max-w-[28rem]` was kept *alongside* it and then
            // lost on specificity to the attribute selector. The sheet stayed
            // 24rem while the spacer below was 28rem, which is where the empty
            // 4rem strip beside it came from.
            //
            // The width is scoped to sm and up so the component's `w-3/4`
            // still governs phones, where the spacer is hidden and this
            // overlays instead.
            className="absolute inset-y-0 right-0 h-full gap-0 border-l p-0 shadow-none data-[side=right]:sm:w-[28rem] data-[side=right]:sm:max-w-[28rem]"
          >
            {/* Mounted only while something is picked, and keyed on it, so the
                draft is built from the agent in front of you rather than
                carried over from the last one. */}
            {active ? (
              <Inspector key={active._id} agent={active} base={base} />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
