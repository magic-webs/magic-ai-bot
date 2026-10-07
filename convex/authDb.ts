// Database side of authentication. Kept separate from convex/auth.ts because
// that file runs in the Node runtime (for RSA signing) and Node-runtime files
// may only contain actions.

import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getPrincipal,
  parseSubject,
  principalKey,
  requireAdmin,
  requireOwner,
  requireSignedIn,
  requireWorkspace,
} from "./lib/auth";
import { assertSeat } from "./lib/account";
import { maskSecret, slugify } from "./lib/shared";

const roleValidator = v.union(
  v.literal("admin"),
  v.literal("workspace"),
  v.literal("member"),
  v.literal("user")
);

const sourceValidator = v.union(
  v.literal("web"),
  v.literal("app"),
  v.literal("mcp")
);

/** Who a session or a half-done sign-in belongs to, as stored on both. */
const principalFields = {
  role: roleValidator,
  adminId: v.optional(v.id("admins")),
  workspaceId: v.optional(v.id("workspaces")),
  memberId: v.optional(v.id("teamMembers")),
  userId: v.optional(v.id("users")),
};

type PrincipalRow = {
  role: "admin" | "workspace" | "member" | "user";
  adminId?: Id<"admins">;
  workspaceId?: Id<"workspaces">;
  memberId?: Id<"teamMembers">;
  userId?: Id<"users">;
};

/** Every session a login has — of any source, ended or not. */
async function sessionsOf(
  ctx: QueryCtx | MutationCtx,
  row: PrincipalRow
): Promise<Doc<"authSessions">[]> {
  if (row.role === "admin" && row.adminId) {
    return await ctx.db
      .query("authSessions")
      .withIndex("by_admin", (q) => q.eq("adminId", row.adminId))
      .collect();
  }
  if (row.role === "member" && row.memberId) {
    return await ctx.db
      .query("authSessions")
      .withIndex("by_member", (q) => q.eq("memberId", row.memberId))
      .collect();
  }
  if (row.role === "user" && row.userId) {
    return await ctx.db
      .query("authSessions")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .collect();
  }
  if (row.role === "workspace" && row.workspaceId) {
    // The index carries the workspace's human agents too.
    const rows = await ctx.db
      .query("authSessions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", row.workspaceId))
      .collect();
    return rows.filter((session) => session.role === "workspace");
  }
  return [];
}

/** Open on the web or in the app: what a new sign-in has to take over from. */
function isInteractiveLive(session: Doc<"authSessions">, now: number): boolean {
  return (
    session.endedAt === undefined &&
    session.expiresAt > now &&
    session.source !== "mcp"
  );
}

async function factorFor(ctx: QueryCtx | MutationCtx, principal: string) {
  return await ctx.db
    .query("twoFactor")
    .withIndex("by_principal", (q) => q.eq("principal", principal))
    .unique();
}

/**
 * Turns a login's authenticator off. Called wherever its password is reset by
 * someone else — the admin for a company, the company for a human agent, the
 * deploy script for an admin — because that reset is the way back in for
 * somebody who has lost their phone, and it would not be one if the code were
 * still asked for.
 */
async function dropFactor(ctx: MutationCtx, principal: string): Promise<void> {
  const factor = await factorFor(ctx, principal);
  if (factor) await ctx.db.delete("twoFactor", factor._id);
}

