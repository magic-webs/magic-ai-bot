// Authorization guards.
//
// Identity arrives as a JWT that Convex has already verified against this
// deployment's JWKS, so `ctx.auth.getUserIdentity()` is trustworthy and no
// caller ever passes an id or token as an argument.
//
// Every guard also re-reads the underlying record, so revoking a company's
// access or deleting an admin takes effect on the very next request rather
// than when their token happens to expire.

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export type Principal =
  | {
      role: "admin";
      adminId: Id<"admins">;
      label: string;
      /** Null for a full administrator; the assigned workspaces for a team member. */
      workspaceIds: Id<"workspaces">[] | null;
    }
  | { role: "workspace"; workspaceId: Id<"workspaces">; label: string }
  /**
   * A human agent, signed in with a login of their own. Opens their
   * workspace's dashboard as the company login does — `requireWorkspace`
   * lets them through on their own workspace — but not what the company
   * keeps for itself: see `requireOwner`.
   */
  | {
      role: "member";
      memberId: Id<"teamMembers">;
      workspaceId: Id<"workspaces">;
      label: string;
    };

type Ctx = QueryCtx | MutationCtx;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * `sub` is "admin|<id>", "workspace|<id>" or "member|<id>", followed by
 * "|<sessionId>" for a web or app session. The session is only named for
 * those two because their clients watch for it ending (see `mySession` in
 * convex/authDb.ts) and sign out cleanly; an older client, or the MCP server,
 * finds out when its next token is refused instead.
 */
export function parseSubject(subject: string): {
  role: "admin" | "workspace" | "member";
  id: string;
  sessionId: string | null;
} | null {
  const [role, id, sessionId] = subject.split("|");
  if ((role !== "admin" && role !== "workspace" && role !== "member") || !id) {
    return null;
  }
  return { role, id, sessionId: sessionId || null };
}

/** The key a login's authenticator is stored under — its subject, unsessioned. */
export function principalKey(principal: Principal): string {
  if (principal.role === "admin") return `admin|${principal.adminId}`;
  if (principal.role === "member") return `member|${principal.memberId}`;
  return `workspace|${principal.workspaceId}`;
}

export async function getPrincipal(ctx: Ctx): Promise<Principal | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const parsed = parseSubject(identity.subject);
  if (!parsed) return null;

  // Signed in somewhere else since, or signed out: the token is still
  // unexpired, but the session it was minted for is over.
  if (parsed.sessionId) {
    const sessionId = ctx.db.normalizeId("authSessions", parsed.sessionId);
    const session = sessionId ? await ctx.db.get("authSessions", sessionId) : null;
    if (!session || session.endedAt !== undefined) return null;
  }

  if (parsed.role === "admin") {
    const adminId = ctx.db.normalizeId("admins", parsed.id);
    if (!adminId) return null;
    const admin = await ctx.db.get("admins", adminId);
    if (!admin) return null;
    return {
      role: "admin",
      adminId,
      label: admin.email,
      workspaceIds: admin.role === "member" ? (admin.workspaceIds ?? []) : null,
    };
  }

  if (parsed.role === "member") {
    const memberId = ctx.db.normalizeId("teamMembers", parsed.id);
    if (!memberId) return null;
    const member = await ctx.db.get("teamMembers", memberId);
    // Inactive takes somebody off the desk as well as off the reply list.
    if (!member || member.status === "inactive") return null;

    const login = await ctx.db
      .query("memberCredentials")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique();
    if (!login || login.status !== "active") return null;

    // A company whose own access is revoked takes its people with it.
    const companyLogin = await ctx.db
      .query("workspaceCredentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", member.workspaceId))
      .unique();
    if (!companyLogin || companyLogin.status !== "active") return null;

    return {
      role: "member",
      memberId,
      workspaceId: member.workspaceId,
      label: member.name,
    };
  }

  const workspaceId = ctx.db.normalizeId("workspaces", parsed.id);
  if (!workspaceId) return null;

  // A revoked or deleted credential must lock the company out immediately.
  const credential = await ctx.db
    .query("workspaceCredentials")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  if (!credential || credential.status !== "active") return null;

  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return null;

  return { role: "workspace", workspaceId, label: workspace.slug };
}

/**
 * Anyone signed in. For endpoints with no workspace in scope — upload URLs,
 * the model catalogue.
 */
export async function requireSignedIn(ctx: Ctx): Promise<Principal> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  return principal;
}

/** A human agent, for the desk's own list and header. */
export async function requireMember(
  ctx: Ctx
): Promise<Extract<Principal, { role: "member" }>> {
  const principal = await getPrincipal(ctx);
  if (principal?.role !== "member") {
    throw new AuthError("Sign in as a human agent to open the desk.");
  }
  return principal;
}

export function isFullAdmin(principal: Principal | null): boolean {
  return principal?.role === "admin" && principal.workspaceIds === null;
}

