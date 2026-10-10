"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeOrigin,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { AgentAvatar } from "@/components/agent-avatar";
import { InstagramLogo, WhatsAppLogo } from "@/components/brand-icons";
import { CHANNEL_LABEL, type ChannelKind } from "@/components/channel-mark";
import { cn } from "@/lib/utils";
import {
  BooksIcon,
  FunnelIcon,
  GlobeIcon,
  PlusIcon,
  RobotIcon,
  SignpostIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// Nodes
//
// Styled with the app's own tokens rather than React Flow's, so the graph
// follows the workspace palette and both themes without a second set of
// colours to keep in step. The two exceptions are the channel tiles, which
// wear WhatsApp's green and the web's blue because that is how people
// recognise them, and the status dots, which are the same traffic-light
// colours every status in this console uses.
// ---------------------------------------------------------------------------

type ChannelData = {
  label: string;
  channel: ChannelKind;
  live: boolean;
  status: string;
  messages: number;
  people: number;
};

/** A dashed stand-in for the channel column when there is nothing in it. */
type PlaceholderData = { label: string; hint: string; href: string };

type HeadingData = { label: string; hint: string };

type AgentKind = "router" | "specialist" | "follow_up";
type AgentStatus = "draft" | "active" | "paused";

type AgentData = {
  label: string;
  detail: string;
  kind: AgentKind;
  status: AgentStatus;
  gender?: "male" | "female";
  /** Absent for the desks, which are not routed to. */
  routable?: boolean;
  /**
   * The specialist's "hand over to me when…", previewed on the card: it is the
   * line the front desk routes on, so an empty one is the thing to spot.
   * Absent for the desks, empty string for a specialist without one.
   */
  routingNote?: string;
  href: string;
  agentId: Id<"agents">;
  /** What this agent is set up with. Icons and a count, never a sentence. */
  config: { knowledge: boolean; tools: number };
};

const STATUS_DOT: Record<AgentStatus, string> = {
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  draft: "bg-muted-foreground/50",
};

const KIND: Record<
  AgentKind,
  { label: string; icon: typeof RobotIcon }
> = {
  router: { label: "Front desk", icon: SignpostIcon },
  specialist: { label: "Specialist", icon: RobotIcon },
  follow_up: { label: "Follow-up desk", icon: FunnelIcon },
};

// Handles exist only so edges have somewhere to attach. Drawn, they read as
// sockets waiting for a connection — on a read-only diagram, and on every
// card side with nothing plugged in — so they are invisible and the arrow
// heads carry the direction instead.
const handle = "!size-1 !min-w-0 !border-0 !bg-transparent !opacity-0";

/**
 * A routing note as the tail of "Takes over when…".
 *
 * Notes are usually written as the field's own prompt, "Hand over to me
 * when…", so that opening is dropped rather than printed twice, and the first
 * letter lowered so the sentence runs on.
 */
function routingClause(note: string): string {
  const rest = note
    .trim()
    .replace(/^(…|\.\.\.)\s*/, "")
    .replace(/^(please\s+)?(hand(\s+this)?\s+over\s+to\s+me|take\s+over|takes\s+over)\s+(when|if)\s+/i, "")
    .trim();
  // Leave an acronym alone: "VAT questions" should not become "vAT".
  return /^[A-Z][a-z]/.test(rest) ? rest[0].toLowerCase() + rest.slice(1) : rest;
}

function ChannelNode({ data }: NodeProps<Node<ChannelData>>) {
  const whatsapp = data.channel === "whatsapp";
  const instagram = data.channel === "instagram";
  return (
    <div
      className={cn(
        "flex w-60 items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm",
        !data.live && "opacity-70"
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
          // WhatsApp's own app-icon gradient, so the tile reads as the app.
          whatsapp
            ? "bg-linear-to-b from-[#5FFC7B] to-[#28D146]"
            : instagram
              ? "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)]"
              : "bg-sky-500"
        )}
      >
        {whatsapp ? (
          <WhatsAppLogo className="size-6" />
        ) : instagram ? (
          <InstagramLogo className="size-5" />
        ) : (
          <GlobeIcon weight="fill" className="size-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{data.label}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.live ? (
            // A pulse, not a word: live is the normal state, and a channel
            // that stops pulsing is what should catch the eye.
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          ) : (
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
          )}
          <span className="truncate">
            {data.live ? "Live" : data.status} ·{" "}
            {CHANNEL_LABEL[data.channel]}
          </span>
        </p>
        {data.messages > 0 ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
            {data.messages.toLocaleString()} messages ·{" "}
            {data.people.toLocaleString()}{" "}
            {data.people === 1 ? "person" : "people"}
          </p>
        ) : null}
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={handle}
      />
    </div>
  );
}