/** A user's workspaces that still exist and are not archived, in the order they were given. */
export async function userWorkspaceSlugs(
  ctx: QueryCtx | MutationCtx,
  workspaceIds: Id<"workspaces">[]
): Promise<string[]> {
  const slugs: string[] = [];
  for (const id of workspaceIds) {
    const workspace = await ctx.db.get("workspaces", id);
    if (workspace && workspace.status !== "archived") slugs.push(workspace.slug);
  }
  return slugs;
}

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
      const assigned = principal.workspaceIds
        ? await Promise.all(
            principal.workspaceIds.map((id) => ctx.db.get("workspaces", id))
          )
        : null;
      return {
        role: "admin" as const,
        label: admin?.name?.trim() || admin?.email || "Administrator",
        email: admin?.email,
        workspaceSlug: null,
        scoped: assigned !== null,
        workspaceSlugs: assigned
          ? assigned.flatMap((workspace) => (workspace ? [workspace.slug] : []))
          : null,
      };
    }

    if (principal.role === "user") {
      const user = await ctx.db.get("users", principal.userId);
      const slugs = await userWorkspaceSlugs(ctx, principal.workspaceIds);
      return {
        role: "user" as const,
        label: principal.label,
        email: user?.email,
        workspaceSlug: slugs[0] ?? null,
        scoped: true,
        workspaceSlugs: slugs,
      };
    }

    const workspace = await ctx.db.get("workspaces", principal.workspaceId);

    if (principal.role === "member") {
      return {
        role: "member" as const,
        label: principal.label,
        email: undefined,
        workspaceSlug: workspace?.slug ?? null,
        scoped: false,
        workspaceSlugs: null,
      };
    }

    return {
      role: "workspace" as const,
      label: workspace?.name ?? "Workspace",
      email: undefined,
      workspaceSlug: workspace?.slug ?? null,
      scoped: false,
      workspaceSlugs: null,
    };
  },
});

/**
 * Whether the session this token was minted for is still open. Web and app
 * clients subscribe to it and sign themselves out the moment it ends, which
 * is how the device a sign-in replaced finds out — and why it says so rather
 * than failing every query on the page. Never throws.
 */
export const mySession = query({
  args: {},
  handler: async (
    ctx
  ): Promise<
    { ended: false } | { ended: true; reason: "replaced" | null } | null
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const parsed = parseSubject(identity.subject);
    // A token that does not name its session cannot be checked here; it is
    // checked when it comes up for renewal instead.
    if (!parsed?.sessionId) return { ended: false };

    const sessionId = ctx.db.normalizeId("authSessions", parsed.sessionId);
    const session = sessionId
      ? await ctx.db.get("authSessions", sessionId)
      : null;
    if (!session) return { ended: true, reason: null };
    if (session.endedAt !== undefined) {
      return { ended: true, reason: session.endedReason ?? null };
    }
    return { ended: false };
  },
});

/** The caller's own authenticator, for its settings card. Never the secret. */
export const twoFactorStatus = query({
  args: {},
  handler: async (ctx) => {
    const principal = await getPrincipal(ctx);
    if (!principal) return null;
    const factor = await factorFor(ctx, principalKey(principal));
    if (!factor || factor.status !== "active") {
      return { enabled: false, enabledAt: null, recoveryCodesLeft: 0 };
    }
    return {
      enabled: true,
      enabledAt: factor.enabledAt ?? null,
      recoveryCodesLeft: factor.recoveryCodeHashes.length,
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
    const factor = await factorFor(ctx, `workspace|${args.workspaceId}`);

    const now = Date.now();
    return {
      hasPassword: Boolean(credential),
      status: credential?.status ?? null,
      mustChangePassword: credential?.mustChangePassword ?? false,
      issuedAt: credential?.issuedAt ?? null,
      updatedAt: credential?.updatedAt ?? null,
      lastLoginAt: credential?.lastLoginAt ?? null,
      // People signed in, not connector calls: each MCP request signs in
      // afresh, so counting those would count requests.
      activeSessions: sessions.filter((s) => isInteractiveLive(s, now)).length,
      twoFactor: factor?.status === "active",
    };
  },
});

/** Admin overview of which workspaces have been handed out. */
export const accessSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const credentials = await ctx.db.query("workspaceCredentials").collect();
    const protectedLogins = await activeFactorKeys(ctx);
    return credentials.map((credential) => ({
      workspaceId: credential.workspaceId,
      status: credential.status,
      mustChangePassword: credential.mustChangePassword,
      lastLoginAt: credential.lastLoginAt ?? null,
      issuedAt: credential.issuedAt,
      twoFactor: protectedLogins.has(`workspace|${credential.workspaceId}`),
    }));
  },
});

