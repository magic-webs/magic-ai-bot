"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { BUILTIN_TOOLS } from "@/convex/lib/shared";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { AgentAvatar } from "@/components/agent-avatar";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { CardGridSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowsSplitIcon,
  ChatsIcon,
  CheckCircleIcon,
  ClockIcon,
  CrosshairSimpleIcon,
  DotsThreeVerticalIcon,
  FunnelIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RobotIcon,
  SignpostIcon,
  SlidersIcon,
  SparkleIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  WarningIcon,
} from "@phosphor-icons/react";

type Agent = Doc<"agents">;

/** Per-agent row from api.agents.roster, once looked up by id. */
type AgentStats = {
  conversations: number;
  resolutionRate: number | null;
  avgLatencyMs: number | null;
};

const SORTS = [
  { value: "updated", label: "Last updated" },
  { value: "name", label: "Name" },
  { value: "conversations", label: "Conversations" },
];

const TOOL_LABELS = new Map(BUILTIN_TOOLS.map((tool) => [tool.key, tool.label]));

/**
 * Whether to print ⌘ or Ctrl on the search hint.
 *
 * The user agent is an external source, so it is read through
 * useSyncExternalStore rather than in an effect: the server snapshot is ⌘, and
 * React swaps in the real one on hydration instead of warning about a mismatch.
 */
const noopSubscribe = () => () => {};

function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent),
    () => true
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** 1.2K rather than 1,203: these sit in a chip, not a table. */
function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}K`;
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}

/** Sub-second answers are the interesting case, so they keep a decimal. */
function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.round(ms / 1000)}s`;
}

function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-4xl px-2 py-0.5 text-xs font-medium capitalize ring-1",
        active
          ? "bg-primary/10 text-primary ring-primary/20"
          : "bg-muted text-muted-foreground ring-border",
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-primary" : "bg-muted-foreground/50"
        )}
      />
      {status}
    </span>
  );
}