/** A full administrator. Team members with assigned workspaces are refused. */
export async function requireAdmin(
  ctx: Ctx
): Promise<Extract<Principal, { role: "admin" }>> {
  const principal = await getPrincipal(ctx);
  if (principal?.role !== "admin" || principal.workspaceIds !== null) {
    throw new AuthError("Administrator access required.");
  }
  return principal;
}

/** Anyone on the platform team: a full administrator or a team member. */
export async function requireStaff(
  ctx: Ctx
): Promise<Extract<Principal, { role: "admin" }>> {
  const principal = await getPrincipal(ctx);
  if (principal?.role !== "admin") {
    throw new AuthError("Administrator access required.");
  }
  return principal;
}

/**
 * An admin, the company that owns this workspace, or one of its human agents.
 *
 * A human agent's login opens the whole dashboard — it is what a human-agent
 * seat on the plan buys. What the company keeps to itself is behind
 * `requireOwner` instead.
 */
export async function requireWorkspace(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Principal> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  if (principal.role === "admin") {
    if (principal.workspaceIds && !principal.workspaceIds.includes(workspaceId)) {
      throw new AuthError("You do not have access to this workspace.");
    }
    return principal;
  }
  if (principal.workspaceId !== workspaceId) {
    throw new AuthError("You do not have access to this workspace.");
  }
  return principal;
}

/**
 * An admin, or the company itself — never one of its human agents.
 *
 * For what outlives a person or spends the company's money: the workspace
 * password, other people's logins, MCP tokens, and the subscription. A human
 * agent issuing logins would be buying seats, and one who minted an MCP
 * token would keep access after their own login was revoked.
 */
export async function requireOwner(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Principal> {
  const principal = await requireWorkspace(ctx, workspaceId);
  if (principal.role === "member") {
    throw new AuthError("Only the workspace's own login can do this.");
  }
  return principal;
}

/**
 * The guard for reading and answering one thread, from the inbox or the desk.
 *
 * Everything `requireConversation` lets through. Null rather than an error
 * when the thread is gone: that happens under a live subscription, and a
 * query that starts throwing mid-read takes the page down with it.
 */
export async function threadAccess(
  ctx: Ctx,
  conversationId: Id<"conversations">
): Promise<{
  conversation: Doc<"conversations">;
  principal: Principal;
} | null> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  const conversation = await ctx.db.get("conversations", conversationId);

  if (!conversation) return null;
  await requireWorkspace(ctx, conversation.workspaceId);
  return { conversation, principal };
}

// ---------------------------------------------------------------------------
// Child-document guards. Each resolves the owning workspace, then delegates.
// They return the document so callers don't re-read it.
// ---------------------------------------------------------------------------

async function viaWorkspaceField<T extends { workspaceId: Id<"workspaces"> }>(
  ctx: Ctx,
  doc: T | null,
  missing: string
): Promise<T> {
  if (!doc) throw new AuthError(missing);
  await requireWorkspace(ctx, doc.workspaceId);
  return doc;
}

export const requireAgent = async (ctx: Ctx, id: Id<"agents">) =>
  viaWorkspaceField(ctx, await ctx.db.get("agents", id), "Agent not found");

export const requireProduct = async (ctx: Ctx, id: Id<"products">) =>
  viaWorkspaceField(ctx, await ctx.db.get("products", id), "Product not found");

export const requireOrder = async (ctx: Ctx, id: Id<"orders">) =>
  viaWorkspaceField(ctx, await ctx.db.get("orders", id), "Order not found");

export const requireChannel = async (ctx: Ctx, id: Id<"channels">) =>
  viaWorkspaceField(ctx, await ctx.db.get("channels", id), "Channel not found");

export const requireRecordBook = async (ctx: Ctx, id: Id<"recordBooks">) =>
  viaWorkspaceField(
    ctx,
    await ctx.db.get("recordBooks", id),
    "Record book not found"
  );

export const requireRecord = async (ctx: Ctx, id: Id<"records">) =>
  viaWorkspaceField(ctx, await ctx.db.get("records", id), "Record not found");

export const requireRecordWebhook = async (ctx: Ctx, id: Id<"recordWebhooks">) =>
  viaWorkspaceField(
    ctx,
    await ctx.db.get("recordWebhooks", id),
    "Webhook not found"
  );

export const requireTool = async (ctx: Ctx, id: Id<"tools">) =>
  viaWorkspaceField(ctx, await ctx.db.get("tools", id), "Tool not found");

export const requireKnowledgeSource = async (
  ctx: Ctx,
  id: Id<"knowledgeSources">
) =>
  viaWorkspaceField(
    ctx,
    await ctx.db.get("knowledgeSources", id),
    "Knowledge source not found"
  );

export const requireConversation = async (ctx: Ctx, id: Id<"conversations">) =>
  viaWorkspaceField(
    ctx,
    await ctx.db.get("conversations", id),
    "Conversation not found"
  );

export const requireContact = async (ctx: Ctx, id: Id<"contacts">) =>
  viaWorkspaceField(ctx, await ctx.db.get("contacts", id), "Contact not found");
