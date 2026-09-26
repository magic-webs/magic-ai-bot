// The people behind the workspace — the human agents.
//
// Mostly not accounts. A workspace has one credential and everyone on the
// dashboard shares it; these rows say who those people are, so the roster can
// show a team rather than a list of bots and so a reply sent by hand can be
// attributed to whoever sent it.
//
// So from the dashboard, `teamMemberId` on a message is a label, not a claim —
// anybody holding the workspace password can send as anybody on the list.
//
// The exception is a human agent given a login of their own (`memberCredentials`,
// issued from the Team page). That signs in to the escalations desk only, and
// there the sender is the login: `sendManualReply` ignores whatever id the
// composer passed.

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSignedIn, requireWorkspace } from "./lib/auth";
import { removeMemberLogin } from "./authDb";

/**
 * How far back the roster looks for the last reply a teammate sent by hand.
 * Shorter than the agents' scan because it answers a smaller question — what
 * this person last said, not what the workspace averages — and a person who
 * has not typed anything in the last thousand messages simply shows a count.
 */
const MEMBER_MESSAGE_SCAN_CAP = 1000;
const REPLY_PREVIEW_CHARS = 280;

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

    // The last reply each of them typed. Messages carry `teamMemberId` but are
    // not indexed by it, so this is a capped scan of the newest first — and it
    // is skipped entirely for a workspace with nobody on the list, which is
    // most of them.
    const lastByMember = new Map<string, { text: string; at: number }>();
    if (members.length > 0) {
      const recent = await ctx.db
        .query("messages")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(MEMBER_MESSAGE_SCAN_CAP);

      for (const message of recent) {
        if (!message.sentByHuman || !message.teamMemberId) continue;
        if (lastByMember.has(message.teamMemberId)) continue;
        const text = message.text?.trim();
        if (!text) continue;
        lastByMember.set(message.teamMemberId, {
          text: text.slice(0, REPLY_PREVIEW_CHARS),
          at: message.createdAt,
        });
      }
    }

    return await Promise.all(
      members.map(async (member) => ({
        ...member,
        photo: await photoFor(ctx, member),
        lastMessage: lastByMember.get(member._id) ?? null,
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
    if (!name) throw new Error("A human agent needs a name");

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
    if (!member) throw new Error("Human agent not found");
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

    // Off the roster is off the desk: their login goes, and so does every
    // session it had open.
    await removeMemberLogin(ctx, args.memberId);

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
