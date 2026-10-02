import { defineTable } from "convex/server";
import { v } from "convex/values";
import { kvPair } from "./validators";

export const workspacesTables = {
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerName: v.optional(v.string()),
    tagline: v.optional(v.string()),
    description: v.optional(v.string()),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    supportEmail: v.optional(v.string()),
    supportPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    locale: v.string(),
    timezone: v.string(),
    currency: v.string(),
    theme: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    logoUrl: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    facts: v.array(kvPair),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  teamMembers: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    role: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("away"),
      v.literal("inactive")
    ),
    messageCount: v.number(),
    lastActiveAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
};
