import { defineTable } from "convex/server";
import { v } from "convex/values";
import { kvPair, requirementField, productImage, orderStatus } from "./validators";

export const recordsTables = {
  products: defineTable({
    workspaceId: v.id("workspaces"),
    slug: v.string(),
    sku: v.optional(v.string()),
    name: v.string(),
    category: v.string(),
    description: v.string(),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    unit: v.optional(v.string()),
    requirementFields: v.array(requirementField),
    images: v.optional(v.array(productImage)),
    attributes: v.array(kvPair),
    exampleSpec: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.array(v.string()),
    searchBlob: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_slug", ["workspaceId", "slug"])
    .index("by_workspace_category", ["workspaceId", "category"])
    .searchIndex("search_products", {
      searchField: "searchBlob",
      filterFields: ["workspaceId", "status"],
    }),

  orders: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    orderNumber: v.string(),
    customer: v.object({
      name: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      company: v.optional(v.string()),
    }),
    items: v.array(
      v.object({
        productId: v.optional(v.id("products")),
        productName: v.string(),
        quantity: v.string(),
        unitPrice: v.optional(v.number()),
        specs: v.array(kvPair),
      })
    ),
    delivery: v.optional(
      v.object({
        address: v.optional(v.string()),
        city: v.optional(v.string()),
        postcode: v.optional(v.string()),
        country: v.optional(v.string()),
        requiredDate: v.optional(v.string()),
      })
    ),
    notes: v.optional(v.string()),
    total: v.optional(v.number()),
    currency: v.optional(v.string()),
    source: v.union(v.literal("whatsapp"), v.literal("web"), v.literal("api")),
    status: orderStatus,
    rawPayload: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_contact", ["contactId"])
    .index("by_conversation", ["conversationId"]),

  recordBooks: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    pluralName: v.string(),
    handle: v.string(),
    purpose: v.string(),
    fields: v.array(requirementField),
    stages: v.array(v.string()),
    referencePrefix: v.string(),
    allowLookup: v.boolean(),
    allowUpdate: v.boolean(),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived")
    ),
    formSource: v.optional(
      v.object({
        app: v.literal("magic_forms"),
        accountId: v.string(),
        formKey: v.string(),
      })
    ),
    lastSerial: v.optional(v.number()),
    recordCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_handle", ["workspaceId", "handle"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  records: defineTable({
    workspaceId: v.id("workspaces"),
    bookId: v.id("recordBooks"),
    reference: v.string(),
    serialNumber: v.optional(v.number()),
    agentId: v.optional(v.id("agents")),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    person: v.optional(
      v.object({
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        company: v.optional(v.string()),
      })
    ),
    values: v.array(kvPair),
    stage: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.union(
      v.literal("whatsapp"),
      v.literal("web"),
      v.literal("instagram"),
      v.literal("api"),
      v.literal("manual"),
      v.literal("form")
    ),
    searchBlob: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_book", ["bookId"])
    .index("by_book_stage", ["bookId", "stage"])
    .index("by_workspace_reference", ["workspaceId", "reference"])
    .index("by_contact", ["contactId"])
    .index("by_conversation", ["conversationId"])
    .searchIndex("search_records", {
      searchField: "searchBlob",
      filterFields: ["workspaceId", "bookId"],
    }),

  recordWebhooks: defineTable({
    workspaceId: v.id("workspaces"),
    bookId: v.id("recordBooks"),
    name: v.string(),
    url: v.string(),
    secret: v.optional(v.string()),
    headers: v.array(kvPair),
    events: v.array(
      v.union(
        v.literal("filed"),
        v.literal("updated"),
        v.literal("stage_changed")
      )
    ),
    enabled: v.boolean(),
    lastStatus: v.optional(
      v.union(v.literal("sent"), v.literal("failed"))
    ),
    lastResponseStatus: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastDeliveredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_book", ["bookId"]),

  webhookEvents: defineTable({
    workspaceId: v.id("workspaces"),
    event: v.string(),
    payload: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
    recordBookId: v.optional(v.id("recordBooks")),
    destination: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_event", ["workspaceId", "event"])
    .index("by_book", ["recordBookId"]),
};
