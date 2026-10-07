import { defineTable } from "convex/server";
import { v } from "convex/values";

export const integrationsTables = {
  integrationConnections: defineTable({
    workspaceId: v.id("workspaces"),
    integration: v.string(),
    provider: v.literal("google"),
    accountEmail: v.optional(v.string()),
    scopes: v.array(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    resource: v.optional(
      v.object({
        id: v.string(),
        name: v.string(),
        url: v.optional(v.string()),
      })
    ),
    callToken: v.string(),
    status: v.union(v.literal("connected"), v.literal("needs_reauth")),
    lastError: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_integration", ["workspaceId", "integration"])
    .index("by_call_token", ["callToken"]),

  integrationOAuthStates: defineTable({
    state: v.string(),
    workspaceId: v.id("workspaces"),
    integration: v.string(),
    returnTo: v.string(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  appConnections: defineTable({
    workspaceId: v.id("workspaces"),
    app: v.union(v.literal("magic_forms"), v.literal("magic_reward")),
    apiKey: v.string(),
    baseUrl: v.string(),
    account: v.object({ id: v.string(), name: v.string(), slug: v.string() }),
    inboundKey: v.string(),
    webhookSecret: v.string(),
    remoteWebhookId: v.optional(v.string()),
    items: v.array(
      v.object({
        id: v.string(),
        key: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        url: v.optional(v.string()),
        kind: v.optional(v.string()),
        groupKey: v.optional(v.string()),
        prefill: v.optional(
          v.array(
            v.object({
              key: v.string(),
              label: v.string(),
              type: v.string(),
              required: v.boolean(),
              multiple: v.boolean(),
              options: v.optional(
                v.array(v.object({ label: v.string(), value: v.string() }))
              ),
            })
          )
        ),
        prizes: v.optional(
          v.array(v.object({ label: v.string(), isWin: v.boolean() }))
        ),
      })
    ),
    replyOnResult: v.boolean(),
    status: v.union(v.literal("connected"), v.literal("error")),
    lastError: v.optional(v.string()),
    sentCount: v.number(),
    resultCount: v.number(),
    lastResultAt: v.optional(v.number()),
    syncedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_app", ["workspaceId", "app"])
    .index("by_inboundKey", ["inboundKey"]),

  appLinks: defineTable({
    workspaceId: v.id("workspaces"),
    connectionId: v.id("appConnections"),
    app: v.union(v.literal("magic_forms"), v.literal("magic_reward")),
    ref: v.string(),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    agentId: v.optional(v.id("agents")),
    itemKey: v.string(),
    itemTitle: v.string(),
    url: v.string(),
    resultCount: v.number(),
    lastResultAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_ref", ["ref"])
    .index("by_conversation", ["conversationId"]),

  appDeliveries: defineTable({
    connectionId: v.id("appConnections"),
    deliveryId: v.string(),
    createdAt: v.number(),
  })
    .index("by_connection_delivery", ["connectionId", "deliveryId"])
    .index("by_createdAt", ["createdAt"]),

  formSubmissions: defineTable({
    workspaceId: v.id("workspaces"),
    accountId: v.string(),
    submissionId: v.string(),
    formKey: v.string(),
    formTitle: v.string(),
    answers: v.array(
      v.object({ key: v.string(), label: v.string(), value: v.string() })
    ),
    viewUrl: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    agentId: v.optional(v.id("agents")),
    recordId: v.optional(v.id("records")),
    submittedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_account", ["workspaceId", "accountId", "submittedAt"])
    .index("by_account_form", [
      "workspaceId",
      "accountId",
      "formKey",
      "submittedAt",
    ])
    .index("by_submission", ["workspaceId", "submissionId"]),
};
