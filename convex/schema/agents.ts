import { defineTable } from "convex/server";
import { v } from "convex/values";
import { kvPair, toneConfig, toolParameter } from "./validators";

export const agentsTables = {
  agents: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.optional(
      v.union(
        v.literal("router"),
        v.literal("specialist"),
        v.literal("follow_up"),
        v.literal("marketing")
      )
    ),
    routingDescription: v.optional(v.string()),
    acceptsHandoff: v.optional(v.boolean()),
    name: v.string(),
    botName: v.string(),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
    role: v.string(),
    objective: v.string(),
    jobDescription: v.string(),
    greeting: v.optional(v.string()),
    tone: toneConfig,
    rules: v.array(v.string()),
    guardrails: v.array(v.string()),
    escalationPolicy: v.optional(v.string()),
    model: v.string(),
    temperature: v.number(),
    maxSteps: v.number(),
    historyLimit: v.number(),
    knowledgeEnabled: v.boolean(),
    knowledgeTopK: v.number(),
    builtinTools: v.array(v.string()),
    integrationTools: v.optional(v.array(v.string())),
    recordBooks: v.optional(v.array(v.id("recordBooks"))),
    promptOverride: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("paused")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_kind", ["workspaceId", "kind"]),

  tools: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    name: v.string(),
    displayName: v.string(),
    description: v.string(),
    whenToUse: v.optional(v.string()),
    kind: v.union(v.literal("http"), v.literal("db_query")),
    parameters: v.array(toolParameter),
    http: v.optional(
      v.object({
        method: v.union(
          v.literal("GET"),
          v.literal("POST"),
          v.literal("PUT"),
          v.literal("PATCH"),
          v.literal("DELETE")
        ),
        urlTemplate: v.string(),
        headers: v.array(kvPair),
        bodyTemplate: v.optional(v.string()),
        timeoutMs: v.optional(v.number()),
      })
    ),
    dbQuery: v.optional(
      v.object({
        table: v.union(
          v.literal("products"),
          v.literal("orders"),
          v.literal("contacts")
        ),
        searchParam: v.optional(v.string()),
        limit: v.number(),
      })
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("enabled"),
      v.literal("disabled")
    ),
    origin: v.union(v.literal("manual"), v.literal("ai_drafted")),
    sourceTask: v.optional(v.string()),
    integration: v.optional(v.string()),
    callCount: v.number(),
    lastCalledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_name", ["workspaceId", "name"])
    .index("by_agent", ["agentId"]),

  knowledgeSources: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    title: v.string(),
    kind: v.union(
      v.literal("text"),
      v.literal("faq"),
      v.literal("url"),
      v.literal("file")
    ),
    rawText: v.optional(v.string()),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    tags: v.array(v.string()),
    chunkCount: v.number(),
    charCount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_agent", ["agentId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  knowledgeChunks: defineTable({
    workspaceId: v.id("workspaces"),
    sourceId: v.id("knowledgeSources"),
    sourceTitle: v.string(),
    text: v.string(),
    order: v.number(),
    embedding: v.array(v.float64()),
    scopeKey: v.string(),
  })
    .index("by_source", ["sourceId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["scopeKey"],
    }),

  aiModels: defineTable({
    modelId: v.string(),
    label: v.string(),
    kind: v.union(v.literal("chat"), v.literal("embedding")),
    inputPer1M: v.number(),
    outputPer1M: v.number(),
    enabled: v.boolean(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_modelId", ["modelId"]),

  assistantMessages: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_agent", ["workspaceId", "agentId"]),
};
