// Database side of authentication. Kept separate from convex/auth.ts because
// that file runs in the Node runtime (for RSA signing) and Node-runtime files
// may only contain actions.

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getPrincipal, requireAdmin, requireWorkspace } from "./lib/auth";
import { maskSecret, slugify } from "./lib/shared";

const roleValidator = v.union(
  v.literal("admin"),
  v.literal("workspace"),
  v.literal("member")
);

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

    if (principal.role === "member") {
      return {
        role: "member" as const,
        label: principal.label,
        email: undefined,
        workspaceSlug: workspace?.slug ?? null,
      };
    }

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

/** Returns who it let through, so an action can store something against them. */
export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAdmin(ctx);
    return { adminId: principal.adminId };
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

/**
 * The MCP connector token for one workspace, as the dashboard may see it:
 * when it was issued, when it was last used, and enough of it to recognise
 * which token is live. Never the hash — there is nothing a browser can do with
 * that but leak it.
 */
export const mcpConnector = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const row = await ctx.db
      .query("mcpTokens")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (!row) return null;
    return {
      prefix: row.prefix,
      issuedAt: row.issuedAt,
      lastUsedAt: row.lastUsedAt ?? null,
    };
  },
});

/** Resolves a connector token to its workspace. Internal: the hash is the key. */
export const workspaceByMcpTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!row) return null;
    const workspace = await ctx.db.get("workspaces", row.workspaceId);
    if (!workspace) return null;
    return { tokenId: row._id, workspace };
  },
});

/** One token per workspace: issuing replaces whatever was there. */
export const setMcpToken = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpTokens")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);

    await ctx.db.insert("mcpTokens", {
      workspaceId: args.workspaceId,
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      issuedAt: Date.now(),
    });
    return { success: true };
  },
});

export const clearMcpToken = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpTokens")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { removed: Boolean(existing) };
  },
});

export const touchMcpToken = internalMutation({
  args: { tokenId: v.id("mcpTokens") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tokenId, { lastUsedAt: Date.now() });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// The administrator's own connector. Same shape as above, keyed by the admin
// rather than a workspace, and only ever read by the admin it belongs to.
// ---------------------------------------------------------------------------

/** The signed-in administrator's connector, or null if they have not made one. */
export const adminMcpConnector = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAdmin(ctx);
    const row = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_admin", (q) => q.eq("adminId", principal.adminId))
      .unique();
    if (!row) return null;
    return {
      prefix: row.prefix,
      issuedAt: row.issuedAt,
      lastUsedAt: row.lastUsedAt ?? null,
    };
  },
});

/** Resolves an admin connector token to its administrator. */
export const adminByMcpTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!row) return null;
    // Deleting an administrator has to kill their connector with them, so the
    // record is re-read rather than trusted from the token row.
    const admin = await ctx.db.get("admins", row.adminId);
    if (!admin) return null;
    return {
      tokenId: row._id,
      adminId: row.adminId,
      label: admin.name?.trim() || admin.email,
    };
  },
});

/** One token per administrator: issuing replaces whatever was there. */
export const setAdminMcpToken = internalMutation({
  args: {
    adminId: v.id("admins"),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_admin", (q) => q.eq("adminId", args.adminId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);

    await ctx.db.insert("adminMcpTokens", {
      adminId: args.adminId,
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      issuedAt: Date.now(),
    });
    return { success: true };
  },
});

export const clearAdminMcpToken = internalMutation({
  args: { adminId: v.id("admins") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_admin", (q) => q.eq("adminId", args.adminId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { removed: Boolean(existing) };
  },
});

export const touchAdminMcpToken = internalMutation({
  args: { tokenId: v.id("adminMcpTokens") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tokenId, { lastUsedAt: Date.now() });
    return { success: true };
  },
});

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
    memberId: v.optional(v.id("teamMembers")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.role === "member" && args.memberId) {
      const login = await ctx.db
        .query("memberCredentials")
        .withIndex("by_member", (q) => q.eq("memberId", args.memberId!))
        .unique();
      if (login) await ctx.db.patch(login._id, { lastLoginAt: now });
    }

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
      memberId: args.memberId,
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