/** Every login with an authenticator switched on, for the admin tables. */
async function activeFactorKeys(ctx: QueryCtx): Promise<Set<string>> {
  const factors = await ctx.db.query("twoFactor").collect();
  return new Set(
    factors
      .filter((factor) => factor.status === "active")
      .map((factor) => factor.principal)
  );
}

export const listAdmins = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const admins = await ctx.db.query("admins").collect();
    const protectedLogins = await activeFactorKeys(ctx);
    return admins.map((admin) => ({
      _id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role ?? "admin",
      workspaceIds: admin.role === "member" ? (admin.workspaceIds ?? []) : [],
      createdAt: admin.createdAt,
      lastLoginAt: admin.lastLoginAt ?? null,
      passwordHint: maskSecret(admin.passwordHash),
      twoFactor: protectedLogins.has(`admin|${admin._id}`),
    }));
  },
});

const adminRole = v.union(v.literal("admin"), v.literal("member"));

async function checkedWorkspaceIds(
  ctx: QueryCtx | MutationCtx,
  role: "admin" | "member",
  workspaceIds: Id<"workspaces">[]
): Promise<Id<"workspaces">[] | undefined> {
  if (role === "admin") return undefined;
  const unique = [...new Set(workspaceIds)];
  for (const id of unique) {
    if (!(await ctx.db.get("workspaces", id))) {
      throw new ConvexError("One of the selected workspaces no longer exists.");
    }
  }
  return unique;
}

export const updateAdminAccess = mutation({
  args: {
    adminId: v.id("admins"),
    name: v.optional(v.string()),
    role: adminRole,
    workspaceIds: v.array(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const principal = await requireAdmin(ctx);
    const admin = await ctx.db.get("admins", args.adminId);
    if (!admin) throw new ConvexError("Team member not found.");
    if (admin._id === principal.adminId && args.role !== "admin") {
      throw new ConvexError("You cannot remove your own administrator role.");
    }
    await ctx.db.patch(admin._id, {
      name: args.name?.trim() || undefined,
      role: args.role,
      workspaceIds: await checkedWorkspaceIds(ctx, args.role, args.workspaceIds),
    });
    return null;
  },
});

export const removeAdmin = mutation({
  args: { adminId: v.id("admins") },
  handler: async (ctx, args) => {
    const principal = await requireAdmin(ctx);
    if (args.adminId === principal.adminId) {
      throw new ConvexError("You cannot remove yourself.");
    }
    const admin = await ctx.db.get("admins", args.adminId);
    if (!admin) return null;

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_admin", (q) => q.eq("adminId", admin._id))
      .collect();
    for (const session of sessions) await ctx.db.delete(session._id);

    const tokens = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_admin", (q) => q.eq("adminId", admin._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);

    await dropFactor(ctx, `admin|${admin._id}`);
    await ctx.db.delete(admin._id);
    return null;
  },
});

export const setAdminPassword = internalMutation({
  args: { adminId: v.id("admins"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get("admins", args.adminId);
    if (!admin) throw new ConvexError("Team member not found.");
    await ctx.db.patch(admin._id, { passwordHash: args.passwordHash });
    await dropFactor(ctx, `admin|${admin._id}`);
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_admin", (q) => q.eq("adminId", admin._id))
      .collect();
    for (const session of sessions) await ctx.db.delete(session._id);
    return null;
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

/** The company or an admin, never one of its human agents. See requireOwner. */
export const assertOwner = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const principal = await requireOwner(ctx, args.workspaceId);
    return { role: principal.role, label: principal.label };
  },
});

export const assertAgent = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) throw new ConvexError("Agent not found");
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
// The administrator's own connectors. Same shape as above, keyed by the admin
// rather than a workspace, and only ever read by the admin they belong to.
// Several per administrator, each named for the assistant it is plugged into.
// ---------------------------------------------------------------------------

/** Enough for everywhere one person plugs in, few enough to keep track of. */
const MAX_ADMIN_CONNECTORS = 20;

/** Shown for the one connector each admin had before connectors had names. */
const UNNAMED_CONNECTOR = "Connector";

/** The signed-in administrator's connectors, newest first. */
export const adminMcpConnectors = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_admin", (q) => q.eq("adminId", principal.adminId))
      .take(MAX_ADMIN_CONNECTORS + 5);
    return rows
      .sort((a, b) => b.issuedAt - a.issuedAt)
      .map((row) => ({
        id: row._id,
        name: row.name?.trim() || UNNAMED_CONNECTOR,
        prefix: row.prefix,
        issuedAt: row.issuedAt,
        lastUsedAt: row.lastUsedAt ?? null,
      }));
  },
});

