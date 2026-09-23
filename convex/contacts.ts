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

    // The pipeline stages, so a contact's row can say how far along the
    // conversation is rather than only that it is open.
    const stages = await ctx.db
      .query("leadStages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const stageById = new Map(
      stages.map((stage) => [stage._id as string, stage])
    );

    // Every record filed in this workspace, grouped by who it is about, so the
    // table can carry a column per record book.
    //
    // One collect and a grouping pass, not a `by_contact` lookup per contact:
    // the loop below already costs a query per contact, and a workspace has
    // far fewer filed records than it has people who have said hello once.
    const filed = await ctx.db
      .query("records")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    /** The latest record a contact has in one book, and how many in total. */
    type BookCell = {
      stage: string | null;
      reference: string;
      count: number;
      updatedAt: number;
    };
    /** contactId -> bookId -> that cell. */
    const byContact = new Map<string, Map<string, BookCell>>();
    for (const record of filed) {
      if (!record.contactId) continue;
      const key = record.contactId as string;
      const books = byContact.get(key) ?? new Map<string, BookCell>();
      const seen = books.get(record.bookId as string);
      // The latest one speaks for the contact; the rest only add to the count,
      // because "three site visits, the last one attended" is the useful line
      // and three stage badges in one cell is not.
      if (!seen || record.updatedAt > seen.updatedAt) {
        books.set(record.bookId as string, {
          stage: record.stage ?? null,
          reference: record.reference,
          count: (seen?.count ?? 0) + 1,
          updatedAt: record.updatedAt,
        });
      } else {
        seen.count += 1;
      }
      byContact.set(key, books);
    }

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

      const stage = latest?.leadStageId
        ? (stageById.get(latest.leadStageId as string) ?? null)
        : null;

      out.push({
        ...contact,
        conversationId: latest?._id ?? null,
        messageCount: latest?.messageCount ?? 0,
        conversationStatus: latest?.status ?? null,
        // Where the follow-up desk filed the conversation. Null covers both
        // "never messaged" and "not reviewed yet"; the row tells them apart by
        // whether there is a conversation at all.
        leadStage: stage
          ? { name: stage.name, outcome: stage.outcome }
          : null,
        // One entry per book this contact has a record in, so the page can
        // look each one up by id against the column it is drawing.
        records: [...(byContact.get(contact._id as string) ?? new Map())].map(
          ([bookId, row]) => ({
            bookId,
            stage: row.stage,
            reference: row.reference,
            count: row.count,
          })
        ),
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
