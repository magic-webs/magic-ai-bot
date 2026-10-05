import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireSignedIn } from "./lib/auth";
import { userWorkspaceSlugs } from "./authDb";
import { logoSrcFor } from "./lib/branding";

async function checkedWorkspaces(
  ctx: MutationCtx,
  workspaceIds: Id<"workspaces">[]
): Promise<Id<"workspaces">[]> {
  const unique = [...new Set(workspaceIds)];
  if (unique.length === 0) throw new Error("Pick at least one workspace.");
  for (const id of unique) {
    if (!(await ctx.db.get("workspaces", id))) {
      throw new Error("One of the selected workspaces no longer exists.");
    }
  }
  return unique;
}

async function endSessionsAndFactor(ctx: MutationCtx, userId: Id<"users">) {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) await ctx.db.delete(session._id);
  const factor = await ctx.db
    .query("twoFactor")
    .withIndex("by_principal", (q) => q.eq("principal", `user|${userId}`))
    .unique();
  if (factor) await ctx.db.delete(factor._id);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    const factors = await ctx.db.query("twoFactor").collect();
    const protectedLogins = new Set(
      factors.filter((f) => f.status === "active").map((f) => f.principal)
    );
    return users.map((user) => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      workspaceIds: user.workspaceIds,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
      twoFactor: protectedLogins.has(`user|${user._id}`),
    }));
  },
});

/** The caller's own workspaces, for the switcher in the sidebar footer. */
export const myWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireSignedIn(ctx);
    if (principal.role !== "user") return [];
    const slugs = new Set(await userWorkspaceSlugs(ctx, principal.workspaceIds));
    const out = [];
    for (const id of principal.workspaceIds) {
      const workspace = await ctx.db.get("workspaces", id);
      if (!workspace || !slugs.has(workspace.slug)) continue;
      out.push({
        _id: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
        logoSrc: await logoSrcFor(ctx, workspace),
      });
    }
    return out;
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    workspaceIds: v.array(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new Error("User not found.");
    await ctx.db.patch(user._id, {
      name: args.name?.trim() || undefined,
      workspaceIds: await checkedWorkspaces(ctx, args.workspaceIds),
    });
    return null;
  },
});

export const remove = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get("users", args.userId);
    if (!user) return null;
    await endSessionsAndFactor(ctx, user._id);
    await ctx.db.delete(user._id);
    return null;
  },
});

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique(),
});

export const insert = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    workspaceIds: v.array(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const clash =
      (await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique()) ??
      (await ctx.db
        .query("admins")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique());
    if (clash) throw new Error("That email address is already registered.");
    return await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      passwordHash: args.passwordHash,
      workspaceIds: await checkedWorkspaces(ctx, args.workspaceIds),
      createdAt: Date.now(),
    });
  },
});

export const setPassword = internalMutation({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new Error("User not found.");
    await ctx.db.patch(user._id, { passwordHash: args.passwordHash });
    await endSessionsAndFactor(ctx, user._id);
    return null;
  },
});
