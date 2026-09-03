"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BUILTIN_TOOLS, CHAT_MODELS } from "@/convex/lib/shared";
import { useWorkspace } from "@/components/workspace-provider";
import { ChipListEditor, StringListEditor } from "@/components/editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Slider } from "@/components/ui/slider";
import { SelectField } from "@/components/select-field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
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
import { toast } from "@/components/ui/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FloppyDiskIcon,
  ChatsIcon,
  TrashIcon,
  ArrowLeftIcon,
  WrenchIcon,
  SignpostIcon,
  WarningIcon,
} from "@phosphor-icons/react";

// Slider reports either a scalar or a tuple depending on how it is driven.
function firstNumber(value: number | readonly number[]): number {
  return Array.isArray(value) ? value[0] : (value as number);
}

const TONE_TRAIT_SUGGESTIONS = [
  "professional",
  "warm",
  "concise",
  "consultative",
  "patient",
  "confident",
  "empathetic",
  "playful",
];
const TONE_AVOID_SUGGESTIONS = [
  "pushy",
  "robotic",
  "over-enthusiastic",
  "condescending",
  "vague",
  "salesy",
];

type Draft = {
  name: string;
  botName: string;
  role: string;
  routingDescription: string;
  acceptsHandoff: boolean;
  objective: string;
  jobDescription: string;
  greeting: string;
  tone: {
    traits: string[];
    avoid: string[];
    formality: "casual" | "neutral" | "formal";
    emoji: "none" | "sparing" | "expressive";
    responseLength: "short" | "medium" | "detailed";
    languages: string[];
    mirrorUserLanguage: boolean;
    humanVoice: boolean;
  };
  rules: string[];
  guardrails: string[];
  escalationPolicy: string;
  promptOverride: string;
  model: string;
  temperature: number;
  maxSteps: number;
  historyLimit: number;
  knowledgeEnabled: boolean;
  knowledgeTopK: number;
  builtinTools: string[];
  status: "draft" | "active" | "paused";
};