/** The white chips under the front desk's paragraph. */
function StatChip({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-foreground/10">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="font-heading text-base leading-none font-semibold">
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

/** The three figures across the bottom of an agent card. */
function StatFigure({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="font-heading text-sm leading-none font-semibold">
          {value}
        </div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New agent
// ---------------------------------------------------------------------------

function NewAgentDialog() {
  const workspace = useWorkspace();
  const router = useRouter();
  const createAgent = useMutation(api.agents.create);
  const draftAgent = useAction(api.ai.draftAgent);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({
    name: "",
    botName: "",
    role: "",
    routingDescription: "",
  });
  const [brief, setBrief] = useState("");

  const base = `/w/${workspace.slug}`;

  const createManual = async () => {
    if (!manual.name.trim()) {
      toast.add({ title: "Give the agent a name", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const agentId = await createAgent({
        workspaceId: workspace._id,
        name: manual.name,
        botName: manual.botName || undefined,
        role: manual.role || undefined,
        routingDescription: manual.routingDescription || undefined,
      });
      setOpen(false);
      router.push(`${base}/agents/${agentId}`);
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

  const createFromBrief = async () => {
    if (brief.trim().length < 20) {
      toast.add({
        title: "Describe the job in a bit more detail",
        description: "A sentence or two about what this agent should do.",
        type: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const { agentId, draft } = await draftAgent({
        workspaceId: workspace._id,
        brief,
      });
      toast.add({
        title: `${draft.botName} drafted`,
        description: "Review the configuration, then set it to active.",
        type: "success",
      });
      setOpen(false);
      if (agentId) router.push(`${base}/agents/${agentId}`);
    } catch (error) {
      toast.add({
        title: "Drafting failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg"><PlusIcon /> New agent</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Describe the job and let the model draft the whole configuration, or
            start from a blank agent.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="draft">
          <TabsList className="w-full">
            <TabsTrigger value="draft">
              <SparkleIcon /> Draft from a brief
            </TabsTrigger>
            <TabsTrigger value="manual">
              <SlidersIcon /> Blank agent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draft" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brief">What should this agent do?</Label>
              <Textarea
                id="brief"
                rows={5}
                value={brief}
                placeholder="Qualify inbound printing enquiries on WhatsApp. Find out the product, quantity and specs, never quote a price, collect delivery details, then hand a complete enquiry to the sales team."
                onChange={(event) => setBrief(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The draft uses this workspace&apos;s description, facts and
                catalogue as context.
              </p>
            </div>
            <Button onClick={createFromBrief} disabled={busy}>
              {busy ? <Spinner /> : <SparkleIcon />} Draft the agent
            </Button>
          </TabsContent>

          <TabsContent value="manual" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name">Internal name</Label>
              <Input
                id="agent-name"
                value={manual.name}
                placeholder="Sales qualifier"
                onChange={(event) =>
                  setManual((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bot-name">Name customers see</Label>
                <Input
                  id="bot-name"
                  value={manual.botName}
                  placeholder="John"
                  onChange={(event) =>
                    setManual((prev) => ({
                      ...prev,
                      botName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-role">Role</Label>
                <Input
                  id="agent-role"
                  value={manual.role}
                  placeholder="AI Sales Consultant"
                  onChange={(event) =>
                    setManual((prev) => ({ ...prev, role: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-routing">Front desk hands over when…</Label>
              <Textarea
                id="agent-routing"
                rows={2}
                value={manual.routingDescription}
                placeholder="the customer wants a quote, a price, or to place an order"
                onChange={(event) =>
                  setManual((prev) => ({
                    ...prev,
                    routingDescription: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                This is the only thing the front desk reads when choosing who
                takes a conversation. You can change it later.
              </p>
            </div>
            <Button onClick={createManual} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Create agent
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The front desk, as the page's hero
// ---------------------------------------------------------------------------

function FrontDeskHero({
  router,
  workspaceName,
  agentCount,
  routableCount,
  conversations,
  resolutionRate,
  base,
}: {
  router: Agent;
  workspaceName: string;
  /** Every specialist on the page. */
  agentCount: number;
  /** The ones the front desk can actually hand to: active, in the roster. */
  routableCount: number;
  conversations: number | null;
  resolutionRate: number | null;
  base: string;
}) {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-3xl bg-linear-to-br from-primary/12 via-primary/5 to-card ring-1 ring-primary/15">
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 p-5 sm:p-6">
          <p className="text-[11px] font-semibold tracking-wider text-primary/70 uppercase">
            Your AI team
          </p>

          <h2 className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="min-w-0 truncate">
              {workspaceName}{" "}
              <span className="text-primary">{router.name}</span>
            </span>
            <StatusPill status={router.status} className="bg-card ring-border" />
          </h2>

          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Answers first on every channel, works out what the customer needs,
            then hands the conversation to one of your{" "}
            {routableCount === 1 ? "agent" : `${routableCount} agents`}. Your
            agents can hand it on to each other from there.
          </p>

          {/* The two buttons ride the chip row rather than sitting above it:
              this card is the only way into the front desk's own config. */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <StatChip
              icon={UsersThreeIcon}
              value={String(agentCount)}
              label={agentCount === 1 ? "Agent" : "Agents"}
            />
            <StatChip
              icon={ChatsIcon}
              value={count(conversations)}
              label="Conversations"
            />
            <StatChip
              icon={CheckCircleIcon}
              value={percent(resolutionRate)}
              label="Resolution rate"
            />
            <Button
              size="lg"
              variant="outline"
              className="rounded-xl"
              nativeButton={false}
              render={<Link href={`${base}/agents/${router._id}/test`} />}
            >
              <ChatsIcon /> Test routing
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-xl"
              nativeButton={false}
              render={<Link href={`${base}/agents/${router._id}`} />}
            >
              <SlidersIcon /> Configure
            </Button>
          </div>
        </div>

        {/* Decoration, and heavy: it only mounts where there is room for it.
            min-h rather than stretching to the text column: the bubbles are
            placed against the robot, so the zone has to be the same height
            whatever the paragraph beside it wraps to. */}
        <div className="relative hidden min-h-64 w-105 shrink-0 xl:block">
          {/* bottom-0, not below it: the card clips its overflow, and a robot
              hanging past the edge loses its feet. */}
          <Image
            src="/images/front-desk-agent.png"
            alt=""
            width={1396}
            height={1127}
            priority
            className="pointer-events-none absolute right-0 bottom-0 w-75 select-none"
          />
          {/* One bubble, above the head. The greeting used to print the
              agent's own opening line here and was clipped mid-sentence by the
              clamp, which reads as a bug rather than as a speech bubble — it
              is the front desk's own screen that shows the real one. */}
          <div className="absolute top-6 left-8 max-w-40 rounded-2xl bg-card px-3.5 py-2.5 text-xs leading-snug shadow-lg ring-1 ring-foreground/5">
            Hi! 👋 How can I help you?
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One agent
// ---------------------------------------------------------------------------

function AgentMenu({ agent, base }: { agent: Agent; base: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Actions for ${agent.botName}`}
            className="-mr-1 shrink-0 text-muted-foreground"
          />
        }
      >
        <DotsThreeVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`${base}/agents/${agent._id}`} />}>
          <SlidersIcon /> Configure
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href={`${base}/agents/${agent._id}/test`} />}
        >
          <ChatsIcon /> Test
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`${base}/agent-config`} />}>
          <ArrowsSplitIcon /> Show in map
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToolChips({ tools }: { tools: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Capped: an agent with six tools would otherwise make its card twice
          the height of its neighbours in the grid. */}
      {tools.slice(0, 3).map((key) => (
        <Badge key={key} variant="secondary" className="font-normal">
          {TOOL_LABELS.get(key as never) ?? key}
        </Badge>
      ))}
      {tools.length > 3 ? (
        <Badge variant="ghost" className="text-muted-foreground">
          +{tools.length - 3} more
        </Badge>
      ) : null}
    </div>
  );
}

function summaryOf(agent: Agent): string {
  return (
    agent.objective?.trim() ||
    agent.jobDescription?.trim() ||
    agent.routingDescription?.trim() ||
    "No description yet."
  );
}

function AgentCard({
  agent,
  stats,
  base,
}: {
  agent: Agent;
  stats: AgentStats | undefined;
  base: string;
}) {
  return (
    <Card className="flex shrink-0 flex-col rounded-2xl transition-shadow hover:shadow-md">
      <CardHeader className="flex items-start gap-3">
        <AgentAvatar name={agent.botName} gender={agent.gender} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-heading text-base font-semibold">
              {agent.botName}
            </span>
            <StatusPill status={agent.status} className="ml-auto" />
            <AgentMenu agent={agent} base={base} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {agent.role}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {agent.acceptsHandoff === false ? (
            <span className="italic">
              Out of routing — only reachable by pointing a channel straight at
              it.
            </span>
          ) : (
            summaryOf(agent)
          )}
        </p>

        <ToolChips tools={agent.builtinTools} />

        <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-3">
          <StatFigure
            icon={ChatsIcon}
            value={count(stats?.conversations)}
            label="Conversations"
          />
          <StatFigure
            icon={CrosshairSimpleIcon}
            value={percent(stats?.resolutionRate)}
            label="Resolution rate"
          />
          <StatFigure
            icon={ClockIcon}
            value={duration(stats?.avgLatencyMs)}
            label="Avg. response"
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agent._id}/test`} />}
          >
            <ChatsIcon /> Test
          </Button>
          <Button
            size="lg"
            className="flex-1"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agent._id}`} />}
          >
            <SlidersIcon /> Configure
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentRow({
  agent,
  stats,
  base,
}: {
  agent: Agent;
  stats: AgentStats | undefined;
  base: string;
}) {
  return (
    <Card className="shrink-0 rounded-2xl transition-shadow hover:shadow-md">
      <CardHeader className="flex items-center gap-3">
        <AgentAvatar name={agent.botName} gender={agent.gender} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-heading text-sm font-semibold">
              {agent.botName}
            </span>
            <StatusPill status={agent.status} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {agent.role} · {summaryOf(agent)}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-6 xl:flex">
          <StatFigure
            icon={ChatsIcon}
            value={count(stats?.conversations)}
            label="Conversations"
          />
          <StatFigure
            icon={CrosshairSimpleIcon}
            value={percent(stats?.resolutionRate)}
            label="Resolution rate"
          />
          <StatFigure
            icon={ClockIcon}
            value={duration(stats?.avgLatencyMs)}
            label="Avg. response"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="lg"
            variant="outline"
            className="max-sm:hidden"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agent._id}/test`} />}
          >
            <ChatsIcon /> Test
          </Button>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agent._id}`} />}
          >
            <SlidersIcon /> Configure
          </Button>
          <AgentMenu agent={agent} base={base} />
        </div>
      </CardHeader>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The follow-up desk
// ---------------------------------------------------------------------------

function FollowUpDeskCard({
  desk,
  leads,
  base,
}: {
  desk: Agent;
  leads: { today: number; open: number; conversionRate: number | null } | null;
  base: string;
}) {
  return (
    <Card className="shrink-0 rounded-2xl">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
          <FunnelIcon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-heading text-base font-semibold">
              {desk.name}
            </span>
            <Badge variant="secondary">Lead pipeline</Badge>
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Reads a conversation an hour after it goes quiet, files it at a lead
            stage and sends one nudge if it is worth sending. It never takes a
            live turn, so it is not in the front desk&apos;s roster and cannot be
            transferred to.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-6 lg:gap-8">
          <div>
            <div className="font-heading text-lg leading-none font-semibold">
              {count(leads?.today)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Leads today</div>
          </div>
          <div>
            <div className="font-heading text-lg leading-none font-semibold">
              {count(leads?.open)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Open leads</div>
          </div>
          <div>
            <div className="font-heading text-lg leading-none font-semibold">
              {percent(leads?.conversionRate)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Conversion rate
            </div>
          </div>
        </div>

        <Button
          size="lg"
          variant="outline"
          className="shrink-0"
          nativeButton={false}
          render={<Link href={`${base}/agents/${desk._id}`} />}
        >
          <SlidersIcon /> Configure
        </Button>
      </CardHeader>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  // Convex queries must not read the wall clock, so `now` is an argument.
  // Rounded to the hour, it keeps the query cache key stable.
  const now = useHourBucket();

  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const roster = useQuery(api.agents.roster, {
    workspaceId: workspace._id,
    now,
  });
  const ensureRouter = useMutation(api.agents.ensureDefaultRouter);

  const [provisioning, setProvisioning] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const [view, setView] = useState<"grid" | "list">("grid");
  const searchRef = useRef<HTMLInputElement>(null);
  const mac = useIsMac();

  // The hint on the field has to be true, so ⌘K/Ctrl+K focuses it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey))
        return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const statsById = useMemo(() => {
    const map = new Map<string, AgentStats>();
    for (const row of roster?.byAgent ?? []) map.set(row.agentId, row);
    return map;
  }, [roster]);

  const frontDesk = (agents ?? []).find((agent) => agent.kind === "router");
  const followUpDesk = (agents ?? []).find(
    (agent) => agent.kind === "follow_up"
  );
  // Neither desk is a specialist. An agent with no kind at all predates kinds
  // and is one, which is why this tests for the two exclusions rather than for
  // the word "specialist".
  const specialists = (agents ?? []).filter(
    (agent) =>
      agent.kind !== "router" &&
      agent.kind !== "follow_up" &&
      agent.kind !== "marketing"
  );
  const routable = specialists.filter(
    (agent) => agent.status === "active" && agent.acceptsHandoff !== false
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = needle
      ? specialists.filter((agent) =>
          [agent.botName, agent.name, agent.role, summaryOf(agent)]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : specialists;

    return [...matched].sort((a, b) => {
      if (sort === "name") return a.botName.localeCompare(b.botName);
      if (sort === "conversations") {
        return (
          (statsById.get(b._id)?.conversations ?? 0) -
          (statsById.get(a._id)?.conversations ?? 0)
        );
      }
      return b.updatedAt - a.updatedAt;
    });
    // specialists is derived from `agents` on every render, so the query result
    // is the honest dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, search, sort, statsById]);

  const provision = async () => {
    setProvisioning(true);
    try {
      const result = await ensureRouter({
        workspaceId: workspace._id,
        // The point of a front desk is that everything arrives there, so the
        // existing channels are moved over as part of creating it.
        repointChannels: true,
      });
      toast.add({
        title: "Front desk created",
        description: result.repointed
          ? `${result.repointed} channel(s) now arrive at the front desk, which routes each conversation on.`
          : "Point a channel at it and it will route every new conversation.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not create the front desk",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Agents
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Build AI teammates that understand your business and work on your
            channels.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              placeholder="Search agents…"
              aria-label="Search agents"
              className="h-9 rounded-xl pr-16 pl-8"
              onChange={(event) => setSearch(event.target.value)}
            />
            <KbdGroup className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
              <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </div>
          {/* The other way of doing this page, for comparison. */}
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={`${base}/agent-config`} />}
          >
            <ArrowsSplitIcon /> Map view
          </Button>
          <NewAgentDialog />
        </div>
      </header>

      {/* -------------------------------------------------------- front desk */}
      {frontDesk ? (
        <FrontDeskHero
          router={frontDesk}
          workspaceName={workspace.name}
          agentCount={specialists.length}
          routableCount={routable.length}
          conversations={roster?.totals.conversations ?? null}
          resolutionRate={roster?.totals.resolutionRate ?? null}
          base={base}
        />
      ) : specialists.length > 0 ? (
        <Alert>
          <ArrowsSplitIcon />
          <AlertTitle>No front desk yet</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              A front desk answers first on every channel and routes each
              conversation to the agent that should handle it. Without one, each
              channel is stuck with a single agent. Creating it moves your
              existing channels over — you can point any of them back at a
              single agent from the Channels page.
            </span>
            <Button size="lg" onClick={provision} disabled={provisioning}>
              {provisioning ? <Spinner /> : <SignpostIcon />} Create the front
              desk and route my channels
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {frontDesk && routable.length === 0 && specialists.length > 0 ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>Nothing to route to</AlertTitle>
          <AlertDescription>
            The front desk only hands over to agents that are <em>active</em>.
            Set at least one agent to active, or it will try to answer everything
            itself.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ------------------------------------------------------- the roster */}
      {agents === undefined ? (
        <CardGridSkeleton count={3} />
      ) : specialists.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RobotIcon />
            </EmptyMedia>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>
              Describe the job in a sentence and the model will draft the
              persona, tone, rules and guardrails for you to review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewAgentDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold">
                Your agents
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Each agent has a specific role, personality and set of tools.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort</span>
              <SelectField
                value={sort}
                onValueChange={setSort}
                options={SORTS}
                aria-label="Sort agents"
                className="w-40"
              />
              <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  className={cn(
                    view === "grid" && "bg-primary/10 text-primary"
                  )}
                  onClick={() => setView("grid")}
                >
                  <SquaresFourIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  className={cn(
                    view === "list" && "bg-primary/10 text-primary"
                  )}
                  onClick={() => setView("list")}
                >
                  <ListIcon />
                </Button>
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MagnifyingGlassIcon />
                </EmptyMedia>
                <EmptyTitle>No agent matches “{search}”</EmptyTitle>
                <EmptyDescription>
                  Search runs over the name, role and description.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : view === "grid" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {visible.map((agent) => (
                <AgentCard
                  key={agent._id}
                  agent={agent}
                  stats={statsById.get(agent._id)}
                  base={base}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((agent) => (
                <AgentRow
                  key={agent._id}
                  agent={agent}
                  stats={statsById.get(agent._id)}
                  base={base}
                />
              ))}
            </div>
          )}
        </>
      )}

      {followUpDesk ? (
        <FollowUpDeskCard
          desk={followUpDesk}
          leads={roster?.leads ?? null}
          base={base}
        />
      ) : null}
    </div>
  );
}