function PlaceholderNode({ data }: NodeProps<Node<PlaceholderData>>) {
  return (
    <div className="flex w-60 cursor-pointer items-center gap-3 rounded-2xl border border-dashed bg-card/60 p-3 text-left transition-colors hover:border-primary/60 hover:bg-card">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <PlusIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{data.label}</p>
        <p className="truncate text-xs text-muted-foreground">{data.hint}</p>
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={handle}
      />
    </div>
  );
}

function HeadingNode({ data }: NodeProps<Node<HeadingData>>) {
  return (
    <div className="w-64 select-none">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {data.label}
      </p>
      <p className="text-[11px] text-muted-foreground/80">{data.hint}</p>
    </div>
  );
}

function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  const kind = KIND[data.kind];
  const KindIcon = kind.icon;
  const router = data.kind === "router";
  const outOfRoster = data.routable === false && data.status === "active";

  return (
    <div
      className={cn(
        "relative w-64 cursor-pointer overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-[border-color,box-shadow,translate] duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
        // React Flow puts `.selected` on the wrapper, so the ring is asked
        // for from there rather than threaded through node data.
        "[.selected>&]:border-primary [.selected>&]:ring-2 [.selected>&]:ring-primary/30",
        router &&
          "border-primary/40 bg-linear-to-br from-primary/[0.07] via-card to-card ring-1 ring-primary/15",
        data.status !== "active" && "opacity-80"
      )}
    >
      <Handle id="in" type="target" position={Position.Left} className={handle} />
      {/* The follow-up desk sits under the front desk, so their link runs
          straight down rather than out of one side and back into the other. */}
      {data.kind === "follow_up" ? (
        <Handle
          id="above"
          type="target"
          position={Position.Top}
          className={handle}
        />
      ) : null}

      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <AgentAvatar
              name={data.label}
              gender={data.gender}
              greeter={router}
              size={40}
            />
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card",
                STATUS_DOT[data.status]
              )}
              title={data.status}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">
              {data.label}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {data.detail}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
              router
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <KindIcon className="size-3" />
            {kind.label}
          </span>
          {data.status !== "active" ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
              {data.status}
            </span>
          ) : null}
          {/* Active but out of the roster: reachable by a channel pointed
              straight at it, never by a handover. Worth saying on the node,
              because the missing edge is otherwise indistinguishable from a
              drawing mistake. */}
          {outOfRoster ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              no handover
            </span>
          ) : null}
        </div>

        {data.routingNote !== undefined ? (
          data.routingNote.trim() ? (
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              <span className="text-foreground/70">Takes over when</span>{" "}
              {routingClause(data.routingNote)}
            </p>
          ) : (
            <p className="flex items-start gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              <WarningIcon weight="fill" className="mt-px size-3 shrink-0" />
              No routing note — the front desk has almost nothing to route on.
            </p>
          )
        ) : null}

        {/* What it is set up with, as marks rather than prose. */}
        <div className="flex items-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
              data.config.knowledge
                ? "bg-primary/10 text-primary"
                : "bg-muted line-through opacity-70"
            )}
            title={
              data.config.knowledge
                ? "Reads the knowledge base"
                : "Does not read the knowledge base"
            }
          >
            <BooksIcon className="size-3" />
            Knowledge
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 tabular-nums"
            title={`${data.config.tools} built-in tools`}
          >
            <WrenchIcon className="size-3" />
            {data.config.tools}
          </span>
        </div>
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={handle}
      />
      {router ? (
        <Handle
          id="below"
          type="source"
          position={Position.Bottom}
          className={handle}
        />
      ) : null}
    </div>
  );
}