/** A connector of this administrator's, or an error — never someone else's. */
async function ownConnector(
  ctx: MutationCtx,
  adminId: Id<"admins">,
  tokenId: Id<"adminMcpTokens">
) {
  const row = await ctx.db.get("adminMcpTokens", tokenId);
  if (!row || row.adminId !== adminId) throw new ConvexError("Connector not found.");
  return row;
}

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
      connectorName: row.name?.trim() || UNNAMED_CONNECTOR,
    };
  },
});

/**
 * A new, named connector alongside the administrator's others.
 *
 * Names are unique per administrator, ignoring case: they are how a person
 * tells "Claude.ai" from "Claude Code" when deciding which one to revoke, and
 * two called the same defeats that.
 */
export const addAdminMcpToken = internalMutation({
  args: {
    adminId: v.id("admins"),
    name: v.string(),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"adminMcpTokens">> => {
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) throw new ConvexError("Give the connector a name, e.g. Claude.ai.");

    const existing = await ctx.db
      .query("adminMcpTokens")
      .withIndex("by_admin", (q) => q.eq("adminId", args.adminId))
      .take(MAX_ADMIN_CONNECTORS + 5);
    if (existing.length >= MAX_ADMIN_CONNECTORS) {
      throw new ConvexError(
        `You already have ${MAX_ADMIN_CONNECTORS} connectors. Revoke one you no longer use first.`
      );
    }
    const taken = existing.some(
      (row) =>
        (row.name?.trim() || UNNAMED_CONNECTOR).toLowerCase() ===
        name.toLowerCase()
    );
    if (taken) {
      throw new ConvexError(
        `You already have a connector called "${name}". Rotate that one, or pick another name.`
      );
    }

    return await ctx.db.insert("adminMcpTokens", {
      adminId: args.adminId,
      name,
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      issuedAt: Date.now(),
    });
  },
});

/** A new URL for one connector. The old one stops working with this write. */
export const rotateAdminMcpToken = internalMutation({
  args: {
    adminId: v.id("admins"),
    tokenId: v.id("adminMcpTokens"),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ownConnector(ctx, args.adminId, args.tokenId);
    await ctx.db.patch("adminMcpTokens", row._id, {
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      issuedAt: Date.now(),
      // A fresh URL has not been used by anything yet.
      lastUsedAt: undefined,
    });
    return { name: row.name?.trim() || UNNAMED_CONNECTOR };
  },
});

