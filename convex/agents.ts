import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { toneConfig } from "./schema";
import {
  DEFAULT_BUILTIN_TOOLS,
  BUILTIN_TOOLS,
  FOLLOW_UP_DEFAULTS,
  ROUTER_DEFAULTS,
  ROUTER_TOOLS,
  RICH_TOOL_NAMES,
  DEFAULT_CHAT_MODEL,
  slugify,
} from "./lib/shared";
import { compileSystemPrompt, type TeammateShape } from "./lib/prompt";
import {
  requireAgent,
  requireWorkspace,
} from "./lib/auth";

export const DEFAULT_TONE = {
  traits: ["professional", "warm", "clear", "consultative"],
  avoid: ["pushy", "robotic", "over-enthusiastic"],
  formality: "neutral" as const,
  emoji: "sparing" as const,
  responseLength: "short" as const,
  languages: ["English"],
  mirrorUserLanguage: true,
  // Off by default. It is a deliberate choice about how a business sounds, not
  // a setting to inherit without meaning to.
  humanVoice: false,
};

const agentFields = {
  name: v.optional(v.string()),
  routingDescription: v.optional(v.string()),
  acceptsHandoff: v.optional(v.boolean()),
  botName: v.optional(v.string()),
  role: v.optional(v.string()),
  objective: v.optional(v.string()),
  jobDescription: v.optional(v.string()),
  greeting: v.optional(v.string()),
  tone: v.optional(toneConfig),
  rules: v.optional(v.array(v.string())),
  guardrails: v.optional(v.array(v.string())),
  escalationPolicy: v.optional(v.string()),
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
  historyLimit: v.optional(v.number()),
  knowledgeEnabled: v.optional(v.boolean()),
  knowledgeTopK: v.optional(v.number()),
  builtinTools: v.optional(v.array(v.string())),
  promptOverride: v.optional(v.string()),
  status: v.optional(
    v.union(v.literal("draft"), v.literal("active"), v.literal("paused"))
  ),
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

// The string the model passes to transfer_to_agent. Derived from the internal
// name so it reads like a name rather than an id.
export function routingKeyFor(agent: Doc<"agents">): string {
  return slugify(agent.name) || slugify(agent.botName) || "agent";
}

// Two agents may share a name, so the second one gets a numbered key.
function withUniqueKeys(
  agents: Doc<"agents">[]
): Array<{ agent: Doc<"agents">; key: string }> {
  const seen = new Map<string, number>();
  return agents.map((agent) => {
    const base = routingKeyFor(agent);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { agent, key: count === 1 ? base : `${base}-${count}` };
  });
}

// Everyone in the workspace who may be handed a conversation: live specialists
// that have not opted out. The router is never a target — it only ever hands
// work outwards, so a conversation cannot be bounced back to the front desk.
async function handoffCandidates(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<Array<{ agent: Doc<"agents">; key: string }>> {
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  const eligible = agents
    .filter(
      (agent) =>
        // Only specialists take handoffs. The front desk hands work outwards
        // and the follow-up desk is not in the conversation at all, so an
        // undefined kind — every agent written before kinds existed — counts
        // as a specialist and nothing else does.
        (agent.kind === "specialist" || agent.kind === undefined) &&
        agent.status === "active" &&
        agent.acceptsHandoff !== false
    )
    .sort((a, b) => a.createdAt - b.createdAt);

  return withUniqueKeys(eligible);
}

/**
 * The roster one agent sees, as the prompt compiler wants it. Excludes the
 * agent itself (nobody transfers to themselves) and, on a second hop, whoever
 * just handed the conversation over.
 */
export const rosterForAgent = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    excludeAgentIds: v.optional(v.array(v.id("agents"))),
  },
  handler: async (ctx, args): Promise<TeammateShape[]> => {
    const excluded = new Set<string>([
      args.agentId,
      ...(args.excludeAgentIds ?? []),
    ]);
    const candidates = await handoffCandidates(ctx, args.workspaceId);
    return candidates
      .filter(({ agent }) => !excluded.has(agent._id))
      .map(({ agent, key }) => ({
        key,
        botName: agent.botName,
        role: agent.role,
        whenToUse: agent.routingDescription,
      }));
  },
});