// Defined once, at module scope: React Flow warns (and remounts every node) if
// this object is a new identity on each render.
const nodeTypes = {
  channel: ChannelNode,
  placeholder: PlaceholderNode,
  heading: HeadingNode,
  agent: AgentNode,
};

// ---------------------------------------------------------------------------
// Layout
//
// Positions are computed rather than laid out by a graph library: this shape
// is always the same three columns — where conversations arrive, the front
// desk, and who it hands to — so there is nothing for one to work out.
//
// Every node is placed by its vertical middle (NODE_ORIGIN below), so a short
// channel card and a tall agent card on the same row line up by their centres
// rather than their tops, and the edges between them run level.
// ---------------------------------------------------------------------------

const NODE_ORIGIN: NodeOrigin = [0, 0.5];
const COLUMN = { channel: 0, desk: 340, specialist: 700 };
const ROW = 204;
/** Roughly half the tallest card, plus the gap above it for the headings. */
const HEADING_GAP = 128;

// Edge colours come from the palette tokens, so they follow the theme.
const LIVE = "var(--primary)";
const QUIET = "var(--muted-foreground)";

type ChannelRow = {
  _id: string;
  name: string;
  type: ChannelKind;
  status: string;
  agentId: string;
  messageCount: number;
  contactCount: number;
};

