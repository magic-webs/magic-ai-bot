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
  | { role: "admin"; adminId: Id<"admins">; label: string }
  | { role: "workspace"; workspaceId: Id<"workspaces">; label: string }
  /**
   * A human agent on the escalations desk. Carries its workspace, but is not
   * the workspace: `requireWorkspace` refuses it outright, and the only doors
   * it opens are `threadAccess` and `requireMember` below.
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

// `sub` is "admin|<id>", "workspace|<id>" or "member|<id>".
function parseSubject(
  subject: string
): { role: "admin" | "workspace" | "member"; id: string } | null {
  const [role, id] = subject.split("|");
  if ((role !== "admin" && role !== "workspace" && role !== "member") || !id) {
    return null;
  }
  return { role, id };
}

export async function getPrincipal(ctx: Ctx): Promise<Principal | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const parsed = parseSubject(identity.subject);
  if (!parsed) return null;

  if (parsed.role === "admin") {
    const adminId = ctx.db.normalizeId("admins", parsed.id);
    if (!adminId) return null;
    const admin = await ctx.db.get("admins", adminId);
    if (!admin) return null;
    return { role: "admin", adminId, label: admin.email };
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
 * An administrator or a company. For endpoints with no workspace in scope —
 * upload URLs, the model catalogue. Not a human agent: nothing behind these
 * is part of the escalations desk.
 */
export async function requireSignedIn(ctx: Ctx): Promise<Principal> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  if (principal.role === "member") throw new AuthError(DESK_ONLY);
  return principal;
}

const DESK_ONLY = "This sign-in only opens the escalations desk.";

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

export async function requireAdmin(
  ctx: Ctx
): Promise<Extract<Principal, { role: "admin" }>> {
  const principal = await getPrincipal(ctx);
  if (principal?.role !== "admin") {
    throw new AuthError("Administrator access required.");
  }
  return principal;
}

/**
 * An admin, or the company that owns this workspace.
 *
 * Never a human agent, even one of this workspace. Theirs is the one principal
 * that carries a `workspaceId` without being the workspace, so it is refused by
 * role before the id is compared — every guard in convex/ that delegates here
 * stays closed to the desk without having to know it exists.
 */
export async function requireWorkspace(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Principal> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  if (principal.role === "admin") return principal;
  if (principal.role === "member") throw new AuthError(DESK_ONLY);
  if (principal.workspaceId !== workspaceId) {
    throw new AuthError("You do not have access to this workspace.");
  }
  return principal;
}

/**
 * The guard for reading and answering one thread, which is all the desk does.
 *
 * Everything `requireConversation` lets through, plus a human agent of the
 * same workspace — on an escalated thread only. Null rather than an error when
 * a human agent's thread has left the desk (resolved, or set back to open by
 * somebody else): that happens under a live subscription, and a query that
 * starts throwing mid-read takes the page down with it.
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

  if (principal.role === "member") {
    if (!conversation) return null;
    if (conversation.workspaceId !== principal.workspaceId) {
      throw new AuthError("Conversation not found");
    }
    if (conversation.status !== "escalated") return null;
    return { conversation, principal };
  }

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
