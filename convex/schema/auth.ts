import { defineTable } from "convex/server";
import { v } from "convex/values";

export const authTables = {
  admins: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  workspaceCredentials: defineTable({
    workspaceId: v.id("workspaces"),
    passwordHash: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    mustChangePassword: v.boolean(),
    issuedAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),

  memberCredentials: defineTable({
    workspaceId: v.id("workspaces"),
    memberId: v.id("teamMembers"),
    username: v.string(),
    passwordHash: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    issuedAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_member", ["memberId"])
    .index("by_username", ["username"])
    .index("by_workspace", ["workspaceId"]),

  authSessions: defineTable({
    tokenHash: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("workspace"),
      v.literal("member")
    ),
    adminId: v.optional(v.id("admins")),
    workspaceId: v.optional(v.id("workspaces")),
    memberId: v.optional(v.id("teamMembers")),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.number(),
    source: v.optional(
      v.union(v.literal("web"), v.literal("app"), v.literal("mcp"))
    ),
    device: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    endedReason: v.optional(v.literal("replaced")),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_workspace", ["workspaceId"])
    .index("by_admin", ["adminId"])
    .index("by_member", ["memberId"]),

  authChallenges: defineTable({
    tokenHash: v.string(),
    stage: v.union(v.literal("twoFactor"), v.literal("replace")),
    role: v.union(v.literal("admin"), v.literal("workspace"), v.literal("member")),
    adminId: v.optional(v.id("admins")),
    workspaceId: v.optional(v.id("workspaces")),
    memberId: v.optional(v.id("teamMembers")),
    source: v.union(v.literal("web"), v.literal("app"), v.literal("mcp")),
    device: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_tokenHash", ["tokenHash"]),

  twoFactor: defineTable({
    principal: v.string(),
    secret: v.string(),
    status: v.union(v.literal("pending"), v.literal("active")),
    recoveryCodeHashes: v.array(v.string()),
    lastUsedStep: v.optional(v.number()),
    failedAttempts: v.number(),
    lockedUntil: v.optional(v.number()),
    createdAt: v.number(),
    enabledAt: v.optional(v.number()),
  }).index("by_principal", ["principal"]),

  mcpTokens: defineTable({
    workspaceId: v.id("workspaces"),
    tokenHash: v.string(),
    prefix: v.string(),
    issuedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_hash", ["tokenHash"]),

  adminMcpTokens: defineTable({
    adminId: v.id("admins"),
    name: v.optional(v.string()),
    tokenHash: v.string(),
    prefix: v.string(),
    issuedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_admin", ["adminId"])
    .index("by_hash", ["tokenHash"]),
};
