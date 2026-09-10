"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  BooksIcon,
  FunnelIcon,
  GlobeIcon,
  RobotIcon,
  SignpostIcon,
  WhatsappLogoIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// Nodes
//
// Styled with the app's own tokens rather than React Flow's, so the graph
// follows the workspace palette and both themes without a second set of
// colours to keep in step.
// ---------------------------------------------------------------------------

type ChannelData = {
  label: string;
  detail: string;
  channel: "whatsapp" | "web";
  live: boolean;
};

type AgentData = {
  label: string;
  detail: string;
  kind: "router" | "specialist" | "follow_up";
  status: "draft" | "active" | "paused";
  /** Absent for the desks, which are not routed to. */
  routable?: boolean;
  href: string;
  agentId: Id<"agents">;
  /** What this agent is set up with. Icons and a count, never a sentence. */
  config: { knowledge: boolean; tools: number; model: string };
};

const shell =
  "flex w-56 items-start gap-2 rounded-xl border bg-card px-3 py-2 text-left shadow-sm";

function ChannelNode({ data }: NodeProps<Node<ChannelData>>) {
  const Icon = data.channel === "whatsapp" ? WhatsappLogoIcon : GlobeIcon;
  return (
    <div className={cn(shell, !data.live && "opacity-60")}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{data.label}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {data.detail}
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}

function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  const Icon =
    data.kind === "router"
      ? SignpostIcon
      : data.kind === "follow_up"
        ? FunnelIcon
        : RobotIcon;

  return (
    <div
      className={cn(
        shell,
        "cursor-pointer transition-colors hover:border-primary/60",
        // React Flow puts `.selected` on the wrapper, so the ring is asked
        // for from there rather than threaded through node data.
        "[.selected>&]:border-primary [.selected>&]:ring-2 [.selected>&]:ring-primary/30",
        data.kind === "router" && "border-primary/50 ring-1 ring-primary/20",
        data.status !== "active" && "opacity-70"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          data.kind === "router"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium">{data.label}</span>
          {data.status !== "active" ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {data.status}
            </Badge>
          ) : null}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {data.detail}
        </p>
        {/* Active but out of the roster: reachable by a channel pointed
            straight at it, never by a handover. Worth saying on the node,
            because the missing edge is otherwise indistinguishable from a
            drawing mistake. */}
        {data.routable === false && data.status === "active" ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground italic">
            no handover
          </p>
        ) : null}

        {/* What it is set up with, as marks rather than prose: whether it can
            read the knowledge base, and how many tools it may call. The model
            is on the hover title — it is the longest string here and the least
            often asked. */}
        <p
          className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"
          title={`Model: ${data.config.model}`}
        >
          <span
            className={cn(
              "flex items-center gap-0.5",
              !data.config.knowledge && "opacity-40 line-through"
            )}
          >
            <BooksIcon className="size-3" />
          </span>
          <span className="flex items-center gap-0.5">
            <WrenchIcon className="size-3" />
            {data.config.tools}
          </span>
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}

// Defined once, at module scope: React Flow warns (and remounts every node) if
// this object is a new identity on each render.
const nodeTypes = { channel: ChannelNode, agent: AgentNode };

// ---------------------------------------------------------------------------
// Layout
//
// Positions are computed rather than laid out by a graph library: this shape
// is always the same three columns — where conversations arrive, the front
// desk, and who it hands to — so there is nothing for one to work out.
// ---------------------------------------------------------------------------

const COLUMN = { channel: 0, desk: 300, specialist: 600 };
const ROW = 84;

function buildGraph(
  agents: Doc<"agents">[],
  channels: Array<{ _id: string; name: string; type: string; status: string }>,
  base: string
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const router = agents.find((agent) => agent.kind === "router");
  const followUp = agents.find((agent) => agent.kind === "follow_up");
  // An agent with no kind predates kinds and is a specialist, which is why
  // this excludes the two desks rather than testing for "specialist".
  const specialists = agents.filter(
    (agent) => agent.kind !== "router" && agent.kind !== "follow_up"
  );

  const centre = (count: number, index: number) =>
    (index - (count - 1) / 2) * ROW;

  // --- column one: where conversations arrive -----------------------------
  channels.forEach((channel, index) => {
    nodes.push({
      id: `channel-${channel._id}`,
      type: "channel",
      position: { x: COLUMN.channel, y: centre(channels.length, index) },
      data: {
        label: channel.name,
        detail: channel.status === "active" ? "live" : channel.status,
        channel: channel.type === "whatsapp" ? "whatsapp" : "web",
        live: channel.status === "active",
      } satisfies ChannelData,
      draggable: false,
    });
  });

  // --- column two: the front desk -----------------------------------------
  const entryId = router ? `agent-${router._id}` : null;
  if (router) {
    nodes.push({
      id: `agent-${router._id}`,
      type: "agent",
      position: { x: COLUMN.desk, y: 0 },
      data: {
        label: router.botName,
        detail: router.role,
        kind: "router",
        status: router.status,
        href: `${base}/agents/${router._id}`,
        agentId: router._id,
        config: {
          knowledge: router.knowledgeEnabled,
          tools: router.builtinTools.length,
          model: router.model,
        },
      } satisfies AgentData,
      draggable: false,
    });
  }

  // Every channel arrives at the front desk. Without one, each channel is
  // stuck with whatever single agent it points at, so the edge goes straight
  // to that agent instead — which is the whole argument for a front desk,
  // drawn rather than explained.
  channels.forEach((channel) => {
    if (!entryId) return;
    edges.push({
      id: `e-${channel._id}-desk`,
      source: `channel-${channel._id}`,
      target: entryId,
      animated: channel.status === "active",
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  });

  // --- column three: the specialists --------------------------------------
  specialists.forEach((agent, index) => {
    const routable = agent.status === "active" && agent.acceptsHandoff !== false;
    nodes.push({
      id: `agent-${agent._id}`,
      type: "agent",
      position: {
        x: COLUMN.specialist,
        y: centre(specialists.length, index),
      },
      data: {
        label: agent.botName,
        detail: agent.role,
        kind: "specialist",
        status: agent.status,
        routable: agent.acceptsHandoff !== false,
        href: `${base}/agents/${agent._id}`,
        agentId: agent._id,
        config: {
          knowledge: agent.knowledgeEnabled,
          tools: agent.builtinTools.length,
          model: agent.model,
        },
      } satisfies AgentData,
      draggable: false,
    });

    // Only a real handover is drawn. The front desk hands over to active
    // agents that accept one, so a draft or paused agent has no edge — which
    // is what makes "nothing to route to" visible at a glance.
    if (entryId && routable) {
      edges.push({
        id: `e-desk-${agent._id}`,
        source: entryId,
        target: `agent-${agent._id}`,
        label: agent.routingDescription ? undefined : "no routing note",
        labelStyle: { fontSize: 10 },
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  });

  // --- the follow-up desk --------------------------------------------------
  // Below the rest, on a dashed edge: it is not part of the live conversation
  // and never receives a handover. It reads threads that have gone quiet,
  // which is why the edge is drawn from the desk they arrived at.
  if (followUp) {
    const depth = Math.max(specialists.length, channels.length, 1);
    nodes.push({
      id: `agent-${followUp._id}`,
      type: "agent",
      position: { x: COLUMN.desk, y: centre(depth, depth - 1) + ROW + 40 },
      data: {
        label: followUp.botName,
        detail: "Reviews quiet threads",
        kind: "follow_up",
        status: followUp.status,
        href: `${base}/agents/${followUp._id}`,
        agentId: followUp._id,
        config: {
          knowledge: followUp.knowledgeEnabled,
          tools: followUp.builtinTools.length,
          model: followUp.model,
        },
      } satisfies AgentData,
      draggable: false,
    });
    if (entryId) {
      edges.push({
        id: `e-desk-followup`,
        source: entryId,
        target: `agent-${followUp._id}`,
        animated: false,
        style: { strokeDasharray: "4 4" },
        label: "once quiet",
        labelStyle: { fontSize: 10 },
      });
    }
  }

  return { nodes, edges };
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
  const channels = useQuery(api.channels.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const { nodes, edges } = useMemo(() => {
    const graph = buildGraph(agents, channels ?? [], base);
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
      className={cn(
        "w-full overflow-hidden border bg-muted/20",
        className ?? "h-96 shrink-0 rounded-xl"
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
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
          const data = node.data as Partial<AgentData>;
          if (onSelectAgent && data.agentId) {
            onSelectAgent(data.agentId);
            return;
          }
          if (data.href) router.push(data.href);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
