import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireContact, requireWorkspace } from "./lib/auth";

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();

    // One lookup of the agent roster rather than one per contact: a workspace
    // has a handful of agents and potentially thousands of contacts.
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const botNames = new Map(agents.map((agent) => [agent._id as string, agent.botName]));

    const out = [];
    for (const contact of contacts) {
      // A contact can have one conversation per agent. The most recently active
      // one is the one a person means by "the conversation".
      const conversations = await ctx.db
        .query("conversations")
        .withIndex("by_contact_agent", (q) => q.eq("contactId", contact._id))
        .collect();
      const latest = conversations.reduce<typeof conversations[number] | null>(
        (best, row) => (!best || row.lastMessageAt > best.lastMessageAt ? row : best),
        null
      );

      out.push({
        ...contact,
        conversationId: latest?._id ?? null,
        messageCount: latest?.messageCount ?? 0,
        conversationStatus: latest?.status ?? null,
        // Who is answering this person right now: the agent the last handoff
        // left in charge, or the one the channel points at.
        handledBy: latest
          ? botNames.get(latest.activeAgentId ?? latest.agentId) ?? null
          : null,
      });
    }
    return out;
  },
});

/** Everything a person may edit about a contact from the contacts table. */
export const update = mutation({
  args: {
    contactId: v.id("contacts"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    assignedBy: v.optional(v.string()),
    assignedTo: v.optional(v.string()),
    remark: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireContact(ctx, args.contactId);
    const { contactId, ...rest } = args;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // A cleared field is stored as absent, not as an empty string, so the
      // table's "—" placeholder and the agent prompt both stay simple.
      patch[key] = value.trim() === "" ? undefined : value.trim();
    }

    await ctx.db.patch(contactId, patch);
    return { success: true };
  },
});
