import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation } from "./_generated/server";
import { requireContact, requireWorkspace } from "./lib/auth";
import { normaliseBirthday } from "./lib/marketing";
import { normaliseEmail, normalisePhone } from "./lib/notifications";
import { refreshContactSearch } from "./lib/inbox";

/** The most people one paste may add. */
const MAX_ADD = 500;

/**
 * WhatsApp contacts typed in or pasted on the Marketing page, so greetings
 * and event reminders reach people who have not written in yet.
 *
 * Stored exactly as the inbound webhook would store them — the number as
 * digits, country code first — so when one of them replies, their message
 * finds this contact rather than creating a second one beside it.
 *
 * Someone already on file is not duplicated: their name, birthday, email and
 * company are filled in only where they were empty.
 */
export const addMany = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    /** Put in front of a number typed without one, e.g. "91". */
    countryCode: v.optional(v.string()),
    source: v.optional(v.union(v.literal("manual"), v.literal("import"))),
    contacts: v.array(
      v.object({
        name: v.optional(v.string()),
        phone: v.string(),
        birthday: v.optional(v.string()),
        email: v.optional(v.string()),
        company: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.contacts.length === 0) throw new ConvexError("Add at least one number.");
    if (args.contacts.length > MAX_ADD) {
      throw new ConvexError(`Add at most ${MAX_ADD} people at a time.`);
    }

    const now = Date.now();
    let added = 0;
    let updated = 0;
    const invalid: string[] = [];
    const seen = new Set<string>();

    for (const row of args.contacts) {
      const digits = normalisePhone(row.phone, args.countryCode);
      if (!digits) {
        invalid.push(row.phone.trim() || "(empty)");
        continue;
      }
      if (seen.has(digits)) continue;
      seen.add(digits);

      const name = row.name?.trim() || undefined;
      const birthday = row.birthday?.trim()
        ? (normaliseBirthday(row.birthday) ?? undefined)
        : undefined;
      // Dropped rather than refused when it is not an address: the number is
      // what the import is for.
      const email = row.email?.trim() ? (normaliseEmail(row.email) ?? undefined) : undefined;
      const company = row.company?.trim() || undefined;

      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_external", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("externalId", digits)
        )
        .unique();
      if (existing) {
        const patch: {
          name?: string;
          birthday?: string;
          email?: string;
          company?: string;
        } = {};
        if (!existing.name && name) patch.name = name;
        if (!existing.birthday && birthday) patch.birthday = birthday;
        if (!existing.email && email) patch.email = email;
        if (!existing.company && company) patch.company = company;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch("contacts", existing._id, patch);
          if (patch.name) await refreshContactSearch(ctx, existing._id);
        }
        updated++;
        continue;
      }

      await ctx.db.insert("contacts", {
        workspaceId: args.workspaceId,
        externalId: digits,
        channelType: "whatsapp",
        name,
        phone: digits,
        birthday,
        email,
        company,
        attributes: [],
        source: args.source ?? "manual",
        // Required, and there is no "never" to put: the day they were added
        // is the closest thing to when the business last heard of them.
        lastSeenAt: now,
        createdAt: now,
      });
      added++;
    }

    return { added, updated, invalid };
  },
});

/**
 * One page of the WhatsApp contacts, for the CSV export. Paged rather than
 * read whole, so a workspace with tens of thousands of people downloads in a
 * handful of calls instead of failing one oversized read; the page walks them
 * until `isDone`.
 */
export const exportPage = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const result = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((contact) => contact.channelType === "whatsapp")
        .map((contact) => ({
          name: contact.name ?? null,
          // The number messages actually go to, which `phone` — editable on
          // the Contacts page — need not be.
          phone: contact.externalId,
          birthday: contact.birthday ?? null,
          email: contact.email ?? null,
          company: contact.company ?? null,
        })),
    };
  },
});

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
    /** Any readable date; stored as "MM-DD". Empty clears it. */
    birthday: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireContact(ctx, args.contactId);
    const { contactId, birthday, ...rest } = args;

    const patch: Record<string, unknown> = {};
    if (birthday !== undefined) {
      const normalised = normaliseBirthday(birthday);
      if (birthday.trim() && !normalised) {
        throw new ConvexError("That birthday is not a real day of the year.");
      }
      patch.birthday = normalised ?? undefined;
    }
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // A cleared field is stored as absent, not as an empty string, so the
      // table's "—" placeholder and the agent prompt both stay simple.
      patch[key] = value.trim() === "" ? undefined : value.trim();
    }

    await ctx.db.patch(contactId, patch);
    await refreshContactSearch(ctx, contactId);
    return { success: true };
  },
});

export const setSubscribed = mutation({
  args: { contactId: v.id("contacts"), subscribed: v.boolean() },
  handler: async (ctx, args) => {
    const contact = await requireContact(ctx, args.contactId);
    await ctx.db.patch("contacts", contact._id, {
      optedOutAt: args.subscribed ? undefined : Date.now(),
      optOutReason: args.subscribed ? undefined : "manual",
    });
    return { success: true };
  },
});
