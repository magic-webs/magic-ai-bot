// Authorization guards.
//
// Identity arrives as a JWT that Convex has already verified against this
// deployment's JWKS, so `ctx.auth.getUserIdentity()` is trustworthy and no
// caller ever passes an id or token as an argument.
//
// Every guard also re-reads the underlying record, so revoking a company's
// access or deleting an admin takes effect on the very next request rather
// than when their token happens to expire.

import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export type Principal =
  | { role: "admin"; adminId: Id<"admins">; label: string }
  | { role: "workspace"; workspaceId: Id<"workspaces">; label: string };

type Ctx = QueryCtx | MutationCtx;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// `sub` is "admin|<id>" or "workspace|<id>".
function parseSubject(
  subject: string
): { role: "admin" | "workspace"; id: string } | null {
  const [role, id] = subject.split("|");
  if ((role !== "admin" && role !== "workspace") || !id) return null;
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

/** Any authenticated principal. For endpoints with no workspace in scope. */
export async function requireSignedIn(ctx: Ctx): Promise<Principal> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
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

/** An admin, or the company that owns this workspace. */
export async function requireWorkspace(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Principal> {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  if (principal.role === "admin") return principal;
  if (principal.workspaceId !== workspaceId) {
    throw new AuthError("You do not have access to this workspace.");
  }
  return principal;
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