function buildGraph(
  agents: Doc<"agents">[],
  channels: ChannelRow[] | undefined,
  base: string
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const channelRows = channels ?? [];

  const router = agents.find((agent) => agent.kind === "router");
  const followUp = agents.find((agent) => agent.kind === "follow_up");
  // An agent with no kind predates kinds and is a specialist, which is why
  // this excludes the desks rather than testing for "specialist".
  const specialists = agents.filter(
    (agent) =>
      agent.kind !== "router" &&
      agent.kind !== "follow_up" &&
      agent.kind !== "marketing"
  );

  const centre = (count: number, index: number) =>
    (index - (count - 1) / 2) * ROW;

  const agentNode = (
    agent: Doc<"agents">,
    kind: AgentKind,
    position: { x: number; y: number },
    extra: Partial<AgentData> = {}
  ): Node => ({
    id: `agent-${agent._id}`,
    type: "agent",
    position,
    data: {
      label: agent.botName,
      detail: agent.role,
      kind,
      status: agent.status,
      gender: agent.gender,
      href: `${base}/agents/${agent._id}`,
      agentId: agent._id,
      config: {
        knowledge: agent.knowledgeEnabled,
        tools: agent.builtinTools.length,
      },
      ...extra,
    } satisfies AgentData,
    draggable: false,
  });

  // --- column headings ----------------------------------------------------
  // One row across the top, above the tallest column, so the three read as
  // stages of one journey rather than three separate lists.
  const channelCount = Math.max(channelRows.length, 1);
  const top =
    Math.min(centre(channelCount, 0), 0, centre(specialists.length || 1, 0)) -
    HEADING_GAP;
  const reachable = specialists.filter(
    (agent) => agent.status === "active" && agent.acceptsHandoff !== false
  ).length;
  const headings: Array<{ id: string; x: number; label: string; hint: string }> = [
    {
      id: "channels",
      x: COLUMN.channel,
      label: "Where they arrive",
      hint:
        channelRows.length === 1
          ? "1 channel"
          : `${channelRows.length} channels`,
    },
    {
      id: "desk",
      x: COLUMN.desk,
      label: "Front desk",
      hint: router ? "Answers first, then hands over" : "Not set up",
    },
  ];
  if (specialists.length > 0) {
    headings.push({
      id: "specialists",
      x: COLUMN.specialist,
      label: "Specialists",
      hint: `${reachable} of ${specialists.length} can take a handover`,
    });
  }
  for (const heading of headings) {
    nodes.push({
      id: `heading-${heading.id}`,
      type: "heading",
      position: { x: heading.x, y: top },
      data: { label: heading.label, hint: heading.hint } satisfies HeadingData,
      draggable: false,
      selectable: false,
      focusable: false,
    });
  }

  // --- column one: where conversations arrive -----------------------------
  channelRows.forEach((channel, index) => {
    nodes.push({
      id: `channel-${channel._id}`,
      type: "channel",
      position: { x: COLUMN.channel, y: centre(channelRows.length, index) },
      data: {
        label: channel.name,
        channel: channel.type,
        live: channel.status === "active",
        status: channel.status,
        messages: channel.messageCount,
        people: channel.contactCount,
      } satisfies ChannelData,
      draggable: false,
    });
  });

  // Only once the channels have loaded: a placeholder that flashes up while
  // the query is in flight reads as "you have no channels" for a moment.
  if (channels !== undefined && channelRows.length === 0) {
    nodes.push({
      id: "channel-placeholder",
      type: "placeholder",
      position: { x: COLUMN.channel, y: 0 },
      data: {
        label: "Connect a channel",
        hint: "WhatsApp or a web chat",
        href: `${base}/channels`,
      } satisfies PlaceholderData,
      draggable: false,
    });
  }

  // --- column two: the front desk -----------------------------------------
  const entryId = router ? `agent-${router._id}` : null;
  if (router) {
    nodes.push(agentNode(router, "router", { x: COLUMN.desk, y: 0 }));
  }

  // Every channel arrives at the front desk. Without one, each channel is
  // stuck with whatever single agent it points at, so the edge goes straight
  // to that agent instead — which is the whole argument for a front desk,
  // drawn rather than explained.
  const drawn = new Set(agents.map((agent) => `agent-${agent._id}`));
  channelRows.forEach((channel) => {
    const target = entryId ?? `agent-${channel.agentId}`;
    if (!drawn.has(target)) return;
    const live = channel.status === "active";
    edges.push({
      id: `e-${channel._id}-entry`,
      source: `channel-${channel._id}`,
      sourceHandle: "out",
      target,
      targetHandle: "in",
      animated: live,
      style: {
        stroke: live ? LIVE : QUIET,
        strokeWidth: live ? 1.75 : 1.25,
        strokeOpacity: live ? 0.9 : 0.4,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: live ? LIVE : QUIET,
        width: 16,
        height: 16,
      },
    });
  });
  if (entryId && channels !== undefined && channelRows.length === 0) {
    edges.push({
      id: "e-placeholder-desk",
      source: "channel-placeholder",
      sourceHandle: "out",
      target: entryId,
      targetHandle: "in",
      style: { stroke: QUIET, strokeOpacity: 0.35, strokeDasharray: "4 4" },
    });
  }

  // --- column three: the specialists --------------------------------------
  specialists.forEach((agent, index) => {
    const routable = agent.status === "active" && agent.acceptsHandoff !== false;
    nodes.push(
      agentNode(
        agent,
        "specialist",
        { x: COLUMN.specialist, y: centre(specialists.length, index) },
        {
          routable: agent.acceptsHandoff !== false,
          routingNote: agent.routingDescription ?? "",
        }
      )
    );

    // Only a real handover is drawn. The front desk hands over to active
    // agents that accept one, so a draft or paused agent has no edge — which
    // is what makes "nothing to route to" visible at a glance.
    if (entryId && routable) {
      const noted = Boolean(agent.routingDescription?.trim());
      edges.push({
        id: `e-desk-${agent._id}`,
        source: entryId,
        sourceHandle: "out",
        target: `agent-${agent._id}`,
        targetHandle: "in",
        style: {
          stroke: LIVE,
          strokeWidth: 1.5,
          // A handover with nothing to route on is drawn faint: the line is
          // there, but the front desk will rarely take it.
          strokeOpacity: noted ? 0.7 : 0.3,
          strokeDasharray: noted ? undefined : "2 4",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: LIVE,
          width: 16,
          height: 16,
        },
      });
    }
  });

  // --- the follow-up desk --------------------------------------------------
  // Below the rest, on a dashed edge: it is not part of the live conversation
  // and never receives a handover. It reads threads that have gone quiet,
  // which is why the edge is drawn from the desk they arrived at.
  if (followUp) {
    const depth = Math.max(specialists.length, channelRows.length, 1);
    nodes.push(
      agentNode(
        followUp,
        "follow_up",
        { x: COLUMN.desk, y: centre(depth, depth - 1) + ROW + 24 },
        { detail: "Reviews quiet threads" }
      )
    );
    if (entryId) {
      edges.push({
        id: `e-desk-followup`,
        source: entryId,
        sourceHandle: "below",
        target: `agent-${followUp._id}`,
        targetHandle: "above",
        style: {
          stroke: QUIET,
          strokeOpacity: 0.55,
          strokeWidth: 1.25,
          strokeDasharray: "5 5",
        },
        label: "once quiet",
        labelStyle: { fontSize: 10, fill: QUIET },
        labelBgStyle: { fill: "var(--card)" },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
      });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * `maxZoom` because a workspace with two agents would otherwise be fitted by
 * blowing the nodes up to fill the canvas. Capped at 1 they stay their drawn
 * size and the graph sits in the middle of the space instead.
 */
const FIT_VIEW: FitViewOptions = { padding: 0.18, maxZoom: 1 };

/**
 * Keeps the whole graph centred in the canvas.
 *
 * The `fitView` prop on `<ReactFlow>` only runs once, at init — which is
 * before the nodes have been measured and before the channels query has come
 * back. So the first fit is against the agents alone, and the channel column
 * that arrives a moment later lands off the left edge with the view still
 * centred on where the graph used to end. Re-fitting once the nodes are
 * measured, and again whenever the set of them changes, is what actually
 * centres it.
 *
 * It also re-fits when the canvas is resized: on the agent map the inspector
 * takes 28rem out of the width when you pick a node, and without this the
 * graph is cropped by it rather than reframed beside it.
 *
 * Rendered as a child of `<ReactFlow>` because that is what puts it inside the
 * store provider `useReactFlow` reads. It draws nothing.
 */
function FitToContent({
  signature,
  container,
}: {
  /** The node ids, so a graph that gains or loses one is re-framed. */
  signature: string;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const { fitView } = useReactFlow();
  const initialised = useNodesInitialized();
  // The first fit is the page arriving, so it is instant; every later one is a
  // change to a graph already on screen, and animating shows what moved.
  const settled = useRef(false);

  useEffect(() => {
    if (!initialised) return;
    void fitView(settled.current ? { ...FIT_VIEW, duration: 200 } : FIT_VIEW);
    settled.current = true;
  }, [initialised, signature, fitView]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    // Skips the observer's initial call, which fires at the current size and
    // would fight the fit above on mount.
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      void fitView({ ...FIT_VIEW, duration: 200 });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [container, fitView]);

  return null;
}

/** What the marks mean, for anyone reading the map for the first time. */
function Legend() {
  return (
    <div className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border bg-card/90 px-3 py-2 text-[11px] text-muted-foreground shadow-sm backdrop-blur sm:flex">
      <span className="flex items-center gap-1.5">
        {/* React Flow draws a live edge as moving dashes; so does this. */}
        <svg width="22" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="22"
            y2="3"
            stroke={LIVE}
            strokeWidth="2"
            strokeDasharray="5 3"
          />
        </svg>
        Live channel
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="0" y1="3" x2="22" y2="3" stroke={LIVE} strokeWidth="2" />
        </svg>
        Hands over
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="22"
            y2="3"
            stroke={QUIET}
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        </svg>
        Once quiet
      </span>
      <span className="flex items-center gap-2">
        {(Object.keys(STATUS_DOT) as AgentStatus[]).map((status) => (
          <span key={status} className="flex items-center gap-1 capitalize">
            <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
            {status}
          </span>
        ))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The routing topology, drawn.
 *
 * It answers the questions the paragraphs above it used to: what arrives
 * where, which agents the front desk can actually hand to, and which are
 * sitting outside the roster because they are draft, paused, or set not to
 * accept a handover.
 *
 * Read-only. Nodes are fixed and unconnectable — this draws configuration, it
 * does not edit it — but clicking one opens that agent.
 */
export function AgentFlow({
  agents,
  base,
  className,
  selectedId,
  onSelectAgent,
}: {
  agents: Doc<"agents">[];
  base: string;
  /** Replaces the default fixed-height box, for a full-page canvas. */
  className?: string;
  /** Ringed on the canvas, so the inspector and the graph agree. */
  selectedId?: string | null;
  /**
   * Given, a click selects rather than navigates — which is what the
   * agent-config page wants, since its inspector is right there. Without it a
   * click opens the agent's own page, as before.
   */
  onSelectAgent?: (agentId: Id<"agents">) => void;
}) {
  const workspace = useWorkspace();
  const router = useRouter();
  const canvas = useRef<HTMLDivElement>(null);
  const channels = useQuery(api.channels.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const { nodes, edges } = useMemo(() => {
    const graph = buildGraph(agents, channels, base);
    if (!selectedId) return graph;
    return {
      edges: graph.edges,
      nodes: graph.nodes.map((node) =>
        node.id === `agent-${selectedId}`
          ? { ...node, selected: true }
          : node
      ),
    };
  }, [agents, channels, base, selectedId]);

  // Selection is not a reason to re-frame — only the shape of the graph is.
  const signature = nodes.map((node) => node.id).join("|");

  return (
    // React Flow measures its container, so the height has to come from
    // somewhere concrete — given a `flex-1` parent it renders 0px tall.
    //
    // shrink-0 with it, for the reason FrontDeskCard spells out on the same
    // page: `overflow-hidden` gives a flex item an automatic minimum size of
    // zero, so h-96 alone was no defence — as a shrinkable child of that
    // height-constrained, scrolling column this box absorbed the overflow and
    // collapsed to nothing, taking the whole diagram with it.
    <div
      ref={canvas}
      className={cn(
        // A soft wash from the palette's primary at the top left, so the
        // canvas reads as a surface of its own rather than a hole in the page.
        "w-full overflow-hidden border bg-muted/20 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklch,var(--primary)_7%,transparent),transparent_60%)]",
        className ?? "h-96 shrink-0 rounded-xl"
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={NODE_ORIGIN}
        fitView
        fitViewOptions={FIT_VIEW}
        // A diagram, not a canvas.
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        // The page scrolls; the graph must not eat the wheel to zoom, or
        // scrolling past this card traps the reader inside it. Zoom lives on
        // the controls instead.
        zoomOnScroll={false}
        preventScrolling={false}
        panOnDrag
        // Light, not "system": the nodes are drawn with the app's own tokens
        // and the app is light here, so a machine set to dark was giving the
        // canvas chrome — dots, controls — a dark ground under a light page.
        colorMode="light"
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => {
          const data = node.data as Partial<AgentData> & { href?: string };
          if (onSelectAgent && data.agentId) {
            onSelectAgent(data.agentId);
            return;
          }
          if (data.href) router.push(data.href);
        }}
      >
        <FitToContent signature={signature} container={canvas} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.2}
          color="var(--border)"
        />
        <Panel position="bottom-left">
          <Legend />
        </Panel>
        <Controls
          showInteractive={false}
          position="bottom-right"
          className="overflow-hidden rounded-lg border bg-card shadow-sm [&>button]:border-b [&>button]:bg-card [&>button:last-child]:border-b-0 [&>button:hover]:bg-muted"
        />
      </ReactFlow>
    </div>
  );
}
