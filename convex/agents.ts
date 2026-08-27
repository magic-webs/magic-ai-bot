import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { toneConfig } from "./schema";
import { DEFAULT_BUILTIN_TOOLS, BUILTIN_TOOLS } from "./lib/shared";
import { compileSystemPrompt } from "./lib/prompt";
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
};

const agentFields = {
  name: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const now = Date.now();
    return await ctx.db.insert("agents", {
      workspaceId: args.workspaceId,
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
      model: args.model ?? "gpt-4.1-mini",
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
    await ctx.db.patch(agentId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await requireAgent(ctx, args.agentId);
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
      ...agent.builtinTools.filter((key) =>
        BUILTIN_TOOLS.some((t) => t.key === key)
      ),
      ...customTools
        .filter(
          (t) =>
            t.status === "enabled" &&
            (t.agentId === undefined || t.agentId === agent._id)
        )
        .map((t) => t.name),
    ];

    return {
      prompt: compileSystemPrompt({
        workspace,
        agent,
        toolNames,
        knowledgeContext: "«retrieved knowledge is injected here at runtime»",
      }),
      toolNames,
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