export const removeAdminMcpToken = internalMutation({
  args: { adminId: v.id("admins"), tokenId: v.id("adminMcpTokens") },
  handler: async (ctx, args) => {
    const row = await ownConnector(ctx, args.adminId, args.tokenId);
    await ctx.db.delete("adminMcpTokens", row._id);
    return { removed: true };
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
    role: v.optional(adminRole),
    workspaceIds: v.optional(v.array(v.id("workspaces"))),
    // Guarded here as well as in the action so a race cannot create a second
    // administrator through the unauthenticated setup path.
    requireFirst: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (args.requireFirst) {
      const existing = await ctx.db.query("admins").take(1);
      if (existing.length > 0) {
        throw new ConvexError("An administrator already exists.");
      }
    }

    const clash =
      (await ctx.db
        .query("admins")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique()) ??
      (await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique()) ??
      (await ctx.db
        .query("memberCredentials")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first());
    if (clash) throw new ConvexError("That email address is already registered.");

    const role = args.requireFirst ? "admin" : (args.role ?? "admin");
    return await ctx.db.insert("admins", {
      email: args.email,
      name: args.name,
      passwordHash: args.passwordHash,
      role,
      workspaceIds: await checkedWorkspaceIds(ctx, role, args.workspaceIds ?? []),
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
    // This script is the recovery path, so it has to get past a lost phone.
    await dropFactor(ctx, `admin|${existing._id}`);

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
    await dropFactor(ctx, `workspace|${args.workspaceId}`);

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
    if (!credential) throw new ConvexError("This workspace has no password yet.");

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

/**
 * Opens a session, keeping to one web or app session per login.
 *
 * `exclusive` refuses when the login already has one open and says where, so
 * the person can be asked before anybody is signed out. `replace` is the
 * answer yes: it ends the open one, marked so its device can say why, and
 * takes its place in the same transaction — two people agreeing at once still
 * leaves exactly one of them signed in. `shared` is for MCP sessions, which
 * neither count nor get replaced.
 *
 * `challengeId` is the half-done sign-in this finishes, consumed here rather
 * than by a second call so it cannot be spent twice.
 */
export const createSession = internalMutation({
  args: {
    tokenHash: v.string(),
    ...principalFields,
    expiresAt: v.number(),
    // Absent for a client from before sources were recorded.
    source: v.optional(sourceValidator),
    device: v.optional(v.string()),
    mode: v.union(
      v.literal("exclusive"),
      v.literal("replace"),
      v.literal("shared")
    ),
    challengeId: v.optional(v.id("authChallenges")),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        activeSession: { device: string | null; lastUsedAt: number };
      }
  > => {
    const now = Date.now();

    const challenge = args.challengeId
      ? await ctx.db.get("authChallenges", args.challengeId)
      : null;
    if (args.challengeId && (!challenge || challenge.expiresAt < now)) {
      throw new ConvexError("This sign-in has expired. Sign in again.");
    }

    if (args.mode !== "shared") {
      const live = (await sessionsOf(ctx, args)).filter((session) =>
        isInteractiveLive(session, now)
      );
      if (live.length > 0 && args.mode === "exclusive") {
        // Left in place: the same challenge goes on to ask about this one.
        const latest = live.reduce((a, b) => (b.lastUsedAt > a.lastUsedAt ? b : a));
        return {
          ok: false,
          activeSession: {
            device: latest.device ?? null,
            lastUsedAt: latest.lastUsedAt,
          },
        };
      }
      for (const session of live) {
        await ctx.db.patch("authSessions", session._id, {
          endedAt: now,
          endedReason: "replaced",
        });
      }
    }

    if (challenge) await ctx.db.delete("authChallenges", challenge._id);

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
    if (args.role === "user" && args.userId) {
      await ctx.db.patch(args.userId, { lastLoginAt: now });
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

    await ctx.db.insert("authSessions", {
      tokenHash: args.tokenHash,
      role: args.role,
      adminId: args.adminId,
      workspaceId: args.workspaceId,
      memberId: args.memberId,
      userId: args.userId,
      createdAt: now,
      expiresAt: args.expiresAt,
      lastUsedAt: now,
      source: args.source,
      device: args.device,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Half-done sign-ins. See `authChallenges` in the schema.
// ---------------------------------------------------------------------------

export const createChallenge = internalMutation({
  args: {
    tokenHash: v.string(),
    stage: v.union(v.literal("twoFactor"), v.literal("replace")),
    ...principalFields,
    source: sourceValidator,
    device: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("authChallenges", { ...args, createdAt: Date.now() });
    return null;
  },
});

export const challengeByHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("authChallenges")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique(),
});

/** The code was right; what is left is asking about the open session. */
export const advanceChallenge = internalMutation({
  args: { challengeId: v.id("authChallenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get("authChallenges", args.challengeId);
    if (challenge) {
      await ctx.db.patch("authChallenges", challenge._id, { stage: "replace" });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Authenticator apps. The codes are checked in convex/auth.ts, which has the
// HMAC; everything here that decides whether a code counts runs in one
// transaction, so a code cannot be used twice by two requests racing.
// ---------------------------------------------------------------------------

/** Every fifth wrong code in a row locks the login, doubling each time. */
const FAILS_PER_LOCK = 5;
const FIRST_LOCK_MS = 15 * 60 * 1000;
const LONGEST_LOCK_MS = 24 * 60 * 60 * 1000;

/**
 * Who is calling, for an action about their own authenticator: the key it is
 * stored under, and the account name the authenticator app shows beside it.
 */
export const callerPrincipal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const principal = await requireSignedIn(ctx);
    let account: string = principal.label;
    if (principal.role === "admin") {
      account = (await ctx.db.get("admins", principal.adminId))?.email ?? account;
    } else if (principal.role === "workspace") {
      account =
        (await ctx.db.get("workspaces", principal.workspaceId))?.slug ?? account;
    } else if (principal.role === "user") {
      account = (await ctx.db.get("users", principal.userId))?.email ?? account;
    } else {
      const login = await ctx.db
        .query("memberCredentials")
        .withIndex("by_member", (q) => q.eq("memberId", principal.memberId))
        .unique();
      account = login?.email ?? login?.username ?? account;
    }
    return { key: principalKey(principal), account };
  },
});

export const twoFactorForPrincipal = internalQuery({
  args: { principal: v.string() },
  handler: async (ctx, args) => {
    const factor = await factorFor(ctx, args.principal);
    return factor?.status === "active" ? { active: true } : null;
  },
});

/**
 * Counts an attempt before the code is checked, not after, so a burst of
 * guesses sent in parallel is held to the same limit as one at a time. A
 * right code clears the count again (see `acceptCode`).
 */
export const beginCodeAttempt = internalMutation({
  args: { principal: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<
    | { kind: "missing" }
    | { kind: "locked"; until: number }
    | {
        kind: "ready";
        secret: string;
        status: "pending" | "active";
        lastUsedStep: number | null;
        recoveryCodeHashes: string[];
      }
  > => {
    const factor = await factorFor(ctx, args.principal);
    if (!factor) return { kind: "missing" };

    const now = Date.now();
    if (factor.lockedUntil !== undefined && factor.lockedUntil > now) {
      return { kind: "locked", until: factor.lockedUntil };
    }

    const failedAttempts = factor.failedAttempts + 1;
    const locks = failedAttempts / FAILS_PER_LOCK;
    await ctx.db.patch("twoFactor", factor._id, {
      failedAttempts,
      lockedUntil: Number.isInteger(locks)
        ? now + Math.min(FIRST_LOCK_MS * 2 ** (locks - 1), LONGEST_LOCK_MS)
        : factor.lockedUntil,
    });

    return {
      kind: "ready",
      secret: factor.secret,
      status: factor.status,
      lastUsedStep: factor.lastUsedStep ?? null,
      recoveryCodeHashes: factor.recoveryCodeHashes,
    };
  },
});

/**
 * A code checked out; records it, unless it was already spent. Returns false
 * for a replayed step or a recovery code used a moment ago by another request.
 * With `activate`, this is the first code from a new authenticator, and turns
 * it on with the recovery codes generated for it.
 */
export const acceptCode = internalMutation({
  args: {
    principal: v.string(),
    step: v.optional(v.number()),
    recoveryHash: v.optional(v.string()),
    activate: v.optional(v.object({ recoveryCodeHashes: v.array(v.string()) })),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const factor = await factorFor(ctx, args.principal);
    if (!factor) return false;
    if (args.activate && factor.status !== "pending") return false;
    if (
      args.step !== undefined &&
      factor.lastUsedStep !== undefined &&
      args.step <= factor.lastUsedStep
    ) {
      return false;
    }

    let recoveryCodeHashes = factor.recoveryCodeHashes;
    if (args.recoveryHash !== undefined) {
      if (!recoveryCodeHashes.includes(args.recoveryHash)) return false;
      recoveryCodeHashes = recoveryCodeHashes.filter(
        (hash) => hash !== args.recoveryHash
      );
    }

    await ctx.db.patch("twoFactor", factor._id, {
      failedAttempts: 0,
      lockedUntil: undefined,
      lastUsedStep: args.step ?? factor.lastUsedStep,
      recoveryCodeHashes: args.activate?.recoveryCodeHashes ?? recoveryCodeHashes,
      ...(args.activate ? { status: "active" as const, enabledAt: Date.now() } : {}),
    });
    return true;
  },
});

/** A new secret waiting for its first code. Replaces an unfinished setup. */
export const putPendingFactor = internalMutation({
  args: { principal: v.string(), secret: v.string() },
  handler: async (ctx, args) => {
    const existing = await factorFor(ctx, args.principal);
    if (existing?.status === "active") {
      throw new ConvexError("Two-factor authentication is already on for this login.");
    }
    if (existing) await ctx.db.delete("twoFactor", existing._id);
    await ctx.db.insert("twoFactor", {
      principal: args.principal,
      secret: args.secret,
      status: "pending",
      recoveryCodeHashes: [],
      failedAttempts: 0,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const removeFactor = internalMutation({
  args: { principal: v.string() },
  handler: async (ctx, args) => {
    await dropFactor(ctx, args.principal);
    return null;
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
    // Sign-ins abandoned at the code or the "sign out the other one?" step.
    for (const challenge of await ctx.db.query("authChallenges").collect()) {
      if (challenge.expiresAt < now) {
        await ctx.db.delete("authChallenges", challenge._id);
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
    if (!credential) throw new ConvexError("This workspace has no password yet.");

    await ctx.db.patch(credential._id, {
      passwordHash: args.passwordHash,
      mustChangePassword: false,
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Human agents' own logins.
//
// Issued and revoked by the company from the Team page, not by an
// administrator: these are the company's own people. A login opens the
// company's dashboard, and each one takes a human-agent seat on its plan. The
// password is generated in convex/auth.ts, shown once, and only hashed here.
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
    return await Promise.all(
      logins.map(async (login) => ({
        memberId: login.memberId,
        username: login.username,
        email: login.email ?? null,
        status: login.status,
        issuedAt: login.issuedAt,
        lastLoginAt: login.lastLoginAt ?? null,
        twoFactor:
          (await factorFor(ctx, `member|${login.memberId}`))?.status === "active",
      }))
    );
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
    if (!member) throw new ConvexError("Human agent not found");
    await requireOwner(ctx, member.workspaceId);
    const workspace = await ctx.db.get("workspaces", member.workspaceId);
    if (!workspace) throw new ConvexError("Workspace not found");
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

export const memberCredentialByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("memberCredentials")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first(),
});

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A team member's email as a login takes it, or undefined when it is not one. */
export function loginEmailOf(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  return email && EMAIL_PATTERN.test(email) ? email : undefined;
}

export const LOGIN_EMAIL_TAKEN = "That email address is already used by another login.";

/** One email, one login — across administrators, users and human agents. */
export async function loginEmailTaken(
  ctx: QueryCtx | MutationCtx,
  email: string,
  except?: Id<"memberCredentials">
): Promise<boolean> {
  const admin = await ctx.db
    .query("admins")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  if (admin) return true;
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  if (user) return true;
  const logins = await ctx.db
    .query("memberCredentials")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(2);
  return logins.some((login) => login._id !== except);
}

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

/**
 * Whether a principal may still be signed in, and what the signed-in
 * response says about them. Sign-in calls it after the password is right,
 * and again after the code, since a person can be switched off in between.
 */
export const principalProfile = internalQuery({
  args: principalFields,
  handler: async (
    ctx,
    args
  ): Promise<
    | {
        ok: true;
        label: string;
        workspaceSlug: string | null;
        mustChangePassword: boolean;
      }
    | { ok: false; error: string }
  > => {
    const generic = { ok: false as const, error: "Incorrect email or password." };
    const archived = { ok: false as const, error: "This workspace has been archived." };

    if (args.role === "admin") {
      const admin = args.adminId ? await ctx.db.get("admins", args.adminId) : null;
      if (!admin) return generic;
      return {
        ok: true,
        label: admin.name?.trim() || admin.email,
        workspaceSlug: null,
        mustChangePassword: false,
      };
    }

    if (args.role === "user") {
      const user = args.userId ? await ctx.db.get("users", args.userId) : null;
      if (!user) return generic;
      const slugs = await userWorkspaceSlugs(ctx, user.workspaceIds);
      if (slugs.length === 0) {
        return { ok: false, error: "No workspace has been assigned to this login yet." };
      }
      return {
        ok: true,
        label: user.name?.trim() || user.email,
        workspaceSlug: slugs[0]!,
        mustChangePassword: false,
      };
    }

    if (args.role === "member") {
      const member = args.memberId
        ? await ctx.db.get("teamMembers", args.memberId)
        : null;
      if (!member || member.status === "inactive") return generic;
      const login = await ctx.db
        .query("memberCredentials")
        .withIndex("by_member", (q) => q.eq("memberId", member._id))
        .unique();
      if (login?.status !== "active") return generic;
      const workspace = await ctx.db.get("workspaces", member.workspaceId);
      const companyLogin = await ctx.db
        .query("workspaceCredentials")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", member.workspaceId))
        .unique();
      if (!workspace || companyLogin?.status !== "active") return generic;
      if (workspace.status === "archived") return archived;
      return {
        ok: true,
        label: member.name,
        workspaceSlug: workspace.slug,
        mustChangePassword: false,
      };
    }

    const workspace = args.workspaceId
      ? await ctx.db.get("workspaces", args.workspaceId)
      : null;
    if (!workspace) return generic;
    const credential = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .unique();
    if (credential?.status !== "active") return generic;
    if (workspace.status === "archived") return archived;
    return {
      ok: true,
      label: workspace.name,
      workspaceSlug: workspace.slug,
      mustChangePassword: credential.mustChangePassword,
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
 * workspace ID and their first name, numbered if that is taken. The email is
 * the member's own, taken afresh each time, and signs in as well.
 */
export const upsertMemberCredential = internalMutation({
  args: {
    memberId: v.id("teamMembers"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) throw new ConvexError("Human agent not found");
    await requireOwner(ctx, member.workspaceId);
    const workspace = await ctx.db.get("workspaces", member.workspaceId);
    if (!workspace) throw new ConvexError("Workspace not found");

    const now = Date.now();
    const existing = await ctx.db
      .query("memberCredentials")
      .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
      .unique();

    const email = loginEmailOf(member.email);
    if (email && (await loginEmailTaken(ctx, email, existing?._id))) {
      throw new ConvexError(LOGIN_EMAIL_TAKEN);
    }

    if (existing) {
      // Bringing a revoked login back takes a seat again; a reset keeps its own.
      if (existing.status !== "active") {
        await assertSeat(ctx, member.workspaceId, "human");
      }
      await ctx.db.patch(existing._id, {
        email,
        passwordHash: args.passwordHash,
        status: "active",
        updatedAt: now,
      });
      // A reset must end whatever the old password signed in — and is how
      // somebody who lost their authenticator gets back in.
      await dropMemberSessions(ctx, args.memberId);
      await dropFactor(ctx, `member|${args.memberId}`);
      return { username: existing.username, email: email ?? null };
    }

    // A new login is a new human-agent seat; a reset is the same one.
    await assertSeat(ctx, member.workspaceId, "human");

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
      email,
      passwordHash: args.passwordHash,
      status: "active",
      issuedAt: now,
      updatedAt: now,
    });
    return { username, email: email ?? null };
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
    await requireOwner(ctx, member.workspaceId);
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
  await dropFactor(ctx, `member|${memberId}`);
  return Boolean(login);
}