/**
 * Resolves whatever the model passed for `agent` to a real agent id. Models
 * paraphrase, so a key, an internal name and the customer-facing name are all
 * accepted; anything else comes back as not-found and the tool says who is
 * actually available.
 */
export const resolveHandoffTarget = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    target: v.string(),
    excludeAgentIds: v.optional(v.array(v.id("agents"))),
  },
  handler: async (ctx, args) => {
    const excluded = new Set<string>([
      args.agentId,
      ...(args.excludeAgentIds ?? []),
    ]);
    const candidates = (await handoffCandidates(ctx, args.workspaceId)).filter(
      ({ agent }) => !excluded.has(agent._id)
    );

    const wanted = slugify(args.target);
    const match =
      candidates.find(({ key }) => key === wanted) ??
      candidates.find(({ agent }) => slugify(agent.name) === wanted) ??
      candidates.find(({ agent }) => slugify(agent.botName) === wanted) ??
      candidates.find(({ agent }) => slugify(agent.role) === wanted);

    if (!match) {
      return {
        found: false as const,
        available: candidates.map(({ key }) => key),
      };
    }
    return {
      found: true as const,
      agentId: match.agent._id,
      key: match.key,
      botName: match.agent.botName,
      role: match.agent.role,
    };
  },
});

// The workspace's default bot, if it has been provisioned.
export const findRouter = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("agents")
      .withIndex("by_workspace_kind", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("kind", "router")
      )
      .first();
  },
});

// Shared by the public mutation and by agents.create, so a workspace always
// has a front desk the moment it has anything to route to.
async function ensureRouter(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<{ agentId: Id<"agents">; created: boolean }> {
  const existing = await ctx.db
    .query("agents")
    .withIndex("by_workspace_kind", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", "router")
    )
    .first();
  if (existing) return { agentId: existing._id, created: false };

  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw new Error("Workspace not found");

  const now = Date.now();
  const agentId = await ctx.db.insert("agents", {
    workspaceId,
    kind: "router",
    // The front desk is the one agent nobody transfers *to*.
    acceptsHandoff: false,
    name: ROUTER_DEFAULTS.name,
    botName: workspace.name,
    role: ROUTER_DEFAULTS.role,
    objective: ROUTER_DEFAULTS.objective,
    jobDescription: ROUTER_DEFAULTS.jobDescription,
    tone: DEFAULT_TONE,
    rules: [...ROUTER_DEFAULTS.rules],
    guardrails: [...ROUTER_DEFAULTS.guardrails],
    escalationPolicy: ROUTER_DEFAULTS.escalationPolicy,
    model: DEFAULT_CHAT_MODEL,
    temperature: 0.2,
    // Routing is a one-decision job: greet, maybe search, transfer.
    maxSteps: 4,
    historyLimit: 12,
    knowledgeEnabled: true,
    knowledgeTopK: 4,
    builtinTools: [...ROUTER_TOOLS],
    // Live immediately: a front desk nobody switched on would silently drop
    // every inbound message.
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  // Agents that predate routing have no transfer tool, which would leave them
  // unable to hand work on. Backfilling once, here, keeps the roster mutual.
  const others = await ctx.db
    .query("agents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  for (const other of others) {
    if (other._id === agentId) continue;
    if (other.builtinTools.includes("transfer_to_agent")) continue;
    await ctx.db.patch(other._id, {
      builtinTools: [...other.builtinTools, "transfer_to_agent"],
      updatedAt: now,
    });
  }

  return { agentId, created: true };
}

/**
 * Provision the workspace's default bot. Idempotent.
 *
 * `repointChannels` sends every existing channel through the front desk, which
 * is the whole point of having one — but it changes how live WhatsApp numbers
 * behave, so it is opt-in and never happens as a side effect of creating an
 * agent.
 */
/**
 * Provision the workspace's follow-up desk. Idempotent.
 *
 * Kept out of every roster (acceptsHandoff false) and left active, because a
 * desk nobody switched on would silently stop the pipeline moving. It borrows
 * the front desk's tone so its nudges sound like the same company.
 */
async function ensureFollowUpDesk(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<{ agentId: Id<"agents">; created: boolean }> {
  const existing = await ctx.db
    .query("agents")
    .withIndex("by_workspace_kind", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", "follow_up")
    )
    .first();
  if (existing) return { agentId: existing._id, created: false };

  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw new Error("Workspace not found");

  const now = Date.now();
  const agentId = await ctx.db.insert("agents", {
    workspaceId,
    kind: "follow_up",
    acceptsHandoff: false,
    name: FOLLOW_UP_DEFAULTS.name,
    botName: workspace.name,
    role: FOLLOW_UP_DEFAULTS.role,
    objective: FOLLOW_UP_DEFAULTS.objective,
    jobDescription: FOLLOW_UP_DEFAULTS.jobDescription,
    tone: DEFAULT_TONE,
    rules: [...FOLLOW_UP_DEFAULTS.rules],
    guardrails: [...FOLLOW_UP_DEFAULTS.guardrails],
    model: DEFAULT_CHAT_MODEL,
    // Low: filing a lead against a written description is a judgement that
    // should come out the same way twice.
    temperature: 0.1,
    maxSteps: 1,
    historyLimit: 40,
    // It is handed the transcript directly and calls no tools, so retrieval
    // would only add cost.
    knowledgeEnabled: false,
    knowledgeTopK: 0,
    builtinTools: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return { agentId, created: true };
}

export const ensureDefaultFollowUpDesk = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ensureFollowUpDesk(ctx, args.workspaceId);
  },
});

export const ensureFollowUpDeskInternal = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => await ensureFollowUpDesk(ctx, args.workspaceId),
});

export const ensureDefaultRouter = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    repointChannels: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const result = await ensureRouter(ctx, args.workspaceId);

    let repointed = 0;
    if (args.repointChannels) {
      const channels = await ctx.db
        .query("channels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const channel of channels) {
        if (channel.agentId === result.agentId) continue;
        await ctx.db.patch(channel._id, {
          agentId: result.agentId,
          updatedAt: Date.now(),
        });
        repointed++;
      }
    }

    return { ...result, repointed };
  },
});

