// The people behind the workspace.
//
// Deliberately not accounts. A workspace has one credential and everyone who
// uses it shares it; these rows say who those people are, so the roster can
// show a team rather than a list of bots and so a reply sent by hand can be
// attributed to whoever sent it.
//
// Which means nothing here is a security boundary. `teamMemberId` on a message
// is a label, not a claim — anybody holding the workspace password can send as
// anybody on the list. Worth knowing before this is ever used to decide who
// may do what.

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSignedIn, requireWorkspace } from "./lib/auth";

const memberStatus = v.union(
  v.literal("active"),
  v.literal("away"),
  v.literal("inactive")
);

/**
 * The photo to draw, whichever way it was supplied.
 *
 * An uploaded file wins over a pasted link: somebody who uploads a photo over
 * a link they pasted earlier means the upload.
 */
async function photoFor(
  ctx: QueryCtx,
  member: Doc<"teamMembers">
): Promise<string | null> {
  if (member.photoStorageId) {
    const url = await ctx.storage.getUrl(member.photoStorageId);
    if (url) return url;
  }
  return member.photoUrl?.trim() || null;
}

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Oldest first, so the row does not reshuffle every time somebody replies.
    members.sort((a, b) => a.createdAt - b.createdAt);

    return await Promise.all(
      members.map(async (member) => ({
        ...member,
        photo: await photoFor(ctx, member),
      }))
    );
  },
});

/** Just enough to pick a sender from, for the reply composer. */
export const activeForReply = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return members
      .filter((member) => member.status !== "inactive")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((member) => ({
        _id: member._id,
        name: member.name,
        role: member.role,
      }));
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    role: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.optional(memberStatus),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const name = args.name.trim();
    if (!name) throw new Error("A teammate needs a name");

    const now = Date.now();
    return await ctx.db.insert("teamMembers", {
      workspaceId: args.workspaceId,
      name,
      role: args.role.trim() || "Team",
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      photoStorageId: args.photoStorageId,
      photoUrl: args.photoUrl?.trim() || undefined,
      note: args.note?.trim() || undefined,
      status: args.status ?? "active",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    memberId: v.id("teamMembers"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.optional(memberStatus),
  },
  handler: async (ctx, args) => {
    const { memberId, ...rest } = args;
    const member = await ctx.db.get("teamMembers", memberId);
    if (!member) throw new Error("Teammate not found");
    await requireWorkspace(ctx, member.workspaceId);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // Empty strings clear an optional field rather than storing "".
      patch[key] = typeof value === "string" ? value.trim() || undefined : value;
    }

    // A new upload replaces the old file rather than orphaning it in storage.
    if (
      args.photoStorageId &&
      member.photoStorageId &&
      args.photoStorageId !== member.photoStorageId
    ) {
      await ctx.storage.delete(member.photoStorageId).catch(() => undefined);
    }

    await ctx.db.patch(memberId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) return { success: true };
    await requireWorkspace(ctx, member.workspaceId);

    if (member.photoStorageId) {
      await ctx.storage.delete(member.photoStorageId).catch(() => undefined);
    }

    // The messages they sent are left alone, pointing at an id that no longer
    // resolves. Deleting a colleague must not rewrite the transcript of what
    // the customer was actually told; the reader falls back to "your team".
    await ctx.db.delete(args.memberId);
    return { success: true };
  },
});

/** Called when a reply goes out under their name. */
export const recordReply = internalMutation({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) return;
    await ctx.db.patch(args.memberId, {
      messageCount: member.messageCount + 1,
      lastActiveAt: Date.now(),
    });
  },
});

/** Guards the id a caller passes, so a reply cannot be attributed across workspaces. */
export async function memberInWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  memberId: Id<"teamMembers">
): Promise<Doc<"teamMembers"> | null> {
  const member = await ctx.db.get("teamMembers", memberId);
  if (!member || member.workspaceId !== workspaceId) return null;
  return member;
}
