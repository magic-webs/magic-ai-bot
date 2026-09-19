"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_FOLLOW_UPS } from "@/convex/lib/shared";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { LeadStagesSheet, type LeadStage } from "@/components/lead-stages-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { ListSkeleton } from "@/components/skeletons";
import { useHourBucket } from "@/components/use-now";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowRightIcon,
  ChatCircleIcon,
  ChatsIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ClockIcon,
  DotsThreeIcon,
  FileTextIcon,
  FunnelIcon,
  GlobeIcon,
  HandshakeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ProhibitIcon,
  SignpostIcon,
  SparkleIcon,
  TrophyIcon,
  UserIcon,
  WarningIcon,
  WhatsappLogoIcon,
  XCircleIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

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

/** A stage, or the queue of leads no stage has claimed. */
type Group = {
  key: string;
  title: string;
  blurb: string;
  /** The stage's own words, for the heading's tooltip. */
  hint: string;
  outcome: LeadStage["outcome"];
  tone: Tone;
  icon: Icon;
  rows: Lead[];
};

// ---------------------------------------------------------------------------
// Stage colour
// ---------------------------------------------------------------------------

/**
 * A stage is a row someone can rename, delete or add to, so its colour cannot
 * be stored on it — a new stage would have none, and a renamed one would keep
 * a colour chosen for a different meaning.
 *
 * It is derived instead. The two terminal outcomes own green and red, the
 * unreviewed queue is grey, and the open stages walk a fixed palette in
 * pipeline order, so the colours stay put as long as the pipeline does.
 */
type Tone =
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "amber"
  | "teal"
  | "emerald"
  | "rose"
  | "slate";

const OPEN_TONES = [
  "sky",
  "blue",
  "indigo",
  "violet",
  "amber",
  "teal",
] as const satisfies readonly Tone[];

/** Two words, because a stage's own description is a paragraph. */
function blurbFor(outcome: LeadStage["outcome"]): string {
  if (outcome === "won") return "Closed, won";
  if (outcome === "lost") return "Closed, lost";
  return "In play";
}

/** Likewise the glyph: by outcome where there is one, else by position. */
const OPEN_ICONS = [
  SparkleIcon,
  TrophyIcon,
  ClipboardTextIcon,
  FileTextIcon,
  HandshakeIcon,
] as const;

// Tailwind reads whole class names out of the source, so every tint is spelled
// out rather than built from the tone name at runtime.
const TONES: Record<
  Tone,
  { panel: string; tile: string; title: string; pill: string }
> = {
  sky: {
    panel:
      "border-sky-200/70 bg-sky-50/60 dark:border-sky-500/15 dark:bg-sky-500/5",
    tile: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    title: "text-sky-900 dark:text-sky-200",
    pill: "border-sky-200 bg-sky-100/70 text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/15 dark:text-sky-200",
  },
  blue: {
    panel:
      "border-blue-200/70 bg-blue-50/60 dark:border-blue-500/15 dark:bg-blue-500/5",
    tile: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    title: "text-blue-900 dark:text-blue-200",
    pill: "border-blue-200 bg-blue-100/70 text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-200",
  },
  indigo: {
    panel:
      "border-indigo-200/70 bg-indigo-50/60 dark:border-indigo-500/15 dark:bg-indigo-500/5",
    tile: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
    title: "text-indigo-900 dark:text-indigo-200",
    pill: "border-indigo-200 bg-indigo-100/70 text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/15 dark:text-indigo-200",
  },
  violet: {
    panel:
      "border-violet-200/70 bg-violet-50/60 dark:border-violet-500/15 dark:bg-violet-500/5",
    tile: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    title: "text-violet-900 dark:text-violet-200",
    pill: "border-violet-200 bg-violet-100/70 text-violet-900 dark:border-violet-500/20 dark:bg-violet-500/15 dark:text-violet-200",
  },
  amber: {
    panel:
      "border-amber-200/70 bg-amber-50/60 dark:border-amber-500/15 dark:bg-amber-500/5",
    tile: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    title: "text-amber-900 dark:text-amber-200",
    pill: "border-amber-200 bg-amber-100/70 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-200",
  },
  teal: {
    panel:
      "border-teal-200/70 bg-teal-50/60 dark:border-teal-500/15 dark:bg-teal-500/5",
    tile: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    title: "text-teal-900 dark:text-teal-200",
    pill: "border-teal-200 bg-teal-100/70 text-teal-900 dark:border-teal-500/20 dark:bg-teal-500/15 dark:text-teal-200",
  },
  emerald: {
    panel:
      "border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-500/15 dark:bg-emerald-500/5",
    tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    title: "text-emerald-900 dark:text-emerald-200",
    pill: "border-emerald-200 bg-emerald-100/70 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-200",
  },
  rose: {
    panel:
      "border-rose-200/70 bg-rose-50/60 dark:border-rose-500/15 dark:bg-rose-500/5",
    tile: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    title: "text-rose-900 dark:text-rose-200",
    pill: "border-rose-200 bg-rose-100/70 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-200",
  },
  slate: {
    panel: "border-border bg-muted/40 dark:bg-muted/20",
    tile: "bg-muted text-muted-foreground",
    title: "text-foreground",
    pill: "border-border bg-muted/60 text-foreground",
  },
};

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

