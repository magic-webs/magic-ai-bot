import { defineTable } from "convex/server";
import { v } from "convex/values";
import { channelType, deliveryStatus, kvPair } from "./validators";

export const conversationsTables = {
  channels: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    type: channelType,
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
    instagram: v.optional(
      v.object({
        userId: v.string(),
        username: v.string(),
        name: v.optional(v.string()),
        profilePictureUrl: v.optional(v.string()),
        accessToken: v.string(),
        tokenExpiresAt: v.number(),
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
    .index("by_externalId", ["externalId"])
    .index("by_type", ["type"]),

  instagramOAuthStates: defineTable({
    state: v.string(),
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    returnTo: v.string(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  instagramEvents: defineTable({
    mid: v.string(),
    createdAt: v.number(),
  })
    .index("by_mid", ["mid"])
    .index("by_createdAt", ["createdAt"]),

  contacts: defineTable({
    workspaceId: v.id("workspaces"),
    externalId: v.string(),
    channelType,
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    remark: v.optional(v.string()),
    birthday: v.optional(v.string()),
    attributes: v.array(kvPair),
    source: v.optional(
      v.union(
        v.literal("whatsapp"),
        v.literal("web"),
        v.literal("instagram"),
        v.literal("manual"),
        v.literal("import")
      )
    ),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    optedOutAt: v.optional(v.number()),
    optOutReason: v.optional(
      v.union(v.literal("keyword"), v.literal("manual"), v.literal("import"))
    ),
    lastSeenAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_external", ["workspaceId", "externalId"])
    .index("by_workspace_and_birthday", ["workspaceId", "birthday"])
    .index("by_workspace_and_category", ["workspaceId", "category"]),

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
    channelType,
    status: v.union(
      v.literal("open"),
      v.literal("escalated"),
      v.literal("closed")
    ),
    messageCount: v.number(),
    messageLimitReachedAt: v.optional(v.number()),
    limitSessionStartedAt: v.optional(v.number()),
    limitSessionStartCount: v.optional(v.number()),
    markedBot: v.optional(v.boolean()),
    markedBotAt: v.optional(v.number()),
    repeatText: v.optional(v.string()),
    repeatCount: v.optional(v.number()),
    lastMessageAt: v.number(),
    lastMessagePreview: v.optional(v.string()),
    lastMessageRole: v.optional(
      v.union(v.literal("user"), v.literal("assistant"))
    ),
    lastMessageFrom: v.optional(
      v.union(
        v.literal("customer"),
        v.literal("agent"),
        v.literal("team"),
        v.literal("system")
      )
    ),
    lastMessageSender: v.optional(v.string()),
    lastMessageDelivery: v.optional(deliveryStatus),
    unreadCount: v.optional(v.number()),
    searchText: v.optional(v.string()),
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
    .index("by_workspace_status_lastMessageAt", ["workspaceId", "status", "lastMessageAt"])
    .index("by_workspace_role_lastMessageAt", ["workspaceId", "lastMessageRole", "lastMessageAt"])
    .index("by_workspace_stage", ["workspaceId", "leadStageId"])
    .index("by_humanHandlingAt", ["humanHandlingAt"])
    .index("by_humanHandlingUntil", ["humanHandlingUntil"])
    .index("by_marketingOnly_and_lastMessageAt", ["marketingOnly", "lastMessageAt"])
    .searchIndex("search_inbox", {
      searchField: "searchText",
      filterFields: ["workspaceId", "status", "channelType", "channelId"],
    }),

  inboxCounts: defineTable({
    workspaceId: v.id("workspaces"),
    total: v.number(),
    open: v.number(),
    escalated: v.number(),
    closed: v.number(),
    unread: v.number(),
    escalatedUnread: v.number(),
    team: v.number(),
    bots: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  dailyStats: defineTable({
    workspaceId: v.id("workspaces"),
    day: v.string(),
    messages: v.number(),
    latencyTotalMs: v.number(),
    latencyCount: v.number(),
  }).index("by_workspace_day", ["workspaceId", "day"]),

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
    delivery: v.optional(deliveryStatus),
    deliveryError: v.optional(v.string()),
    deliveryAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_workspace", ["workspaceId"]),

  whatsappMessageIds: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    wamid: v.string(),
    createdAt: v.number(),
  })
    .index("by_wamid", ["wamid"])
    .index("by_messageId", ["messageId"]),

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