export const ensureDefaultRouterInternal = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => await ensureRouter(ctx, args.workspaceId),
});

// ---------------------------------------------------------------------------

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await requireAgent(ctx, args.agentId);
    return await ctx.db.get("agents", args.agentId);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    botName: v.optional(v.string()),
    role: v.optional(v.string()),
    objective: v.optional(v.string()),
    jobDescription: v.optional(v.string()),
    greeting: v.optional(v.string()),
    tone: v.optional(toneConfig),
    rules: v.optional(v.array(v.string())),
    guardrails: v.optional(v.array(v.string())),
    escalationPolicy: v.optional(v.string()),
    model: v.optional(v.string()),
    builtinTools: v.optional(v.array(v.string())),
    routingDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      workspaceId: args.workspaceId,
      kind: "specialist",
      acceptsHandoff: true,
      routingDescription: args.routingDescription?.trim() || undefined,
      name: args.name.trim(),
      botName: args.botName?.trim() || args.name.trim(),
      role: args.role?.trim() || "AI assistant",
      objective:
        args.objective?.trim() ||
        `Understand what the customer needs, answer accurately from ${workspace.name}'s knowledge base, and capture a complete enquiry for the team.`,
      jobDescription:
        args.jobDescription?.trim() ||
        "Greet the customer, find out what they need, ask for the details required one question at a time, confirm everything back, then record the enquiry.",
      greeting: args.greeting,
      tone: args.tone ?? DEFAULT_TONE,
      rules: args.rules ?? [],
      guardrails: args.guardrails ?? [],
      escalationPolicy:
        args.escalationPolicy ??
        "Hand over to a human if the customer asks for one, raises a complaint, or asks something you cannot answer after one attempt.",
      model: args.model ?? DEFAULT_CHAT_MODEL,
      temperature: 0.4,
      maxSteps: 6,
      historyLimit: 16,
      knowledgeEnabled: true,
      knowledgeTopK: 6,
      builtinTools: args.builtinTools ?? [...DEFAULT_BUILTIN_TOOLS],
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Every agent sits behind the default bot, so creating one provisions the
    // front desk if this workspace does not have it yet — and the follow-up
    // desk, which the lead pipeline needs before any lead exists.
    await ensureRouter(ctx, args.workspaceId);
    await ensureFollowUpDesk(ctx, args.workspaceId);

    return agentId;
  },
});

