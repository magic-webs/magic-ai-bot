"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentTemplatePicker } from "@/components/agent-templates";
import { StringListEditor } from "@/components/editors";
import { FormRow, NothingYet } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { stepHref } from "@/lib/onboarding";
import {
  ArrowRightIcon,
  CardsIcon,
  PlusIcon,
  SlidersIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * Step 3 — the agents.
 *
 * The platform's shape, which this step has to make visible before any of the
 * fields make sense: every workspace has exactly one front desk, it answers
 * first on every channel, and it hands the conversation to a specialist and
 * then says nothing more. What it picks from is nothing but each specialist's
 * "hand over to me when…" line — so that field, which looks like documentation,
 * is the entire routing table. An agent without one is invisible to the front
 * desk, and an agent left on draft receives nothing at all.
 *
 * Both are easy to do by accident and produce a workspace that looks configured
 * and answers nothing, which is why each is a required check and each is called
 * out on the row it belongs to.
 *
 * Model, temperature, tools and tone are not here. They have a page of their
 * own and they all have working defaults; this step is only the part a new
 * workspace cannot be useful without.
 */

type Gender = "male" | "female";

type Draft = {
  name: string;
  botName: string;
  gender: Gender | null;
  role: string;
  objective: string;
  jobDescription: string;
  routingDescription: string;
  rules: string[];
  guardrails: string[];
};

const EMPTY: Draft = {
  name: "",
  botName: "",
  gender: null,
  role: "",
  objective: "",
  jobDescription: "",
  routingDescription: "",
  rules: [],
  guardrails: [],
};

const draftFrom = (agent: Doc<"agents">): Draft => ({
  name: agent.name,
  botName: agent.botName,
  gender: agent.gender ?? null,
  role: agent.role,
  objective: agent.objective,
  jobDescription: agent.jobDescription,
  routingDescription: agent.routingDescription ?? "",
  rules: agent.rules,
  guardrails: agent.guardrails,
});

/**
 * The persona / job / rules form, for a new agent and for an existing one.
 *
 * One component for both, because the two differ only in what seeds them and
 * which mutation they post to — and an "edit" form that drifted from the
 * "create" form is how a field ends up settable once and never correctable.
 */
function AgentForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(draft);
    } catch (error) {
      toast.add({
        title: "Could not save the agent",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow
          label="Agent name"
          hint="Your name for it. Customers never see this one."
        >
          <Input
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Sales qualifier"
          />
        </FormRow>
        <FormRow
          label="Name customers see"
          optional
          hint="A first name reads better than a job title. Left empty it uses the agent name."
        >
          <Input
            value={draft.botName}
            onChange={(event) => set("botName", event.target.value)}
            placeholder="Priya"
          />
        </FormRow>
      </div>

      <FormRow
        label="Face"
        optional
        hint="Picks the avatar and nothing else — no prompt reads it."
      >
        <div className="flex gap-1.5">
          {(["female", "male"] as const).map((gender) => (
            <Button
              key={gender}
              type="button"
              size="sm"
              variant={draft.gender === gender ? "secondary" : "outline"}
              onClick={() =>
                set("gender", draft.gender === gender ? null : gender)
              }
            >
              {gender === "female" ? "Female" : "Male"}
            </Button>
          ))}
        </div>
      </FormRow>

      <FormRow label="Role" optional>
        <Input
          value={draft.role}
          onChange={(event) => set("role", event.target.value)}
          placeholder="AI sales consultant"
        />
      </FormRow>

      <FormRow
        label="What counts as a good conversation"
        optional
        hint="The agent's own measure of success."
      >
        <Textarea
          rows={2}
          value={draft.objective}
          onChange={(event) => set("objective", event.target.value)}
          placeholder="Work out what the customer needs, quote from the catalogue, and capture a complete enquiry."
        />
      </FormRow>

      <FormRow
        label="The job, step by step"
        optional
        hint="Written as instructions to a new colleague on their first day."
      >
        <Textarea
          rows={4}
          value={draft.jobDescription}
          onChange={(event) => set("jobDescription", event.target.value)}
          placeholder={
            "Greet the customer.\nAsk what they are making and how many.\nCheck the catalogue before quoting.\nConfirm everything back, then record the enquiry."
          }
        />
      </FormRow>

      <FormRow
        label="Hand over to me when…"
        hint="The front desk picks an agent from these lines alone. An agent without one never receives a conversation."
      >
        <Textarea
          rows={2}
          value={draft.routingDescription}
          onChange={(event) => set("routingDescription", event.target.value)}
          placeholder="the customer asks about pricing, quantities, lead times or anything in the catalogue"
        />
      </FormRow>

      <StringListEditor
        label="Always"
        description="Hard instructions, added to every reply this agent writes."
        value={draft.rules}
        onChange={(rules) => set("rules", rules)}
        placeholder="Quote only prices stored on the product"
      />

      <StringListEditor
        label="Never"
        description="Hard limits, not preferences."
        value={draft.guardrails}
        onChange={(guardrails) => set("guardrails", guardrails)}
        placeholder="Promise a delivery date you have not been given"
      />

      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={busy || !draft.name.trim()}>
          {busy ? <Spinner /> : null}
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One specialist, with whatever is stopping it from taking traffic. */
function AgentRow({
  agent,
  slug,
  editing,
  onToggleEdit,
  onSaved,
}: {
  agent: Doc<"agents">;
  slug: string;
  editing: boolean;
  onToggleEdit: () => void;
  onSaved: () => void;
}) {
  const updateAgent = useMutation(api.agents.update);
  const [busy, setBusy] = useState(false);

  const live = agent.status === "active";
  const unrouted = !agent.routingDescription?.trim();

  if (editing) {
    return (
      <AgentForm
        initial={draftFrom(agent)}
        submitLabel="Save changes"
        onCancel={onToggleEdit}
        onSubmit={async (draft) => {
          await updateAgent({
            agentId: agent._id,
            name: draft.name.trim(),
            botName: draft.botName.trim() || draft.name.trim(),
            gender: draft.gender ?? undefined,
            role: draft.role.trim(),
            objective: draft.objective.trim(),
            jobDescription: draft.jobDescription.trim(),
            routingDescription: draft.routingDescription.trim(),
            rules: draft.rules,
            guardrails: draft.guardrails,
          });
          toast.add({ title: `${draft.name.trim()} saved`, type: "success" });
          onSaved();
        }}
      />
    );
  }

  const setStatus = async (status: "active" | "paused") => {
    setBusy(true);
    try {
      await updateAgent({ agentId: agent._id, status });
      toast.add({
        title: status === "active" ? `${agent.name} is live` : `${agent.name} paused`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not change the status",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <AgentAvatar name={agent.botName} gender={agent.gender} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{agent.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent.role} · speaks as {agent.botName}
          </p>
        </div>
        <Badge variant={live ? "secondary" : "outline"}>
          {live ? "live" : agent.status}
        </Badge>
      </div>

      {unrouted ? (
        <Alert>
          <WarningIcon />
          <AlertTitle className="font-normal">
            No “hand over to me when…” line, so the front desk will never send
            this agent a conversation.
          </AlertTitle>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onToggleEdit}>
          Edit persona
        </Button>
        {live ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void setStatus("paused")}
          >
            Pause
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void setStatus("active")}>
            {busy ? <Spinner /> : null} Go live
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          nativeButton={false}
          render={<Link href={`/w/${slug}/agents/${agent._id}`} />}
        >
          <SlidersIcon /> Full settings
        </Button>
      </div>
    </div>
  );
}

export function AgentsStep() {
  const workspace = useWorkspace();
  const router = useRouter();
  const createAgent = useMutation(api.agents.create);
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  // Two ways in: a pre-drafted role, created whole, or the form below.
  const [adding, setAdding] = useState<"template" | "form" | null>(null);
  const [editingId, setEditingId] = useState<Id<"agents"> | null>(null);

  if (agents === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading agents…
      </div>
    );
  }

  const kindOf = (agent: Doc<"agents">) => agent.kind ?? "specialist";
  const specialists = agents.filter((agent) => kindOf(agent) === "specialist");
  const frontDesk = agents.find((agent) => kindOf(agent) === "router");
  const followUp = agents.find((agent) => kindOf(agent) === "follow_up");
  const anyLive = specialists.some((agent) => agent.status === "active");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>The desks you are given</CardTitle>
          <CardDescription>
            Provisioned with your first agent. Neither is configured here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {frontDesk || followUp ? (
            <>
              {frontDesk ? (
                <div className="flex items-center gap-3">
                  <AgentAvatar
                    name={frontDesk.botName}
                    gender={frontDesk.gender}
                    greeter
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {frontDesk.botName} · front desk
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Answers first, then hands over silently
                    </p>
                  </div>
                  <Badge variant="secondary">ready</Badge>
                </div>
              ) : null}
              {frontDesk && followUp ? <Separator /> : null}
              {followUp ? (
                <div className="flex items-center gap-3">
                  <AgentAvatar
                    name={followUp.botName}
                    gender={followUp.gender}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {followUp.botName} · follow-up desk
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Files quiet leads and writes the nudge
                    </p>
                  </div>
                  <Badge variant="secondary">ready</Badge>
                </div>
              ) : null}
            </>
          ) : (
            <NothingYet>
              Your first agent brings the front desk and the follow-up desk with
              it — there is nothing to set up for either.
            </NothingYet>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your agents</CardTitle>
          <CardDescription>
            One per block of work. Two narrow agents beat one that does
            everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {specialists.length === 0 && !adding ? (
            <NothingYet>
              No agents yet. Most workspaces start with one that handles
              enquiries and quotes — the Sales assistant or Lead qualifier
              template is a quick way in.
            </NothingYet>
          ) : null}

          {specialists.map((agent) => (
            <AgentRow
              key={agent._id}
              agent={agent}
              slug={workspace.slug}
              editing={editingId === agent._id}
              onToggleEdit={() =>
                setEditingId((current) =>
                  current === agent._id ? null : agent._id
                )
              }
              onSaved={() => setEditingId(null)}
            />
          ))}

          {adding === "template" ? (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
              <AgentTemplatePicker onCreated={() => setAdding(null)} />
              <Button
                variant="ghost"
                className="self-start"
                onClick={() => setAdding(null)}
              >
                Cancel
              </Button>
            </div>
          ) : adding === "form" ? (
            <AgentForm
              initial={EMPTY}
              submitLabel="Create agent"
              onCancel={() => setAdding(null)}
              onSubmit={async (draft) => {
                await createAgent({
                  workspaceId: workspace._id,
                  name: draft.name.trim(),
                  botName: draft.botName.trim() || undefined,
                  gender: draft.gender ?? undefined,
                  role: draft.role.trim() || undefined,
                  objective: draft.objective.trim() || undefined,
                  jobDescription: draft.jobDescription.trim() || undefined,
                  routingDescription:
                    draft.routingDescription.trim() || undefined,
                  rules: draft.rules,
                  guardrails: draft.guardrails,
                });
                toast.add({
                  title: `${draft.name.trim()} created`,
                  description: "It starts as a draft — take it live when it reads right.",
                  type: "success",
                });
                setAdding(null);
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setAdding("template")}>
                <CardsIcon /> Start from a template
              </Button>
              <Button variant="ghost" onClick={() => setAdding("form")}>
                <PlusIcon /> Write your own
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {specialists.length > 0 && !anyLive ? (
        <Alert>
          <WarningIcon />
          <AlertTitle className="font-normal">
            Every agent is still a draft, and a draft receives no traffic — take
            the one that should start answering live.
          </AlertTitle>
        </Alert>
      ) : null}

      <div>
        <Button onClick={() => router.push(stepHref(workspace.slug, "knowledge"))}>
          Continue <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}
