import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireWorkspace } from "./lib/auth";

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
  },
});

export const registerWidgetContact = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    externalId: v.string(),
    channelType: v.literal("web"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("externalId", args.externalId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name ?? existing.name,
        phone: args.phone ?? existing.phone,
        lastSeenAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("contacts", {
      workspaceId: args.workspaceId,
      externalId: args.externalId,
      channelType: args.channelType,
      name: args.name,
      phone: args.phone,
      attributes: [],
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});