export default function AgentConfigPage({
  params,
}: PageProps<"/w/[slug]/agents/[agentId]">) {
  const { agentId } = use(params);
  const workspace = useWorkspace();
  const router = useRouter();
  const base = `/w/${workspace.slug}`;

  const typedAgentId = agentId as Id<"agents">;
  const agent = useQuery(api.agents.get, { agentId: typedAgentId });
  const promptPreview = useQuery(api.agents.previewPrompt, {
    agentId: typedAgentId,
  });
  const customTools = useQuery(api.tools.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const updateAgent = useMutation(api.agents.update);
  const removeAgent = useMutation(api.agents.remove);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the editable draft from the server document, and re-seed if a
  // different agent is opened. Adjusting state during render rather than in an
  // effect is the supported pattern: React discards this render pass and
  // immediately re-runs it, so nothing extra is committed.
  if (agent && draftFor !== agent._id) {
    setDraftFor(agent._id);
    setDraft({
      name: agent.name,
      botName: agent.botName,
      role: agent.role,
      routingDescription: agent.routingDescription ?? "",
      // Absent means "yes": every agent is a handoff target unless it has been
      // taken out of the roster.
      acceptsHandoff: agent.acceptsHandoff !== false,
      objective: agent.objective,
      jobDescription: agent.jobDescription,
      greeting: agent.greeting ?? "",
      // Absent on every agent saved before the setting existed.
      tone: { ...agent.tone, humanVoice: agent.tone.humanVoice ?? false },
      rules: agent.rules,
      guardrails: agent.guardrails,
      escalationPolicy: agent.escalationPolicy ?? "",
      promptOverride: agent.promptOverride ?? "",
      model: agent.model,
      temperature: agent.temperature,
      maxSteps: agent.maxSteps,
      historyLimit: agent.historyLimit,
      knowledgeEnabled: agent.knowledgeEnabled,
      knowledgeTopK: agent.knowledgeTopK,
      builtinTools: agent.builtinTools,
      status: agent.status,
    });
  }

  if (agent === undefined || !draft) {
    return (
      <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading agent…
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This agent no longer exists.{" "}
        <Link href={`${base}/agents`} className="underline">
          Back to agents
        </Link>
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const setTone = <K extends keyof Draft["tone"]>(
    key: K,
    value: Draft["tone"][K]
  ) =>
    setDraft((prev) =>
      prev ? { ...prev, tone: { ...prev.tone, [key]: value } } : prev
    );

  const save = async () => {
    setSaving(true);
    try {
      await updateAgent({
        agentId: typedAgentId,
        name: draft.name,
        botName: draft.botName,
        role: draft.role,
        routingDescription: draft.routingDescription || undefined,
        acceptsHandoff: draft.acceptsHandoff,
        objective: draft.objective,
        jobDescription: draft.jobDescription,
        greeting: draft.greeting || undefined,
        tone: draft.tone,
        rules: draft.rules,
        guardrails: draft.guardrails,
        escalationPolicy: draft.escalationPolicy || undefined,
        promptOverride: draft.promptOverride || undefined,
        model: draft.model,
        temperature: draft.temperature,
        maxSteps: draft.maxSteps,
        historyLimit: draft.historyLimit,
        knowledgeEnabled: draft.knowledgeEnabled,
        knowledgeTopK: draft.knowledgeTopK,
        builtinTools: draft.builtinTools,
        status: draft.status,
      });
      toast.add({ title: "Agent saved", type: "success" });
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleBuiltin = (key: string) => {
    set(
      "builtinTools",
      draft.builtinTools.includes(key)
        ? draft.builtinTools.filter((k) => k !== key)
        : [...draft.builtinTools, key]
    );
  };

  const scopedCustomTools = (customTools ?? []).filter(
    (tool) => tool.agentId === undefined || tool.agentId === typedAgentId
  );

  const isRouter = agent.kind === "router";
  // The roster the prompt preview was compiled against, so the Routing tab and
  // the compiled prompt can never disagree.
  const team = promptPreview?.team ?? [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label="Back to agents"
            nativeButton={false}
            render={<Link href={`${base}/agents`} />}
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate font-heading text-lg font-semibold tracking-tight">
              {draft.botName || draft.name}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {draft.role}
            </p>
          </div>
          <Badge
            variant={draft.status === "active" ? "default" : "secondary"}
          >
            {draft.status}
          </Badge>
          {isRouter ? <Badge variant="secondary">Front desk</Badge> : null}
        </div>

        <div className="flex items-center gap-2">
          <SelectField
            size="sm"
            value={draft.status}
            aria-label="Agent status"
            onValueChange={(next) => set("status", next as Draft["status"])}
            options={
              isRouter
                ? [
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                  ]
                : [
                    { value: "draft", label: "Draft" },
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                  ]
            }
          />
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agentId}/test`} />}
          >
            <ChatsIcon /> Test in chat
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <FloppyDiskIcon />} Save
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <Tabs defaultValue="identity" className="gap-4">
          <TabsList>
            <TabsTrigger value="identity">Identity</TabsTrigger>
            <TabsTrigger value="routing">Routing</TabsTrigger>
            <TabsTrigger value="tone">Tone</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="capabilities">Knowledge & tools</TabsTrigger>
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="prompt">Compiled prompt</TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------- Identity */}
          <TabsContent value="identity" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Who the agent is</CardTitle>
                <CardDescription>
                  The bot name and role are stated in the first line of the
                  system prompt.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="f-name">Internal name</Label>
                    <Input
                      id="f-name"
                      value={draft.name}
                      onChange={(event) => set("name", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="f-botname">Name customers see</Label>
                    <Input
                      id="f-botname"
                      value={draft.botName}
                      onChange={(event) => set("botName", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="f-role">Role</Label>
                    <Input
                      id="f-role"
                      value={draft.role}
                      onChange={(event) => set("role", event.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-objective">Objective</Label>
                  <Textarea
                    id="f-objective"
                    rows={2}
                    value={draft.objective}
                    onChange={(event) => set("objective", event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    What a successful conversation achieves.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-job">Job description</Label>
                  <Textarea
                    id="f-job"
                    rows={6}
                    value={draft.jobDescription}
                    onChange={(event) =>
                      set("jobDescription", event.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The step-by-step work: how to open, what to qualify, what to
                    collect, how to close.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-greeting">Opening line</Label>
                  <Input
                    id="f-greeting"
                    value={draft.greeting}
                    placeholder={`Hello, you're through to ${draft.botName} at ${workspace.name}. How can I help?`}
                    onChange={(event) => set("greeting", event.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ----------------------------------------------------- Routing */}
          <TabsContent value="routing" className="flex flex-col gap-4">
            {isRouter ? (
              <>
                <Alert>
                  <SignpostIcon />
                  <AlertTitle>This is the front desk</AlertTitle>
                  <AlertDescription>
                    It answers first on every channel pointed at it, then hands
                    the conversation to one of the agents below. It cannot be
                    handed a conversation itself, and it stays active — a paused
                    front desk would silently drop every inbound message.
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle>Who it can hand over to</CardTitle>
                    <CardDescription>
                      Exactly what the model is shown when it decides. An agent
                      appears here only while it is active and in the roster;
                      each one&apos;s handover rule is edited on its own Routing
                      tab.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {team.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No agent is available to take a conversation, so the
                        front desk will answer everything itself. Set an agent to
                        active to give it somewhere to route.
                      </p>
                    ) : (
                      <ItemGroup>
                        {team.map((mate) => (
                          <Item key={mate.key} variant="outline">
                            <ItemContent>
                              <ItemTitle className="flex flex-wrap items-center gap-2">
                                {mate.botName}
                                <Badge variant="secondary" className="font-mono">
                                  {mate.key}
                                </Badge>
                              </ItemTitle>
                              <ItemDescription>
                                {mate.role}
                                {mate.whenToUse?.trim()
                                  ? ` · Hand over when: ${mate.whenToUse}`
                                  : " · No handover rule set — only the role above to go on."}
                              </ItemDescription>
                            </ItemContent>
                          </Item>
                        ))}
                      </ItemGroup>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>When this agent takes over</CardTitle>
                    <CardDescription>
                      The one line the front desk reads when choosing who deals
                      with a conversation. Write it as a condition, not a
                      description of the job.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="f-routing">Hand over to this agent when…</Label>
                      <Textarea
                        id="f-routing"
                        rows={3}
                        value={draft.routingDescription}
                        placeholder="the customer asks about a price, a quote, or wants to place an order"
                        onChange={(event) =>
                          set("routingDescription", event.target.value)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave it blank and the front desk has only the role to go
                        on, which routes badly once you have more than one agent.
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                      <div className="min-w-0">
                        <Label htmlFor="f-accepts" className="text-sm">
                          Available for routing
                        </Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Off takes this agent out of every roster. It keeps
                          working on any channel pointed straight at it, but
                          nobody will hand it a conversation.
                        </p>
                      </div>
                      <Switch
                        id="f-accepts"
                        checked={draft.acceptsHandoff}
                        onCheckedChange={(checked) =>
                          set("acceptsHandoff", checked)
                        }
                      />
                    </div>

                    {draft.status !== "active" ? (
                      <Alert>
                        <WarningIcon />
                        <AlertTitle>Draft and paused agents get no traffic</AlertTitle>
                        <AlertDescription>
                          Only active agents appear in the front desk&apos;s
                          roster. Set the status to Active when it is ready.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Who this agent can hand on to</CardTitle>
                    <CardDescription>
                      An agent that finds itself with the wrong conversation can
                      pass it on once, as long as{" "}
                      <span className="font-mono text-xs">
                        transfer_to_agent
                      </span>{" "}
                      is enabled under Knowledge &amp; tools. A conversation is
                      never handed back to an agent that already had it in the
                      same message.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!draft.builtinTools.includes("transfer_to_agent") ? (
                      <p className="text-sm text-muted-foreground">
                        Handover is switched off for this agent — it will answer
                        everything it is given.
                      </p>
                    ) : team.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No other agent is available to take a conversation.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {team.map((mate) => (
                          <Badge key={mate.key} variant="secondary">
                            {mate.botName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* -------------------------------------------------------- Tone */}
          <TabsContent value="tone" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Voice and tone</CardTitle>
                <CardDescription>
                  These settings compile into explicit style instructions.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <ChipListEditor
                    label="Should sound"
                    value={draft.tone.traits}
                    onChange={(next) => setTone("traits", next)}
                    suggestions={TONE_TRAIT_SUGGESTIONS}
                    placeholder="professional"
                  />
                  <ChipListEditor
                    label="Should never sound"
                    value={draft.tone.avoid}
                    onChange={(next) => setTone("avoid", next)}
                    suggestions={TONE_AVOID_SUGGESTIONS}
                    placeholder="pushy"
                  />
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="f-formality">Formality</Label>
                    <SelectField
                      id="f-formality"
                      className="w-full"
                      value={draft.tone.formality}
                      onValueChange={(next) =>
                        setTone(
                          "formality",
                          next as Draft["tone"]["formality"]
                        )
                      }
                      options={[
                        { value: "casual", label: "Casual" },
                        { value: "neutral", label: "Neutral" },
                        { value: "formal", label: "Formal" },
                      ]}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="f-emoji">Emoji</Label>
                    <SelectField
                      id="f-emoji"
                      className="w-full"
                      value={draft.tone.emoji}
                      onValueChange={(next) =>
                        setTone("emoji", next as Draft["tone"]["emoji"])
                      }
                      options={[
                        { value: "none", label: "Never" },
                        { value: "sparing", label: "Sparing" },
                        { value: "expressive", label: "Expressive" },
                      ]}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="f-length">Reply length</Label>
                    <SelectField
                      id="f-length"
                      className="w-full"
                      value={draft.tone.responseLength}
                      onValueChange={(next) =>
                        setTone(
                          "responseLength",
                          next as Draft["tone"]["responseLength"]
                        )
                      }
                      options={[
                        { value: "short", label: "Short — 1–2 sentences" },
                        { value: "medium", label: "Medium — 2–4 sentences" },
                        {
                          value: "detailed",
                          label: "Detailed — short paragraphs",
                        },
                      ]}
                    />
                  </div>
                </div>

                <ChipListEditor
                  label="Languages"
                  value={draft.tone.languages}
                  onChange={(next) => setTone("languages", next)}
                  suggestions={["english", "hinglish", "hindi", "german"]}
                  placeholder="english"
                />

                <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                  <div>
                    <Label className="text-sm font-medium">
                      Mirror the customer&apos;s language
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Reply in whatever language and register they write in,
                      including mixed languages like Hinglish.
                    </p>
                  </div>
                  <Switch
                    checked={draft.tone.mirrorUserLanguage}
                    onCheckedChange={(checked) =>
                      setTone("mirrorUserLanguage", checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                  <div>
                    <Label className="text-sm font-medium">Human voice</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Short, unpolished replies that read as typed by a
                      colleague: no &quot;I&apos;m an AI assistant&quot; opener,
                      no sign-offs, no tidy lists. Reads best with a casual or
                      neutral formality. Asked outright whether they are talking
                      to an AI, the agent still says so.
                    </p>
                  </div>
                  <Switch
                    checked={draft.tone.humanVoice}
                    onCheckedChange={(checked) => setTone("humanVoice", checked)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------- Rules */}
          <TabsContent value="rules" className="flex flex-col gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Always</CardTitle>
                  <CardDescription>
                    Business-specific instructions the agent must follow. A set of
                    universal safety rules is appended automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StringListEditor
                    label="Rules"
                    value={draft.rules}
                    onChange={(next) => set("rules", next)}
                    placeholder="Ask for the delivery postcode before discussing lead times"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Never</CardTitle>
                  <CardDescription>
                    Hard guardrails. Also appended to automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StringListEditor
                    label="Guardrails"
                    value={draft.guardrails}
                    onChange={(next) => set("guardrails", next)}
                    placeholder="Never quote a price, even an estimate"
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Escalation and overrides</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-escalation">Escalation policy</Label>
                  <Textarea
                    id="f-escalation"
                    rows={3}
                    value={draft.escalationPolicy}
                    onChange={(event) =>
                      set("escalationPolicy", event.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-override">
                    Additional instructions (appended verbatim)
                  </Label>
                  <Textarea
                    id="f-override"
                    rows={5}
                    className="font-mono"
                    value={draft.promptOverride}
                    onChange={(event) =>
                      set("promptOverride", event.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    An escape hatch for anything the structured fields
                    can&apos;t express.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------ Capabilities */}
          <TabsContent value="capabilities" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Knowledge retrieval</CardTitle>
                <CardDescription>
                  Every incoming message is embedded and matched against this
                  workspace&apos;s knowledge chunks before the model runs.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                  <div>
                    <Label className="text-sm font-medium">
                      Retrieve knowledge automatically
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Off means the agent can only reach the knowledge base via
                      the <code>search_knowledge</code> tool.
                    </p>
                  </div>
                  <Switch
                    checked={draft.knowledgeEnabled}
                    onCheckedChange={(checked) =>
                      set("knowledgeEnabled", checked)
                    }
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">
                    Passages per lookup — {draft.knowledgeTopK}
                  </Label>
                  <Slider
                    value={[draft.knowledgeTopK]}
                    min={1}
                    max={12}
                    step={1}
                    onValueChange={(value) => set("knowledgeTopK", firstNumber(value))}
                  />
                </div>

                <Button
                  variant="outline"
                  size="lg"
                  className="self-start"
                  nativeButton={false}
                  render={<Link href={`${base}/knowledge`} />}
                >
                  Manage knowledge sources
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Builtin tools</CardTitle>
                <CardDescription>
                  Only enabled tools are handed to the model. Descriptions shown
                  here are what the model reads.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ItemGroup className="gap-2">
                  {BUILTIN_TOOLS.map((builtin) => (
                    <Item key={builtin.key} variant="outline">
                      <ItemContent>
                        <ItemTitle className="flex flex-wrap items-center gap-2">
                          <span className="font-mono">{builtin.key}</span>
                          <span className="text-muted-foreground">
                            {builtin.label}
                          </span>
                        </ItemTitle>
                        <ItemDescription>{builtin.summary}</ItemDescription>
                      </ItemContent>
                      <Switch
                        checked={draft.builtinTools.includes(builtin.key)}
                        onCheckedChange={() => toggleBuiltin(builtin.key)}
                      />
                    </Item>
                  ))}
                </ItemGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Custom tools available here</CardTitle>
                <CardDescription>
                  Workspace-wide tools plus any scoped to this agent. Enable and
                  edit them on the Custom tools page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {customTools === undefined ? (
                  <Spinner />
                ) : scopedCustomTools.length === 0 ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-muted-foreground">
                      No custom tools yet.
                    </p>
                    <Button
                      size="lg"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={`${base}/tools`} />}
                    >
                      <WrenchIcon /> Create one from a task description
                    </Button>
                  </div>
                ) : (
                  <ItemGroup className="gap-2">
                    {scopedCustomTools.map((tool) => (
                      <Item key={tool._id} variant="outline">
                        <ItemContent>
                          <ItemTitle className="flex flex-wrap items-center gap-2">
                            <span className="font-mono">{tool.name}</span>
                            <Badge
                              variant={
                                tool.status === "enabled"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {tool.status}
                            </Badge>
                            <Badge variant="outline">{tool.kind}</Badge>
                            {tool.agentId ? (
                              <Badge variant="secondary">agent-scoped</Badge>
                            ) : null}
                          </ItemTitle>
                          <ItemDescription className="line-clamp-2">
                            {tool.description}
                          </ItemDescription>
                        </ItemContent>
                        <Button
                          size="lg"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link href={`${base}/tools`} />}
                        >
                          Edit
                        </Button>
                      </Item>
                    ))}
                  </ItemGroup>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------- Model */}
          <TabsContent value="model" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Model settings</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-model">Chat model</Label>
                  <SelectField
                    id="f-model"
                    className="w-full max-w-sm"
                    value={draft.model}
                    onValueChange={(next) => set("model", next)}
                    options={CHAT_MODELS.map((model) => ({
                      value: model.id,
                      label: model.label,
                    }))}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">
                    Temperature — {draft.temperature.toFixed(2)}
                  </Label>
                  <Slider
                    value={[draft.temperature]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(value) => set("temperature", firstNumber(value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower is more consistent. 0.3–0.5 suits qualification bots.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label className="text-sm font-medium">
                      Tool-loop budget — {draft.maxSteps} steps
                    </Label>
                    <Slider
                      value={[draft.maxSteps]}
                      min={1}
                      max={12}
                      step={1}
                      onValueChange={(value) => set("maxSteps", firstNumber(value))}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-sm font-medium">
                      History replayed — {draft.historyLimit} messages
                    </Label>
                    <Slider
                      value={[draft.historyLimit]}
                      min={2}
                      max={40}
                      step={2}
                      onValueChange={(value) => set("historyLimit", firstNumber(value))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
                <CardDescription>
                  Deleting an agent also deletes its conversations, channels,
                  agent-scoped knowledge and agent-scoped tools.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="destructive">
                        <TrashIcon /> Delete this agent
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete {draft.botName}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. Its conversations, channels and
                        agent-scoped knowledge and tools are removed too.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
                      <AlertDialogAction
                        render={
                          <Button
                            variant="destructive"
                            onClick={async () => {
                              await removeAgent({ agentId: typedAgentId });
                              toast.add({
                                title: "Agent deleted",
                                type: "success",
                              });
                              router.push(`${base}/agents`);
                            }}
                          >
                            Delete permanently
                          </Button>
                        }
                      />
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------ Prompt */}
          <TabsContent value="prompt" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Compiled system prompt</CardTitle>
                <CardDescription>
                  Exactly what the model receives, built from the saved
                  configuration. Save your changes to refresh it.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {promptPreview === undefined ? (
                  <Spinner />
                ) : promptPreview === null ? (
                  <p className="text-sm text-muted-foreground">
                    Unavailable.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {promptPreview.toolNames.map((name) => (
                        <Badge
                          key={name}
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {name}
                        </Badge>
                      ))}
                      {promptPreview.toolNames.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          No tools enabled
                        </span>
                      ) : null}
                    </div>
                    <pre className="max-h-[32rem] overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
                      {promptPreview.prompt}
                    </pre>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
