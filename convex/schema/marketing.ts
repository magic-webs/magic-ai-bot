import { defineTable } from "convex/server";
import { v } from "convex/values";
import { deliveryStatus } from "./validators";

export const audienceSelection = v.object({
  audienceIds: v.array(v.id("audiences")),
  categories: v.array(v.string()),
  tags: v.array(v.string()),
  excludeAudienceIds: v.array(v.id("audiences")),
});

export const audienceCategory = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
});

export const marketingTables = {
  marketingTemplates: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    occasion: v.union(
      v.literal("birthday"),
      v.literal("festival"),
      v.literal("offer"),
      v.literal("event"),
      v.literal("general")
    ),
    body: v.string(),
    metaTemplateName: v.optional(v.string()),
    metaStatus: v.optional(v.string()),
    metaTemplateId: v.optional(v.string()),
    metaRejectedReason: v.optional(v.string()),
    appliedAt: v.optional(v.number()),
    languageCode: v.string(),
    category: v.optional(
      v.union(
        v.literal("marketing"),
        v.literal("utility"),
        v.literal("authentication")
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_metaStatus", ["metaStatus"]),

  marketingEvents: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    date: v.string(),
    sendHour: v.number(),
    sendAt: v.number(),
    templateId: v.optional(v.id("marketingTemplates")),
    presetKey: v.optional(v.string()),
    note: v.optional(v.string()),
    campaignId: v.optional(v.id("marketingCampaigns")),
    offsetDays: v.optional(v.number()),
    message: v.optional(v.string()),
    audience: v.optional(audienceSelection),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed")
    ),
    sentCount: v.number(),
    failedCount: v.number(),
    lastError: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_and_date", ["workspaceId", "date"])
    .index("by_status_and_sendAt", ["status", "sendAt"])
    .index("by_campaignId", ["campaignId"]),

  marketingCampaigns: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    date: v.string(),
    startTime: v.optional(v.string()),
    venue: v.optional(v.string()),
    details: v.string(),
    offer: v.optional(v.string()),
    link: v.optional(v.string()),
    templateId: v.optional(v.id("marketingTemplates")),
    sendHour: v.number(),
    audience: v.optional(audienceSelection),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace_and_date", ["workspaceId", "date"]),

  marketingSettings: defineTable({
    workspaceId: v.id("workspaces"),
    birthdayEnabled: v.boolean(),
    birthdayTemplateId: v.optional(v.id("marketingTemplates")),
    birthdayHour: v.number(),
    lastBirthdayRun: v.optional(v.string()),
    weeklyCap: v.optional(v.number()),
    categories: v.optional(v.array(audienceCategory)),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_birthdayEnabled", ["birthdayEnabled"]),

  marketingSends: defineTable({
    workspaceId: v.id("workspaces"),
    contactId: v.id("contacts"),
    eventId: v.optional(v.id("marketingEvents")),
    key: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    text: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    messageId: v.optional(v.id("messages")),
    delivery: v.optional(deliveryStatus),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
    optedOutAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_contact_and_key", ["contactId", "key"])
    .index("by_contactId_and_createdAt", ["contactId", "createdAt"])
    .index("by_key_and_createdAt", ["key", "createdAt"])
    .index("by_messageId", ["messageId"])
    .index("by_workspace", ["workspaceId"]),

  marketingStats: defineTable({
    workspaceId: v.id("workspaces"),
    key: v.string(),
    shard: v.number(),
    sent: v.number(),
    failed: v.number(),
    delivered: v.number(),
    read: v.number(),
    replied: v.number(),
    clicked: v.number(),
    optedOut: v.number(),
  }).index("by_key_and_shard", ["key", "shard"]),

  audiences: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    source: v.union(
      v.literal("import"),
      v.literal("manual"),
      v.literal("retarget")
    ),
    memberCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  audienceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    audienceId: v.id("audiences"),
    contactId: v.id("contacts"),
    addedAt: v.number(),
  })
    .index("by_audienceId_and_contactId", ["audienceId", "contactId"])
    .index("by_contactId", ["contactId"]),
};
