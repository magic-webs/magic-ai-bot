// The escalations desk: where a human agent, signed in with a login of their
// own, answers the threads the agents handed to a person.
//
// Only the list and the header live here. Reading a thread, replying and
// resolving go through the same functions the inbox uses — see `threadAccess`
// in convex/lib/auth.ts, which is what lets a human agent through on an
// escalated thread and nowhere else.

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { inboxRows } from "./conversations";

/**
 * Who is signed in, and just enough of their workspace to draw the page.
 *
 * Picked fields rather than the workspace document: that carries the webhook
 * secret, and a human agent has no business with it.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireMember(ctx);
    const member = await ctx.db.get("teamMembers", principal.memberId);
    const workspace = await ctx.db.get("workspaces", principal.workspaceId);
    if (!member || !workspace) return null;

    const photo = member.photoStorageId
      ? await ctx.storage.getUrl(member.photoStorageId)
      : null;

    // For the faces on the agents' bubbles, and nothing more.
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();

    return {
      member: {
        _id: member._id,
        name: member.name,
        role: member.role,
        photo: photo ?? member.photoUrl?.trim() ?? null,
      },
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
      },
      agents: agents.map((agent) => ({
        _id: agent._id,
        botName: agent.botName,
        gender: agent.gender ?? null,
      })),
    };
  },
});

/** The workspace's escalated threads, newest first, as the inbox lists them. */
export const escalations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireMember(ctx);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", principal.workspaceId).eq("status", "escalated")
      )
      .order("desc")
      .take(args.limit ?? 200);
    return await inboxRows(ctx, principal.workspaceId, rows);
  },
});
