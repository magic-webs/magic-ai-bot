// Database side of authentication. Kept separate from convex/auth.ts because
// that file runs in the Node runtime (for RSA signing) and Node-runtime files
// may only contain actions.

import { v } from "convex/values";
import {
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { getPrincipal, requireAdmin, requireWorkspace } from "./lib/auth";
import { maskSecret } from "./lib/shared";

const roleValidator = v.union(v.literal("admin"), v.literal("workspace"));

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

/** True only while no administrator exists, which unlocks first-run setup. */
export const needsSetup = query({
  args: {},
  handler: async (ctx) => {
    const first = await ctx.db.query("admins").take(1);
    return first.length === 0;
  },
});

/** Who the caller is, for rendering the shell. Never throws. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const principal = await getPrincipal(ctx);
    if (!principal) return null;

    if (principal.role === "admin") {
      const admin = await ctx.db.get("admins", principal.adminId);
      return {
        role: "admin" as const,
        label: admin?.name?.trim() || admin?.email || "Administrator",
        email: admin?.email,
        workspaceSlug: null,
      };
    }

    const workspace = await ctx.db.get("workspaces", principal.workspaceId);
    return {
      role: "workspace" as const,
      label: workspace?.name ?? "Workspace",
      email: undefined,
      workspaceSlug: workspace?.slug ?? null,
    };
  },
});

/**
 * Access state for one workspace. The password itself is never returned — it
 * is shown once, at generation time, and only hashed thereafter.
 */
export const workspaceAccess = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const credential = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const now = Date.now();
    return {
      hasPassword: Boolean(credential),
      status: credential?.status ?? null,
      mustChangePassword: credential?.mustChangePassword ?? false,
      issuedAt: credential?.issuedAt ?? null,
      updatedAt: credential?.updatedAt ?? null,
      lastLoginAt: credential?.lastLoginAt ?? null,
      activeSessions: sessions.filter((s) => s.expiresAt > now).length,
    };
  },
});

/** Admin overview of which workspaces have been handed out. */
export const accessSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const credentials = await ctx.db.query("workspaceCredentials").collect();
    return credentials.map((credential) => ({
      workspaceId: credential.workspaceId,
      status: credential.status,
      mustChangePassword: credential.mustChangePassword,
      lastLoginAt: credential.lastLoginAt ?? null,
      issuedAt: credential.issuedAt,
    }));
  },
});

export const listAdmins = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const admins = await ctx.db.query("admins").collect();
    return admins.map((admin) => ({
      _id: admin._id,
      email: admin.email,
      name: admin.name,
      createdAt: admin.createdAt,
      lastLoginAt: admin.lastLoginAt ?? null,
      passwordHint: maskSecret(admin.passwordHash),
    }));
  },
});

// ---------------------------------------------------------------------------
// Guards for actions.
//
// Actions have no ctx.db, so they assert access by calling one of these.
// Convex propagates the caller's identity through ctx.runQuery, so the guard
// sees the same principal the action was invoked with.
// ---------------------------------------------------------------------------

export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return null;
  },
});

export const assertWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return null;
  },
});

export const assertAgent = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) throw new Error("Agent not found");
    await requireWorkspace(ctx, agent.workspaceId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internals used by the Node-runtime actions in convex/auth.ts
// ---------------------------------------------------------------------------

export const countAdmins = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("admins").take(1)).length,
});

export const adminByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique(),
});

export const workspaceBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique(),
});

export const credentialForWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique(),
});

export const insertAdmin = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    // Guarded here as well as in the action so a race cannot create a second
    // administrator through the unauthenticated setup path.
    requireFirst: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (args.requireFirst) {
      const existing = await ctx.db.query("admins").take(1);
      if (existing.length > 0) {
        throw new Error("An administrator already exists.");
      }
    }

    const clash = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (clash) throw new Error("That email address is already registered.");

    return await ctx.db.insert("admins", {
      email: args.email,
      name: args.name,
      passwordHash: args.passwordHash,
      createdAt: Date.now(),
    });
  },
});

/**
 * Create the administrator, or reset an existing one's password.
 *
 * Unlike insertAdmin this is deliberately idempotent: it backs the
 * provision-admin script, which is the only way to recover from a lost
 * administrator password. Rotating the password revokes every live session for
 * that admin, so a stolen cookie does not outlive the credential it came from.
 */
export const upsertAdminPassword = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!existing) {
      const adminId = await ctx.db.insert("admins", {
        email: args.email,
        name: args.name,
        passwordHash: args.passwordHash,
        createdAt: Date.now(),
      });
      return { adminId, created: true, sessionsRevoked: 0 };
    }

    await ctx.db.patch(existing._id, {
      passwordHash: args.passwordHash,
      ...(args.name ? { name: args.name } : {}),
    });

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_admin", (q) => q.eq("adminId", existing._id))
      .collect();
    for (const session of sessions) await ctx.db.delete(session._id);

    return {
      adminId: existing._id,
      created: false,
      sessionsRevoked: sessions.length,
    };
  },
});

export const upsertWorkspaceCredential = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    passwordHash: v.string(),
    mustChangePassword: v.boolean(),
    // Rotating a password should also drop any sessions it minted.
    revokeSessions: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        passwordHash: args.passwordHash,
        mustChangePassword: args.mustChangePassword,
        status: "active",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("workspaceCredentials", {
        workspaceId: args.workspaceId,
        passwordHash: args.passwordHash,
        mustChangePassword: args.mustChangePassword,
        status: "active",
        issuedAt: now,
        updatedAt: now,
      });
    }

    if (args.revokeSessions) {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
    }
  },
});

export const setCredentialStatus = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.union(v.literal("active"), v.literal("revoked")),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (!credential) throw new Error("This workspace has no password yet.");

    await ctx.db.patch(credential._id, {
      status: args.status,
      updatedAt: Date.now(),
    });

    if (args.status === "revoked") {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
    }
  },
});

export const createSession = internalMutation({
  args: {
    tokenHash: v.string(),
    role: roleValidator,
    adminId: v.optional(v.id("admins")),
    workspaceId: v.optional(v.id("workspaces")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.role === "admin" && args.adminId) {
      await ctx.db.patch(args.adminId, { lastLoginAt: now });
    }
    if (args.role === "workspace" && args.workspaceId) {
      const credential = await ctx.db
        .query("workspaceCredentials")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId!)
        )
        .unique();
      if (credential) {
        await ctx.db.patch(credential._id, { lastLoginAt: now });
      }
    }

    return await ctx.db.insert("authSessions", {
      tokenHash: args.tokenHash,
      role: args.role,
      adminId: args.adminId,
      workspaceId: args.workspaceId,
      createdAt: now,
      expiresAt: args.expiresAt,
      lastUsedAt: now,
    });
  },
});

export const sessionByHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique(),
});

export const touchSession = internalMutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { lastUsedAt: Date.now() });
  },
});

export const deleteSession = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

export const deleteExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessions = await ctx.db.query("authSessions").collect();
    let removed = 0;
    for (const session of sessions) {
      if (session.expiresAt < now) {
        await ctx.db.delete(session._id);
        removed++;
      }
    }
    return { removed };
  },
});

/** Called by the company's own change-password flow. */
export const replaceOwnCredential = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (!credential) throw new Error("This workspace has no password yet.");

    await ctx.db.patch(credential._id, {
      passwordHash: args.passwordHash,
      mustChangePassword: false,
      updatedAt: Date.now(),
    });
  },
});
