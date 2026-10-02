import { defineTable } from "convex/server";
import { v } from "convex/values";
import { kvPair } from "./validators";

export const notificationsTables = {
  notificationSettings: defineTable({
    workspaceId: v.id("workspaces"),
    whatsappChannelId: v.optional(v.id("channels")),
    defaultCountryCode: v.optional(v.string()),
    zeptoRegion: v.optional(v.string()),
    zeptoToken: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    templatesSyncedAt: v.optional(v.number()),
    templatesSyncError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  notificationRules: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    enabled: v.boolean(),
    event: v.union(
      v.literal("record_filed"),
      v.literal("record_updated"),
      v.literal("record_stage_changed"),
      v.literal("order_created"),
      v.literal("escalation"),
      v.literal("inbound")
    ),
    bookId: v.optional(v.id("recordBooks")),
    stage: v.optional(v.string()),
    inboundKey: v.optional(v.string()),
    lastInboundPayload: v.optional(v.string()),
    inboundSampleAt: v.optional(v.number()),
    inboundCapture: v.optional(v.boolean()),
    lastInboundAt: v.optional(v.number()),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    whatsappTemplateName: v.optional(v.string()),
    whatsappLanguage: v.optional(v.string()),
    emailTemplateId: v.optional(v.id("emailTemplates")),
    params: v.array(kvPair),
    recipients: v.array(v.string()),
    sentCount: v.number(),
    failedCount: v.number(),
    lastFiredAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_event", ["workspaceId", "event"])
    .index("by_inboundKey", ["inboundKey"]),

  notificationLogs: defineTable({
    workspaceId: v.id("workspaces"),
    ruleId: v.optional(v.id("notificationRules")),
    ruleName: v.optional(v.string()),
    event: v.optional(v.string()),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    to: v.string(),
    templateName: v.optional(v.string()),
    subject: v.optional(v.string()),
    preview: v.optional(v.string()),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    error: v.optional(v.string()),
    messageId: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("test"), v.literal("manual"))),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_rule", ["ruleId"]),

  whatsappTemplates: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    providerId: v.optional(v.string()),
    name: v.string(),
    language: v.string(),
    category: v.string(),
    status: v.string(),
    components: v.string(),
    syncedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_channel", ["channelId"]),

  emailTemplates: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    subject: v.string(),
    body: v.string(),
    format: v.union(v.literal("text"), v.literal("html")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  pushTokens: defineTable({
    workspaceId: v.id("workspaces"),
    token: v.string(),
    platform: v.union(
      v.literal("ios"),
      v.literal("android"),
      v.literal("web")
    ),
    deviceName: v.optional(v.string()),
    disabledAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_workspace", ["workspaceId"]),

  pushInbox: defineTable({
    workspaceId: v.id("workspaces"),
    event: v.string(),
    title: v.string(),
    body: v.string(),
    conversationId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_created", ["createdAt"]),
};