export const update = mutation({
  args: { agentId: v.id("agents"), ...agentFields },
  handler: async (ctx, args) => {
    await requireAgent(ctx, args.agentId);
    const { agentId, ...rest } = args;
    const existing = await ctx.db.get("agents", agentId);
    if (!existing) throw new Error("Agent not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }

    if (existing.kind === "router") {
      // The front desk must stay reachable and must stay out of its own
      // roster, whatever the form posts.
      patch.acceptsHandoff = false;
      if (patch.status === "draft") patch.status = "active";
      const tools = patch.builtinTools;
      if (Array.isArray(tools) && !tools.includes("transfer_to_agent")) {
        patch.builtinTools = [...tools, "transfer_to_agent"];
      }
    }

    await ctx.db.patch(agentId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await requireAgent(ctx, args.agentId);
    if (agent.kind === "router") {
      const pointed = await ctx.db
        .query("channels")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
        .collect();
      if (pointed.length > 0) {
        throw new Error(
          `The front desk still answers ${pointed.length} channel(s). Point them at another agent first.`
        );
      }
    }
    // Conversations and their messages
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id)
        )
        .collect();
      for (const message of messages) await ctx.db.delete(message._id);
      await ctx.db.delete(conversation._id);
    }

    // Conversations that were merely handed to this agent belong to another
    // entry agent, so they survive — but their active pointer must not dangle,
    // or the next inbound message has nobody to resume.
    const handedOver = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", agent.workspaceId))
      .collect();
    for (const conversation of handedOver) {
      if (conversation.activeAgentId !== args.agentId) continue;
      await ctx.db.patch(conversation._id, {
        activeAgentId: conversation.agentId,
      });
    }

    // Channels pointing at this agent
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    for (const channel of channels) await ctx.db.delete(channel._id);

    // Agent-scoped knowledge sources and their chunks
    const sources = await ctx.db
      .query("knowledgeSources")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    for (const source of sources) {
      const chunks = await ctx.db
        .query("knowledgeChunks")
        .withIndex("by_source", (q) => q.eq("sourceId", source._id))
        .collect();
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      if (source.storageId) await ctx.storage.delete(source.storageId);
      await ctx.db.delete(source._id);
    }

    // Agent-scoped custom tools
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    for (const tool of tools) await ctx.db.delete(tool._id);

    await ctx.db.delete(args.agentId);
    return { success: true };
  },
});

// Renders exactly the system prompt the runtime will send, minus retrieved
// knowledge (which depends on the incoming message).
export const previewPrompt = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await requireAgent(ctx, args.agentId);
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) return null;
    const workspace = await ctx.db.get("workspaces", agent.workspaceId);
    if (!workspace) return null;

    const customTools = await ctx.db
      .query("tools")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", agent.workspaceId))
      .collect();

    const toolNames = [
      ...agent.builtinTools
        .filter((key) => BUILTIN_TOOLS.some((t) => t.key === key))
        // The toggle is one key; the model is given eight named tools.
        // Expand it so this preview matches what actually arrives.
        .flatMap((key) =>
          key === "rich_messages"
            ? [...RICH_TOOL_NAMES]
            : [key]
        ),
      ...customTools
        .filter(
          (t) =>
            t.status === "enabled" &&
            (t.agentId === undefined || t.agentId === agent._id)
        )
        .map((t) => t.name),
    ];
    if (agent.kind === "router" && !toolNames.includes("transfer_to_agent")) {
      toolNames.unshift("transfer_to_agent");
    }

    const team = (await handoffCandidates(ctx, agent.workspaceId))
      .filter(({ agent: mate }) => mate._id !== agent._id)
      .map(({ agent: mate, key }) => ({
        key,
        botName: mate.botName,
        role: mate.role,
        whenToUse: mate.routingDescription,
      }));

    return {
      prompt: compileSystemPrompt({
        workspace,
        agent,
        toolNames,
        team,
        knowledgeContext: "«retrieved knowledge is injected here at runtime»",
      }),
      toolNames,
      team,
    };
  },
});

export const getInternal = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) return null;
    const workspace = await ctx.db.get("workspaces", agent.workspaceId);
    if (!workspace) return null;
    return { agent, workspace };
  },
});