// "all" is the no-filter sentinel, as on Contacts and Orders.
const CHANNELS = [
  { value: "all", label: "All channels" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "web", label: "Website" },
];

// The conversation's status, not the stage's: a lead can be escalated at any
// stage, and "who is shouting" is a different question from "how far along".
const STATUSES = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "escalated", label: "Escalated" },
  { value: "closed", label: "Closed" },
];

const WINDOWS = [
  { value: "all", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// One lead
// ---------------------------------------------------------------------------

/**
 * What the desk will do next, said on the card rather than left to be worked
 * out from a nudge count and a stage. Derived, not stored: the sweep decides
 * afresh each time, and these are the three things that stop it.
 */
function nudgeState(lead: Lead, outcome: LeadStage["outcome"]): string {
  if (outcome !== "open") return "Stage is closed";
  if (lead.followUpCount >= MAX_FOLLOW_UPS) return "Nudge limit used";
  if (!lead.reviewedAt) return "Not reviewed yet";
  return "Can still be nudged";
}

function LeadMenu({ lead, base }: { lead: Lead; base: string }) {
  const setStage = useMutation(api.leads.setStage);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Actions for ${lead.contactLabel}`}
            className="shrink-0 text-muted-foreground"
          />
        }
      >
        <DotsThreeIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={
            <Link href={`${base}/conversations?c=${lead.conversationId}`} />
          }
        >
          <ChatsIcon /> Open conversation
        </DropdownMenuItem>
        {lead.leadStageId ? (
          <DropdownMenuItem
            onClick={async () => {
              try {
                await setStage({ conversationId: lead.conversationId });
                toast.add({ title: "Lead unfiled", type: "success" });
              } catch (error) {
                toast.add({
                  title: "Could not unfile the lead",
                  description:
                    error instanceof Error ? error.message : String(error),
                  type: "error",
                });
              }
            }}
          >
            <ProhibitIcon /> Unfile
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeadCard({
  lead,
  group,
  stages,
  base,
}: {
  lead: Lead;
  group: Group;
  stages: LeadStage[];
  base: string;
}) {
  const setStage = useMutation(api.leads.setStage);
  const tone = TONES[group.tone];

  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            lead.channelType === "whatsapp"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground"
          )}
        >
          {lead.channelType === "whatsapp" ? (
            <WhatsappLogoIcon className="size-4" />
          ) : (
            <GlobeIcon className="size-4" />
          )}
        </span>

        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-semibold">
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
            <Badge
              variant="outline"
              title="Filed by hand — reviews will not move it"
            >
              pinned
            </Badge>
          ) : null}
          {lead.followUpCount > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {lead.followUpCount} nudge{lead.followUpCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </p>

        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {formatDistanceToNow(lead.lastMessageAt, { addSuffix: true })}
        </span>
      </div>

      {lead.lastMessagePreview ? (
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {lead.lastMessagePreview}
        </p>
      ) : null}

      {/* Why the desk filed it here, and what it will do next. The single most
          useful line on this page when a stage looks wrong. */}
      <p className="line-clamp-1 text-xs text-muted-foreground italic">
        {lead.leadStageNote
          ? `${lead.leadStageNote} · ${nudgeState(lead, group.outcome)}`
          : nudgeState(lead, group.outcome)}
      </p>

      {lead.remark ? (
        <p className="line-clamp-1 text-xs text-muted-foreground">
          Remark: {lead.remark}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ChatCircleIcon className="size-3.5" /> {lead.messageCount} messages
        </span>
        {lead.handledBy ? (
          <span className="flex min-w-0 items-center gap-1">
            <UserIcon className="size-3.5 shrink-0" />
            <span className="truncate">{lead.handledBy}</span>
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-1">
          <LeadMenu lead={lead} base={base} />
          <SelectField
            size="sm"
            aria-label={`Stage for ${lead.contactLabel}`}
            className={cn("font-medium", tone.pill)}
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
              ...stages.map((option) => ({
                value: option._id as string,
                label: option.name,
              })),
            ]}
          />
        </span>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// The funnel row
// ---------------------------------------------------------------------------

function StatChip({
  icon: Glyph,
  tone,
  label,
  blurb,
  count,
  selected,
  onSelect,
}: {
  icon: Icon;
  tone: Tone;
  label: string;
  blurb: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={blurb}
      className={cn(
        "flex min-w-52 flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
        TONES[tone].panel,
        selected
          ? "ring-2 ring-primary/50"
          : "hover:border-foreground/20 hover:shadow-sm"
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          TONES[tone].tile
        )}
      >
        <Glyph className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight font-semibold">
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {blurb}
        </span>
      </span>
      <span className="text-sm font-semibold tabular-nums">{count}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

export default function LeadsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const stages = useQuery(api.leads.listStages, {
    workspaceId: workspace._id,
  }) as LeadStage[] | undefined;
  const leads = useQuery(api.leads.pipeline, {
    workspaceId: workspace._id,
  }) as Lead[] | undefined;
  const ensureStages = useMutation(api.leads.ensureDefaultStages);
  const ensureDesk = useMutation(api.agents.ensureDefaultFollowUpDesk);
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const [stagesOpen, setStagesOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [seen, setSeen] = useState("all");
  // The window filter needs the clock, and a render must not read it directly.
  const now = useHourBucket();

  const desk = (agents ?? []).find((agent) => agent.kind === "follow_up");

  const total = leads?.length ?? 0;
  const term = search.trim().toLowerCase();
  // The stage is left out of this: it has its own row of chips, which show
  // their own selected state and clear on a second click.
  const narrowed =
    Boolean(term) || channel !== "all" || status !== "all" || seen !== "all";

  // Everything except the stage, so a chip's count answers "how many are here
  // under the filters in force" rather than being filtered by itself.
  const rows = useMemo(() => {
    return (leads ?? []).filter((lead) => {
      if (channel !== "all" && lead.channelType !== channel) return false;
      if (status !== "all" && lead.status !== status) return false;
      if (seen !== "all" && lead.lastMessageAt < now - Number(seen) * DAY_MS) {
        return false;
      }
      if (!term) return true;
      return [
        lead.contactLabel,
        lead.contactCompany,
        lead.remark,
        lead.leadStageNote,
        lead.lastMessagePreview,
        lead.handledBy,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [leads, channel, status, seen, term, now]);

  // Grouped in pipeline order, with the unfiled last: they are the ones the
  // desk has not read yet, which is a queue rather than a stage.
  const groups = useMemo<Group[]>(() => {
    if (!stages) return [];
    const byStage = new Map<string, Lead[]>();
    const unfiled: Lead[] = [];
    for (const lead of rows) {
      if (!lead.leadStageId) {
        unfiled.push(lead);
        continue;
      }
      const list = byStage.get(lead.leadStageId) ?? [];
      list.push(lead);
      byStage.set(lead.leadStageId, list);
    }

    // Counted over the open stages alone, so inserting a "won" stage halfway
    // down the pipeline does not re-colour everything after it.
    let openIndex = 0;
    const out: Group[] = stages.map((s) => {
      const open = s.outcome === "open";
      const at = openIndex;
      if (open) openIndex += 1;
      return {
        key: s._id as string,
        title: s.name,
        blurb: blurbFor(s.outcome),
        hint: s.description,
        outcome: s.outcome,
        tone: open
          ? OPEN_TONES[at % OPEN_TONES.length]
          : s.outcome === "won"
            ? "emerald"
            : "rose",
        icon: open
          ? OPEN_ICONS[at % OPEN_ICONS.length]
          : s.outcome === "won"
            ? CheckCircleIcon
            : XCircleIcon,
        rows: byStage.get(s._id) ?? [],
      };
    });

    out.push({
      key: "unfiled",
      title: "Not yet reviewed",
      blurb: "Needs attention",
      hint: "The desk reads a conversation an hour after it goes quiet.",
      outcome: "open",
      tone: "slate",
      icon: ClockIcon,
      rows: unfiled,
    });

    return out;
  }, [stages, rows]);

  // A stage nobody is at is noise on a page about who is where.
  const filled = groups.filter((group) => group.rows.length > 0);
  const shown =
    stage === "all" ? filled : filled.filter((group) => group.key === stage);

  const clear = () => {
    setSearch("");
    setChannel("all");
    setStatus("all");
    setSeen("all");
  };

  const loading = stages === undefined || leads === undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Leads
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every conversation, filed at the stage it has reached.
          </p>
        </div>
        <Button
          size="lg"
          variant="outline"
          className="shrink-0"
          onClick={() => setStagesOpen(true)}
        >
          <SignpostIcon /> Manage stages
        </Button>
      </header>

      {stages ? (
        <LeadStagesSheet
          workspaceId={workspace._id}
          stages={stages}
          open={stagesOpen}
          onOpenChange={setStagesOpen}
        />
      ) : null}

      {/* The funnel as a row you can click through. A second click on the
          selected chip goes back to all of them. */}
      {!loading && rows.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <StatChip
            icon={FunnelIcon}
            tone="slate"
            label="All"
            blurb="All leads"
            count={rows.length}
            selected={stage === "all"}
            onSelect={() => setStage("all")}
          />
          {filled.map((group) => (
            <StatChip
              key={group.key}
              icon={group.icon}
              tone={group.tone}
              label={group.title}
              blurb={group.blurb}
              count={group.rows.length}
              selected={stage === group.key}
              onSelect={() =>
                setStage((prev) => (prev === group.key ? "all" : group.key))
              }
            />
          ))}
        </div>
      ) : null}

      {/* No visible field labels: three selects and a search box would run the
          row wider than the panels below. Each select's resting option names
          its own dimension, with an aria-label for anyone who cannot see it. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs min-w-56">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search leads…"
            className="pl-7"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <SelectField
          aria-label="Filter by channel"
          value={channel}
          onValueChange={setChannel}
          options={CHANNELS}
        />

        <SelectField
          aria-label="Filter by conversation status"
          value={status}
          onValueChange={setStatus}
          options={STATUSES}
        />

        <SelectField
          aria-label="Filter by when the lead last said something"
          value={seen}
          onValueChange={setSeen}
          options={WINDOWS}
        />

        {narrowed ? (
          <Button variant="ghost" onClick={clear}>
            <XIcon /> Clear
          </Button>
        ) : null}

        <span className="ml-auto text-sm tabular-nums text-muted-foreground">
          {narrowed
            ? `${rows.length} of ${total}`
            : `${total} lead${total === 1 ? "" : "s"}`}
        </span>
      </div>

      {!desk && agents !== undefined ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>No follow-up desk yet</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              Nothing is filed or followed up until this workspace has one.
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

      {loading ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FunnelIcon />
            </EmptyMedia>
            <EmptyTitle>
              {narrowed ? "No leads match" : "No leads yet"}
            </EmptyTitle>
            <EmptyDescription>
              {narrowed
                ? "Nothing matches every filter at once."
                : "Every conversation becomes a lead. Talk to an agent, and it will appear here."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {narrowed ? (
              <Button variant="outline" onClick={clear}>
                <XIcon /> Clear filters
              </Button>
            ) : (
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href={`${base}/conversations`} />}
              >
                <ChatsIcon /> Open conversations
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        /* The stages still in play take the full width and run their cards
           two-up; the closed outcomes and the unreviewed queue share a row
           below, because what is left to do matters more than what is done. */
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((group) => {
            const wide = group.outcome === "open" || stage !== "all";
            const tone = TONES[group.tone];
            return (
              <section
                key={group.key}
                className={cn(
                  "rounded-2xl border p-3 sm:p-4",
                  tone.panel,
                  wide && "lg:col-span-2"
                )}
              >
                <header className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      tone.tile
                    )}
                  >
                    <group.icon className="size-4" />
                  </span>
                  <h2
                    className={cn(
                      "font-heading text-base font-semibold",
                      tone.title
                    )}
                    title={group.hint}
                  >
                    {group.title}
                  </h2>
                  <Badge variant="ghost" className="tabular-nums">
                    {group.rows.length}
                  </Badge>
                  {stage === "all" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-muted-foreground"
                      onClick={() => setStage(group.key)}
                    >
                      View all <ArrowRightIcon />
                    </Button>
                  ) : null}
                </header>

                <div className={cn("grid gap-3", wide && "md:grid-cols-2")}>
                  {group.rows.map((lead) => (
                    <LeadCard
                      key={lead.conversationId}
                      lead={lead}
                      group={group}
                      stages={stages}
                      base={base}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
