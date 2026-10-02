import { defineTable } from "convex/server";
import { v } from "convex/values";
import { kvPair } from "./validators";

export const conversationsTables = {
  channels: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    type: v.union(v.literal("whatsapp"), v.literal("web")),
    name: v.string(),
    channelKey: v.string(),
    externalId: v.optional(v.string()),
    whatsapp: v.optional(
      v.object({
        apiBaseUrl: v.string(),
        apiVersion: v.string(),
        phoneNumberId: v.string(),
        wabaId: v.optional(v.string()),
        businessId: v.optional(v.string()),
        displayPhoneNumber: v.optional(v.string()),
        accessToken: v.string(),
      })
    ),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("error")
    ),
    lastInboundAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_agent", ["agentId"])
    .index("by_channelKey", ["channelKey"])
    .index("by_externalId", ["externalId"]),

  contacts: defineTable({
    workspaceId: v.id("workspaces"),
    externalId: v.string(),
    channelType: v.union(v.literal("whatsapp"), v.literal("web")),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    remark: v.optional(v.string()),
    birthday: v.optional(v.string()),
    attributes: v.array(kvPair),
    lastSeenAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_external", ["workspaceId", "externalId"])
    .index("by_workspace_and_birthday", ["workspaceId", "birthday"]),

  conversations: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    activeAgentId: v.optional(v.id("agents")),
    handoffCount: v.optional(v.number()),
    contactId: v.id("contacts"),
    humanHandling: v.optional(v.boolean()),
    humanHandlingAt: v.optional(v.number()),
    humanHandlingUntil: v.optional(v.number()),
    channelId: v.optional(v.id("channels")),
    channelType: v.union(v.literal("whatsapp"), v.literal("web")),
    status: v.union(
      v.literal("open"),
      v.literal("escalated"),
      v.literal("closed")
    ),
    messageCount: v.number(),
    messageLimitReachedAt: v.optional(v.number()),
    markedBot: v.optional(v.boolean()),
    markedBotAt: v.optional(v.number()),
    repeatText: v.optional(v.string()),
    repeatCount: v.optional(v.number()),
    lastMessageAt: v.number(),
    lastMessagePreview: v.optional(v.string()),
    lastMessageRole: v.optional(
      v.union(v.literal("user"), v.literal("assistant"))
    ),
    leadStageId: v.optional(v.id("leadStages")),
    leadStageNote: v.optional(v.string()),
    leadStagePinned: v.optional(v.boolean()),
    reviewedAt: v.optional(v.number()),
    followUpCount: v.optional(v.number()),
    lastFollowUpAt: v.optional(v.number()),
    marketingOnly: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_agent", ["agentId"])
    .index("by_contact_agent", ["contactId", "agentId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_lastMessageAt", ["workspaceId", "lastMessageAt"])
    .index("by_workspace_stage", ["workspaceId", "leadStageId"])
    .index("by_humanHandlingAt", ["humanHandlingAt"])
    .index("by_humanHandlingUntil", ["humanHandlingUntil"])
    .index("by_marketingOnly_and_lastMessageAt", ["marketingOnly", "lastMessageAt"]),

  messages: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system")
    ),
    kind: v.union(
      v.literal("text"),
      v.literal("tool"),
      v.literal("note"),
      v.literal("error"),
      v.literal("handoff"),
      v.literal("rich")
    ),
    text: v.optional(v.string()),
    payload: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    sentByHuman: v.optional(v.boolean()),
    teamMemberId: v.optional(v.id("teamMembers")),
    toolName: v.optional(v.string()),
    toolInput: v.optional(v.string()),
    toolOutput: v.optional(v.string()),
    toolOk: v.optional(v.boolean()),
    latencyMs: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_workspace", ["workspaceId"]),

  leadStages: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.string(),
    position: v.number(),
    outcome: v.union(
      v.literal("open"),
      v.literal("won"),
      v.literal("lost")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
};