// ---------------------------------------------------------------------------
// Human agents' own logins, for the escalations desk.
//
// Issued and revoked by the company from the Team page, not by an
// administrator: these are the company's own people, and a login here opens
// nothing but that company's escalated threads. The password is generated in
// convex/auth.ts, shown once, and only hashed here.
// ---------------------------------------------------------------------------

/** Who on the roster can sign in, for the Team page. Never the hash. */
export const memberLogins = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const logins = await ctx.db
      .query("memberCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return logins.map((login) => ({
      memberId: login.memberId,
      username: login.username,
      status: login.status,
      issuedAt: login.issuedAt,
      lastLoginAt: login.lastLoginAt ?? null,
    }));
  },
});

/**
 * The member a login is about to be issued for, once the caller has been
 * checked against its workspace. For the action in convex/auth.ts, which has
 * no ctx.db of its own.
 */
export const memberForLogin = internalQuery({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) throw new Error("Human agent not found");
    await requireWorkspace(ctx, member.workspaceId);
    const workspace = await ctx.db.get("workspaces", member.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    return { member, workspace };
  },
});

export const memberCredentialByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("memberCredentials")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique(),
});

export const memberCredentialForMember = internalQuery({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("memberCredentials")
      .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
      .unique(),
});

/**
 * Everything sign-in has to see before it lets a human agent through: the
 * member is still on the roster and active, and the company itself still has
 * access. `getPrincipal` checks the same things on every request afterwards.
 */
export const memberSignInState = internalQuery({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) return null;
    const workspace = await ctx.db.get("workspaces", member.workspaceId);
    if (!workspace) return null;
    const companyLogin = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", member.workspaceId))
      .unique();
    return {
      member,
      workspace,
      companyActive: companyLogin?.status === "active",
    };
  },
});

async function dropMemberSessions(
  ctx: MutationCtx,
  memberId: Id<"teamMembers">
): Promise<number> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .collect();
  for (const session of sessions) await ctx.db.delete(session._id);
  return sessions.length;
}

/**
 * Issue a login, or reset one. The username is kept across resets — it is
 * what the person has saved — and only picked the first time, from the
 * workspace ID and their first name, numbered if that is taken.
 */
export const upsertMemberCredential = internalMutation({
  args: {
    memberId: v.id("teamMembers"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) throw new Error("Human agent not found");
    await requireWorkspace(ctx, member.workspaceId);
    const workspace = await ctx.db.get("workspaces", member.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const now = Date.now();
    const existing = await ctx.db
      .query("memberCredentials")
      .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        passwordHash: args.passwordHash,
        status: "active",
        updatedAt: now,
      });
      // A reset must end whatever the old password signed in.
      await dropMemberSessions(ctx, args.memberId);
      return { username: existing.username };
    }

    const handle = slugify(member.name.split(/\s+/)[0] ?? "") || "agent";
    const base = `${workspace.slug}.${handle}`;
    let username = base;
    for (let n = 2; ; n++) {
      const taken = await ctx.db
        .query("memberCredentials")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      if (!taken) break;
      username = `${base}${n}`;
    }

    await ctx.db.insert("memberCredentials", {
      workspaceId: member.workspaceId,
      memberId: args.memberId,
      username,
      passwordHash: args.passwordHash,
      status: "active",
      issuedAt: now,
      updatedAt: now,
    });
    return { username };
  },
});

/**
 * Take a human agent's login away. Deleted rather than marked revoked, so
 * issuing again starts clean — and signed out on the spot.
 */
export const revokeMemberLogin = mutation({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) return { removed: false };
    await requireWorkspace(ctx, member.workspaceId);
    return { removed: await removeMemberLogin(ctx, args.memberId) };
  },
});

/** Also called when a person is taken off the roster altogether. */
export async function removeMemberLogin(
  ctx: MutationCtx,
  memberId: Id<"teamMembers">
): Promise<boolean> {
  const login = await ctx.db
    .query("memberCredentials")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
  if (login) await ctx.db.delete(login._id);
  await dropMemberSessions(ctx, memberId);
  return Boolean(login);
}
