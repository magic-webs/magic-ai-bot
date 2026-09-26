"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/convex/lib/agentTemplates";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  BriefcaseIcon,
  CalendarCheckIcon,
  InfoIcon,
  LifebuoyIcon,
  PackageIcon,
  PlusIcon,
  RobotIcon,
  ShoppingBagIcon,
  TargetIcon,
} from "@phosphor-icons/react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sales: ShoppingBagIcon,
  lead_qualifier: TargetIcon,
  support: LifebuoyIcon,
  after_sales: PackageIcon,
  bookings: CalendarCheckIcon,
  careers: BriefcaseIcon,
};

/**
 * Pick a pre-drafted specialist and create it in one step.
 *
 * Creates rather than prefilling a form: a template is a whole agent — tone,
 * tools and escalation included — and the agent's own page is where all of
 * that can be read and changed. The agent starts as a draft either way, so
 * nothing answers a customer until someone has looked at it.
 *
 * The only thing asked here is the name customers see, since that is the one
 * field a company is most likely to want as its own before anything else.
 */
export function AgentTemplatePicker({
  onCreated,
}: {
  onCreated: (agentId: Id<"agents">, template: AgentTemplate) => void;
}) {
  const workspace = useWorkspace();
  const createFromTemplate = useMutation(api.agents.createFromTemplate);
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const [selectedKey, setSelectedKey] = useState(AGENT_TEMPLATES[0].key);
  const [botName, setBotName] = useState("");
  const [busy, setBusy] = useState(false);

  const selected =
    AGENT_TEMPLATES.find((template) => template.key === selectedKey) ??
    AGENT_TEMPLATES[0];
  // A second agent from the same template is allowed — two sales desks for
  // two brands is a real setup — but it should not happen by accident.
  const added = new Set((agents ?? []).map((agent) => agent.name));

  const create = async () => {
    setBusy(true);
    try {
      const agentId = await createFromTemplate({
        workspaceId: workspace._id,
        template: selected.key,
        botName: botName.trim() || undefined,
      });
      toast.add({
        title: `${botName.trim() || selected.botName} created`,
        description:
          selected.setupHint ??
          "It starts as a draft — read it over, then set it to active.",
        type: "success",
      });
      onCreated(agentId, selected);
    } catch (error) {
      toast.add({
        title: "Could not create the agent",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Agent templates" className="grid gap-2 sm:grid-cols-2">
        {AGENT_TEMPLATES.map((template) => {
          const Icon = ICONS[template.key] ?? RobotIcon;
          const active = template.key === selected.key;
          return (
            <button
              key={template.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelectedKey(template.key)}
              className={cn(
                "flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary/5 ring-2 ring-primary"
                  : "ring-border hover:bg-muted/50"
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {template.name}
                  </span>
                  {added.has(template.name) ? (
                    <Badge variant="secondary" className="shrink-0">
                      Added
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {template.summary}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Suits </span>
            {selected.suitedTo}.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Front desk hands over when{" "}
            </span>
            {selected.routingDescription}.
          </p>
          {selected.setupHint ? (
            <p className="flex gap-1.5">
              <InfoIcon className="mt-px size-3.5 shrink-0" />
              {selected.setupHint}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-bot-name">
            Name customers see{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="template-bot-name"
            value={botName}
            placeholder={selected.botName}
            onChange={(event) => setBotName(event.target.value)}
          />
        </div>

        <Button onClick={() => void create()} disabled={busy}>
          {busy ? <Spinner /> : <PlusIcon />} Create{" "}
          {botName.trim() || selected.botName} · {selected.role}
        </Button>
      </div>
    </div>
  );
}
