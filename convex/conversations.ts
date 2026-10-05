import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { ObjectType } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair } from "./schema";
import { deleteMessage, noteSent } from "./lib/delivery";
import { historyText, type Outbound } from "./lib/whatsappSend";
import { normaliseBirthday } from "./lib/marketing";
import { recordAgentReply, REPLY_PREVIEW_CHARS } from "./lib/agentStats";
import {
  EMPTY_INBOX_COUNTS,
  INBOX_COUNT_KEYS,
  countsOf,
  deleteConversation,
  insertConversation,
  isAwaitingReply,
  pickCounts,
  searchTextFor,
  noteMessage,
  patchConversation,
  refreshContactSearch,
} from "./lib/inbox";
import {
  BOT_REPEAT_LIMIT,
  HANDBACK_AFTER_MINUTES,
  WHATSAPP_FREE_FORM_WINDOW_HOURS,
  WHATSAPP_TEXT_LIMIT,
  clampPause,
  pauseLabel,
} from "./lib/shared";
import {
  AuthError,
  requireAgent,
  requireContact,
  requireConversation,
  requireWorkspace,
  threadAccess,
} from "./lib/auth";

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    /**
     * Only threads at this status, read through their own index — the
     * inbox's Escalations tab. The agent filter is applied after the read on
     * this path: one status is a short list, and a second index for every
     * pairing of agent and status would be one more to keep for little gain.
     */
    status: v.optional(
      v.union(v.literal("open"), v.literal("escalated"), v.literal("closed"))
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const limit = args.limit ?? 60;
    const status = args.status;
    const rows = status
      ? (
          await ctx.db
            .query("conversations")
            .withIndex("by_workspace_status", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("status", status)
            )
            .order("desc")
            .take(limit)
        ).filter((row) => !args.agentId || row.agentId === args.agentId)
      : args.agentId
        ? await ctx.db
            .query("conversations")
            .withIndex("by_agent", (q) => q.eq("agentId", args.agentId!))
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("conversations")
            .withIndex("by_workspace_lastMessageAt", (q) =>
              q.eq("workspaceId", args.workspaceId)
            )
            .order("desc")
            .take(limit);

    return await inboxRows(ctx, args.workspaceId, rows);
  },
});

/**
 * The inbox, a page at a time, newest activity first.
 *
 * The bucket picks the index, so the common views read only the rows they
 * show. The other filters narrow inside that range.
 */
export const inboxArgs = {
  workspaceId: v.id("workspaces"),
  paginationOpts: paginationOptsValidator,
  escalations: v.optional(v.boolean()),
  bucket: v.optional(
    v.union(
      v.literal("all"),
      v.literal("open"),
      v.literal("unread"),
      v.literal("closed")
    )
  ),
  channelType: v.optional(v.union(v.literal("whatsapp"), v.literal("web"))),
  channelId: v.optional(v.id("channels")),
  agentId: v.optional(v.id("agents")),
  stageId: v.optional(v.id("leadStages")),
  handling: v.optional(v.union(v.literal("team"), v.literal("agent"))),
  bots: v.optional(v.union(v.literal("hide"), v.literal("only"))),
  since: v.optional(v.number()),
  search: v.optional(v.string()),
};

export const listInbox = query({
  args: inboxArgs,
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await inboxPage(ctx, args);
  },
});

export async function inboxPage(
  ctx: QueryCtx,
  args: ObjectType<typeof inboxArgs>
) {
  const workspaceId = args.workspaceId;
  const since = args.since ?? 0;
  const unread = args.bucket === "unread";
  const status = args.escalations
    ? ("escalated" as const)
    : args.bucket === "open" || args.bucket === "closed"
      ? args.bucket
      : undefined;
  const term = args.search?.trim().slice(0, 100);

  const conversations = ctx.db.query("conversations");
  const range = term
    ? conversations.withSearchIndex("search_inbox", (q) => {
        const matched = q.search("searchText", term).eq("workspaceId", workspaceId);
        const byStatus = status ? matched.eq("status", status) : matched;
        const byType = args.channelType
          ? byStatus.eq("channelType", args.channelType)
          : byStatus;
        return args.channelId ? byType.eq("channelId", args.channelId) : byType;
      })
    : unread
      ? conversations
          .withIndex("by_workspace_role_lastMessageAt", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("lastMessageRole", "user")
              .gte("lastMessageAt", since)
          )
          .order("desc")
      : status
        ? conversations
            .withIndex("by_workspace_status_lastMessageAt", (q) =>
              q
                .eq("workspaceId", workspaceId)
                .eq("status", status)
                .gte("lastMessageAt", since)
            )
            .order("desc")
        : conversations
            .withIndex("by_workspace_lastMessageAt", (q) =>
              q.eq("workspaceId", workspaceId).gte("lastMessageAt", since)
            )
            .order("desc");

  const result = await range
    .filter((q) => {
      const all = [];
      if (term && since) all.push(q.gte(q.field("lastMessageAt"), since));
      if (unread) {
        if (term) all.push(q.eq(q.field("lastMessageRole"), "user"));
        if (status) all.push(q.eq(q.field("status"), status));
        else all.push(q.neq(q.field("status"), "closed"));
        all.push(q.neq(q.field("markedBot"), true));
      }
      if (args.channelType && !term) {
        all.push(q.eq(q.field("channelType"), args.channelType));
      }
      if (args.channelId && !term) {
        all.push(q.eq(q.field("channelId"), args.channelId));
      }
      if (args.agentId) all.push(q.eq(q.field("activeAgentId"), args.agentId));
      if (args.stageId) all.push(q.eq(q.field("leadStageId"), args.stageId));
      if (args.handling === "team") all.push(q.eq(q.field("humanHandling"), true));
      if (args.handling === "agent") all.push(q.neq(q.field("humanHandling"), true));
      if (args.bots === "hide") all.push(q.neq(q.field("markedBot"), true));
      if (args.bots === "only") all.push(q.eq(q.field("markedBot"), true));
      return all.length > 0 ? q.and(...all) : true;
    })
    .paginate(args.paginationOpts);

  return { ...result, page: await inboxRows(ctx, workspaceId, result.page) };
}

/** Every bucket's size across the whole workspace, from one row. */
export const inboxCounts = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const row = await ctx.db
      .query("inboxCounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    return row ? pickCounts(row) : EMPTY_INBOX_COUNTS;
  },
});

/**
 * How many threads are escalated, for the badge on the sidebar's Escalations
 * row. Counted off the status index and capped: the sidebar is on every page,
 * and past ninety-nine the badge says "99+" whatever the real number is.
 */
export const escalatedCount = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const row = await ctx.db
      .query("inboxCounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    return row?.escalated ?? 0;
  },
});

/**
 * Threads as the inbox lists them: the row, plus who it arrived at, who holds
 * it now, who it is with, and whether they are waiting. Shared with the
 * escalations desk in convex/desk.ts, so the two lists cannot drift apart.
 * The caller has already checked access to the workspace.
 */
export async function inboxRows(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  rows: Doc<"conversations">[]
) {
  const agentNames = new Map<Id<"agents">, string>();
  const nameOf = async (agentId: Id<"agents">) => {
    if (!agentNames.has(agentId)) {
      const agent = await ctx.db.get("agents", agentId);
      agentNames.set(agentId, agent?.workspaceId === workspaceId ? agent.botName : "—");
    }
    return agentNames.get(agentId)!;
  };

  const channelNames = new Map<Id<"channels">, string | null>();
  const channelOf = async (channelId: Id<"channels"> | undefined) => {
    if (!channelId) return null;
    if (!channelNames.has(channelId)) {
      const channel = await ctx.db.get("channels", channelId);
      channelNames.set(
        channelId,
        channel?.workspaceId === workspaceId ? channel.name : null
      );
    }
    return channelNames.get(channelId)!;
  };

  const out = [];
  for (const stored of rows) {
    const row = { ...stored, searchText: undefined };
    const contact = await ctx.db.get("contacts", row.contactId);
    const holderId = row.activeAgentId ?? row.agentId;
    const agentName = await nameOf(row.agentId);
    const activeAgentName = await nameOf(holderId);
    out.push({
      ...row,
      agentName,
      // Who answered last. Differs from agentName once the front desk has
      // routed the conversation on.
      activeAgentName,
      handedOff: holderId !== row.agentId,
      channelName: await channelOf(row.channelId),
      contactLabel:
        contact?.name ?? contact?.phone ?? contact?.externalId ?? "Unknown",
      contactExternalId: contact?.externalId,
      // The customer spoke last, so the thread is waiting on somebody. This
      // is what the inbox calls unread.
      awaitingReply: await spokeLast(ctx, row),
    });
  }
  return out;
}

/**
 * Whether the customer has the last word on a thread.
 *
 * Reads the denormalised `lastMessageRole` where it is there, and falls back
 * to the tail of the transcript where it is not — rows written before that
 * field existed. Bounded rather than take(1) because the last row can be a
 * tool call or an internal note, neither of which anybody said.
 */
async function spokeLast(
  ctx: QueryCtx,
  row: Omit<Doc<"conversations">, "searchText">
): Promise<boolean> {
  if (row.lastMessageRole) return isAwaitingReply(row);

  const tail = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", row._id))
    .order("desc")
    .take(6);
  const spoken = tail.find(
    (message) =>
      (message.kind === "text" || message.kind === "rich") &&
      (message.role === "user" || message.role === "assistant")
  );
  return spoken?.role === "user";
}

/**
 * Open a thread with somebody the workspace already knows, from the inbox.
 *
 * Get-or-create, on the same (contact, agent) key the inbound webhook uses, so
 * "New conversation" on a contact who has written before lands on the thread
 * that already exists rather than forking a second one beside it. No message
 * is sent: this only puts the thread on screen so the composer has somewhere
 * to post to.
 */
export const startFromContact = mutation({
  args: {
    contactId: v.id("contacts"),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const contact = await requireContact(ctx, args.contactId);
    const agent = await requireAgent(ctx, args.agentId);
    if (agent.workspaceId !== contact.workspaceId) {
      throw new Error("That agent belongs to another workspace.");
    }

    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_contact_agent", (q) =>
        q.eq("contactId", args.contactId).eq("agentId", args.agentId)
      )
      .unique();
    if (existing) return { conversationId: existing._id, created: false };

    // Where a reply would go out. A WhatsApp thread with no channel attached
    // can be read but not answered, so prefer a live one and settle for a
    // paused one rather than leaving it unset.
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const matching = channels.filter((c) => c.type === contact.channelType);
    const channel =
      matching.find((c) => c.status === "active") ?? matching[0] ?? undefined;

    const now = Date.now();
    const conversationId = await insertConversation(ctx, {
      workspaceId: contact.workspaceId,
      agentId: args.agentId,
      activeAgentId: args.agentId,
      handoffCount: 0,
      contactId: args.contactId,
      channelId: channel?._id,
      channelType: contact.channelType,
      status: "open",
      messageCount: 0,
      lastMessageAt: now,
      createdAt: now,
    });
    return { conversationId, created: true };
  },
});

export const listMessages = query({
  args: {
    conversationId: v.optional(v.id("conversations")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.conversationId) return [];
    // The desk reads transcripts too — see threadAccess.
    if (!(await threadAccess(ctx, args.conversationId))) return [];
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId!)
      )
      .order("asc")
      .take(args.limit ?? 400);
  },
});

// Resolves the conversation for a web-playground session without creating one,
// so the chat UI can subscribe reactively before the first message is sent.
export const findWebConversation = query({
  args: { agentId: v.id("agents"), sessionId: v.string() },
  handler: async (ctx, args) => {
    await requireAgent(ctx, args.agentId);
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) return null;

    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", agent.workspaceId).eq("externalId", args.sessionId)
      )
      .unique();
    if (!contact) return null;

    return await ctx.db
      .query("conversations")
      .withIndex("by_contact_agent", (q) =>
        q.eq("contactId", contact._id).eq("agentId", args.agentId)
      )
      .unique();
  },
});

export const getWithContact = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    // Null for a thread that has left a human agent's desk, as for one that
    // has been deleted: both mean there is nothing here to read any more.
    const access = await threadAccess(ctx, args.conversationId);
    if (!access) return null;
    const { conversation } = access;
    const contact = await ctx.db.get("contacts", conversation.contactId);
    const agent = await ctx.db.get("agents", conversation.agentId);

    // When the customer last spoke. WhatsApp only allows a free-form reply
    // within 24 hours of that, so the composer has to be able to say so
    // before someone types a message that cannot be delivered.
    const inbound = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .take(100);
    const lastInboundAt =
      inbound.find((message) => message.role === "user")?.createdAt ?? null;

    // Judged here rather than in the browser: the server's clock is the one
    // the send path will be measured against, and a component cannot read a
    // clock during render without breaking the purity rule the lint config
    // enforces.
    const freeFormWindowClosed =
      conversation.channelType === "whatsapp" &&
      (lastInboundAt === null ||
        Date.now() - lastInboundAt >
          WHATSAPP_FREE_FORM_WINDOW_HOURS * 60 * 60_000);

    const channelDoc = conversation.channelId
      ? await ctx.db.get("channels", conversation.channelId)
      : null;
    const channel =
      channelDoc && channelDoc.workspaceId === conversation.workspaceId
        ? {
            name: channelDoc.name,
            phone: channelDoc.whatsapp?.displayPhoneNumber ?? null,
          }
        : null;

    return {
      conversation,
      contact,
      agent,
      channel,
      lastInboundAt,
      freeFormWindowClosed,
    };
  },
});

// ---------------------------------------------------------------------------
// Dashboard writes
// ---------------------------------------------------------------------------

export const reset = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    // The guard hands the document back, so there is no second read.
    const conversation = await requireConversation(ctx, args.conversationId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
    for (const message of messages) await deleteMessage(ctx, message);

    await patchConversation(ctx, conversation, {
      messageCount: 0,
      status: "open",
      lastMessagePreview: undefined,
      lastMessageRole: undefined,
      lastMessageFrom: undefined,
      lastMessageSender: undefined,
      unreadCount: 0,
      lastMessageAt: Date.now(),
      // Give the thread back to the entry agent. Clearing the transcript alone
      // left whichever specialist the last handoff put in charge still holding
      // it, so the next message skipped the front desk and was answered by an
      // agent nobody had chosen — a "clean" conversation that was anything but,
      // and routing that could not be tested twice in a row.
      activeAgentId: conversation.agentId,
      handoffCount: 0,
    });
    return { success: true };
  },
});

export const setStatus = mutation({
  args: {
    conversationId: v.id("conversations"),
    status: v.union(
      v.literal("open"),
      v.literal("escalated"),
      v.literal("closed")
    ),
  },
  handler: async (ctx, args) => {
    // A human agent resolving their escalation is the commonest caller, and
    // the last one they can make on it: once it is open or closed it has left
    // the desk.
    const access = await threadAccess(ctx, args.conversationId);
    if (!access) throw new AuthError(OFF_THE_DESK);
    await patchConversation(ctx, access.conversation, { status: args.status });
    return { success: true };
  },
});

const OFF_THE_DESK = "This conversation is no longer available here.";

export const remove = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(ctx, args.conversationId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
    for (const message of messages) await deleteMessage(ctx, message);
    await deleteConversation(ctx, conversation);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Replying by hand
//
// A person taking a thread over from the agent — the customer asked something
// the agent should not answer, or escalated and is waiting on a colleague.
// The message goes out over the same channel the agent uses and is recorded as
// an ordinary outgoing message, so the customer sees one voice and the model
// replays it as its own words. `sentByHuman` is the only difference, and it
// exists so the transcript can attribute it.
// ---------------------------------------------------------------------------

/**
 * Everything a manual reply needs, behind the same guard as the rest of the
 * page. An internal query rather than a public one only because nothing but
 * the action below should call it — the caller's identity still propagates
 * here, so `requireConversation` is a real check.
 */
export const manualSendContext = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args.conversationId);
    if (!access) return null;
    const { conversation, principal } = access;
    const contact = await ctx.db.get("contacts", conversation.contactId);

    return {
      workspaceId: conversation.workspaceId,
      channelType: conversation.channelType,
      channelId: conversation.channelId ?? null,
      externalId: contact?.externalId ?? null,
      // Attributed to whoever holds the thread, so the message sits with the
      // rest of that agent's replies rather than looking like it came from the
      // entry point.
      agentId: conversation.activeAgentId ?? conversation.agentId,
      // A human agent signs as themselves, whatever the composer sent: on the
      // desk the sender is the login, not a pick from a list.
      memberId: principal.role === "member" ? principal.memberId : null,
    };
  },
});

/** Files a hand-typed reply on the thread. Mirrors `leads.recordFollowUp`. */
export const recordManualReply = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    agentId: v.optional(v.id("agents")),
    text: v.string(),
    teamMemberId: v.optional(v.id("teamMembers")),
    /** How long this reply keeps the agent quiet. An hour when absent. */
    pauseMinutes: v.optional(v.number()),
    /** Present when it went out over WhatsApp, with the provider's id. */
    whatsapp: v.optional(v.object({ wamid: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Checked rather than trusted: the id arrives from the client, and a
    // reply must not be attributed to somebody in another workspace.
    const member = args.teamMemberId
      ? await ctx.db.get("teamMembers", args.teamMemberId)
      : null;
    const sender =
      member && member.workspaceId === args.workspaceId ? member : null;

    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "assistant",
      kind: "text",
      text: args.text,
      agentId: args.agentId,
      sentByHuman: true,
      teamMemberId: sender?._id,
      createdAt: now,
    });
    const delivery = await noteSent(ctx, messageId, args.whatsapp);

    if (sender) {
      const text = args.text.trim();
      await ctx.db.patch(sender._id, {
        messageCount: sender.messageCount + 1,
        lastActiveAt: now,
        ...(text
          ? { lastReplyText: text.slice(0, REPLY_PREVIEW_CHARS), lastReplyAt: now }
          : {}),
      });
    }

    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) {
      await noteMessage(
        ctx,
        conversation,
        { from: "team", sender: sender?.name, preview: args.text, at: now, delivery },
        {
        // Replying by hand is the takeover. Anything else would have the agent
        // answer the customer's next message over the top of a colleague who
        // is mid-conversation with them.
        humanHandling: true,
        // Restarts the hold's clock. Someone working a thread keeps it; the
        // sweep only reclaims one nobody has touched.
        humanHandlingAt: now,
        humanHandlingUntil: now + clampPause(args.pauseMinutes) * 60_000,
        }
      );
    }
    return { success: true };
  },
});

/** Hands the thread back to the agent, or takes it over without replying. */
export const setHumanHandling = mutation({
  args: {
    conversationId: v.id("conversations"),
    handling: v.boolean(),
    /** Taking over only: how long for. An hour when absent. */
    pauseMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args.conversationId);
    if (!access) throw new AuthError(OFF_THE_DESK);
    const now = Date.now();
    await patchConversation(ctx, access.conversation, {
      humanHandling: args.handling,
      // Cleared rather than left behind: the sweep finds held threads through
      // these fields' indexes, and a stale timestamp on a released thread
      // would keep it in the range forever.
      humanHandlingAt: args.handling ? now : undefined,
      humanHandlingUntil: args.handling
        ? now + clampPause(args.pauseMinutes) * 60_000
        : undefined,
    });
    return { success: true };
  },
});

/** Marks the thread as a bot, which drops its messages unanswered, or clears it. */
export const setBot = mutation({
  args: {
    conversationId: v.id("conversations"),
    bot: v.boolean(),
  },
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args.conversationId);
    if (!access) throw new AuthError(OFF_THE_DESK);
    const { conversation } = access;
    if ((conversation.markedBot ?? false) === args.bot) return { success: true };

    const now = Date.now();
    await patchConversation(ctx, conversation, {
      markedBot: args.bot || undefined,
      markedBotAt: args.bot ? now : undefined,
      repeatText: undefined,
      repeatCount: undefined,
    });
    await ctx.db.insert("messages", {
      workspaceId: conversation.workspaceId,
      conversationId: conversation._id,
      role: "system",
      kind: "note",
      text: args.bot
        ? "Marked as a bot. Its messages are now ignored and no agent answers it."
        : "No longer marked as a bot. The agent answers it again.",
      createdAt: now,
    });
    return { success: true };
  },
});

/**
 * Hands back every thread a person took over and then left alone.
 *
 * Run from a cron. Taking a thread over is one click and giving it back is
 * another, and the second is the one that gets forgotten — which leaves the
 * customer messaging a thread no agent will answer and no colleague is
 * reading. The hold expires instead.
 */
export const releaseDormantTakeovers = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    /* Two clocks on purpose. `args.now` only ever moves the cutoff, so a test
       can wind it forward without that ending up in a stored row; anything
       written keeps the real wall clock, or a swept thread gets a note dated
       an hour into the future. */
    const at = args.now ?? Date.now();
    const now = Date.now();
    const limit = args.limit ?? 100;
    let released = 0;

    /* Holds that carry their own end, soonest first, and capped — a sweep is
       a background job and must not become a full table read. The range
       starts above zero so the index skips every conversation that was never
       held, which is nearly all of them. */
    const due = await ctx.db
      .query("conversations")
      .withIndex("by_humanHandlingUntil", (q) =>
        q.gt("humanHandlingUntil", 0).lte("humanHandlingUntil", at)
      )
      .order("asc")
      .take(limit);
    for (const conversation of due) {
      if (!conversation.humanHandling) {
        // Released some other way without the end being cleared. Take it out
        // of the range, or it is read on every sweep from now on.
        await ctx.db.patch(conversation._id, { humanHandlingUntil: undefined });
        continue;
      }
      await releaseHold(ctx, conversation, now);
      released += 1;
    }

    /* Holds taken before a hold carried its end: the fixed hour, counted from
       the last reply. Oldest first, so the loop stops at the first one still
       inside its hour. */
    const cutoff = at - HANDBACK_AFTER_MINUTES * 60_000;
    const legacy = await ctx.db
      .query("conversations")
      .withIndex("by_humanHandlingAt", (q) => q.gt("humanHandlingAt", 0))
      .order("asc")
      .take(limit);
    for (const conversation of legacy) {
      if (!conversation.humanHandling || conversation.humanHandlingUntil) continue;
      if ((conversation.humanHandlingAt ?? 0) > cutoff) break;
      await releaseHold(ctx, conversation, now);
      released += 1;
    }

    return { released };
  },
});

/**
 * Whether a held thread's pause is over. A hold with no stamp at all predates
 * both fields and is by definition older than any pause, so it is over too.
 */
function holdIsOver(conversation: Doc<"conversations">, now: number): boolean {
  const end =
    conversation.humanHandlingUntil ??
    (conversation.humanHandlingAt
      ? conversation.humanHandlingAt + HANDBACK_AFTER_MINUTES * 60_000
      : 0);
  return end <= now;
}

/**
 * Give a held thread back to the agent, and say so in the thread.
 *
 * Written into the thread rather than done silently. Whoever opens it next
 * needs to know why the agent started answering again, and the alternative —
 * a colleague discovering it from the customer — is how people stop trusting
 * the takeover at all. "note" is internal, so the customer never sees this.
 */
async function releaseHold(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  now: number
) {
  const minutes =
    conversation.humanHandlingUntil && conversation.humanHandlingAt
      ? Math.round(
          (conversation.humanHandlingUntil - conversation.humanHandlingAt) /
            60_000
        )
      : HANDBACK_AFTER_MINUTES;

  await patchConversation(ctx, conversation, {
    humanHandling: false,
    humanHandlingAt: undefined,
    humanHandlingUntil: undefined,
  });
  await ctx.db.insert("messages", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    role: "system",
    kind: "note",
    text: `Handed back to the agent automatically — nobody replied by hand for ${pauseLabel(minutes)}. Take it over again to stop the agent answering.`,
    createdAt: now,
  });
}

/**
 * Sends a message a person typed, and records it.
 *
 * An action rather than a mutation because WhatsApp has to be called: the row
 * is only written once the send succeeded, so a transcript never shows a
 * colleague's reply that never arrived. Failures come back as `error` for the
 * composer to show — the commonest by far being WhatsApp's 24-hour rule, which
 * no amount of retrying will get around.
 */
export const sendManualReply = action({
  args: {
    conversationId: v.id("conversations"),
    text: v.string(),
    /**
     * Which colleague is sending it. A label on the message, not a
     * permission — see the note at the top of convex/team.ts. Ignored for a
     * human agent signed in on the desk, who always sends as themselves.
     */
    teamMemberId: v.optional(v.id("teamMembers")),
    /** How long the reply keeps the agent quiet. An hour when absent. */
    pauseMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const body = args.text.trim().slice(0, WHATSAPP_TEXT_LIMIT);
    if (!body) return { ok: false, error: "Type a message first." };

    const context = await ctx.runQuery(internal.conversations.manualSendContext, {
      conversationId: args.conversationId,
    });
    if (!context) {
      return { ok: false, error: "This conversation is no longer available." };
    }

    let whatsapp: { wamid?: string } | undefined;
    if (context.channelType === "whatsapp") {
      if (!context.channelId || !context.externalId) {
        return {
          ok: false,
          error:
            "This thread has no WhatsApp channel attached, so there is nowhere to send it.",
        };
      }
      const sent: { ok: boolean; error?: string; wamid?: string } =
        await ctx.runAction(internal.whatsapp.sendOutbound, {
          channelId: context.channelId,
          to: context.externalId,
          message: { kind: "text", body },
          source: "human",
          conversationId: args.conversationId,
        });
      if (!sent.ok) {
        return {
          ok: false,
          error: sent.error ?? "WhatsApp rejected the message.",
        };
      }
      whatsapp = { wamid: sent.wamid };
    }
    // On the web widget there is nothing to post to: recording the message is
    // the delivery, and the visitor's open subscription renders it. Same
    // reasoning as the follow-up desk in convex/followUp.ts.

    await ctx.runMutation(internal.conversations.recordManualReply, {
      workspaceId: context.workspaceId,
      conversationId: args.conversationId,
      agentId: context.agentId,
      text: body,
      teamMemberId: context.memberId ?? args.teamMemberId,
      pauseMinutes: args.pauseMinutes,
      whatsapp,
    });

    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Runtime internals
// ---------------------------------------------------------------------------

/**
 * The model-facing text of a rich row, or null when there is nothing stored to
 * read it from — in which case the caller falls back to the summary.
 */
function richHistoryText(
  kind: string,
  payload: string | undefined
): string | null {
  if (kind !== "rich" || !payload) return null;
  try {
    return historyText(JSON.parse(payload) as Outbound);
  } catch {
    return null;
  }
}

/** How far back a marketing message still counts as what someone is answering. */
const SEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** The most of them a new thread opens with. */
const SEED_LIMIT = 2;

/**
 * The latest marketing messages delivered to a contact, oldest first, for a
 * thread opened by their reply. Only sends that kept their text, which is
 * every one since the log started keeping it.
 */
async function marketingSeeds(
  ctx: QueryCtx,
  contactId: Id<"contacts">,
  now: number
): Promise<Array<{ text: string; agentId?: Id<"agents">; createdAt: number }>> {
  // One row per occasion a contact was sent — a festival, a birthday, a
  // reminder — so a year of them is a few dozen rows at most.
  const sends = await ctx.db
    .query("marketingSends")
    .withIndex("by_contact_and_key", (q) => q.eq("contactId", contactId))
    .take(200);
  return sends
    .filter(
      (row) =>
        row.status === "sent" && row.text && row.createdAt >= now - SEED_WINDOW_MS
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-SEED_LIMIT)
    .map((row) => ({
      text: row.text!,
      agentId: row.agentId,
      createdAt: row.createdAt,
    }));
}

// Upserts the contact, gets-or-creates the conversation, records the inbound
// message and returns the replay history — all in one transaction so
// concurrent inbound webhooks can't fork a conversation.
export const startTurn = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    channelId: v.optional(v.id("channels")),
    channelType: v.union(v.literal("whatsapp"), v.literal("web")),
    externalId: v.string(),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    text: v.string(),
    historyLimit: v.number(),
    messageLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("externalId", args.externalId)
      )
      .unique();

    if (!contact) {
      const contactId = await ctx.db.insert("contacts", {
        workspaceId: args.workspaceId,
        externalId: args.externalId,
        channelType: args.channelType,
        name: args.contactName,
        phone: args.contactPhone,
        attributes: [],
        lastSeenAt: now,
        createdAt: now,
      });
      contact = (await ctx.db.get("contacts", contactId))!;
    } else {
      await ctx.db.patch(contact._id, {
        lastSeenAt: now,
        name: contact.name ?? args.contactName,
        phone: contact.phone ?? args.contactPhone,
      });
    }

    let conversation = await ctx.db
      .query("conversations")
      .withIndex("by_contact_agent", (q) =>
        q.eq("contactId", contact!._id).eq("agentId", args.agentId)
      )
      .unique();

    if (!conversation) {
      // Somebody writing in for the first time may be answering a greeting or
      // an event reminder the marketing desk sent them. The desk opens a
      // thread for every message it sends now, so this only finds sends from
      // before it did, when the send log was their only record — and the new
      // thread opens with them, so the inbox shows what they are replying to
      // and the agent reads it in its history below.
      const seeds =
        args.channelType === "whatsapp"
          ? await marketingSeeds(ctx, contact._id, now)
          : [];

      const conversationId = await insertConversation(ctx, {
        workspaceId: args.workspaceId,
        agentId: args.agentId,
        // A brand new conversation is held by whoever the channel points at —
        // normally the front desk, until it routes the turn onwards.
        activeAgentId: args.agentId,
        handoffCount: 0,
        contactId: contact._id,
        channelId: args.channelId,
        channelType: args.channelType,
        status: "open",
        messageCount: seeds.length,
        lastMessageAt: now,
        createdAt: now,
      });
      for (const seed of seeds) {
        await ctx.db.insert("messages", {
          workspaceId: args.workspaceId,
          conversationId,
          role: "assistant",
          kind: "text",
          text: seed.text,
          agentId: seed.agentId,
          createdAt: seed.createdAt,
        });
      }
      conversation = (await ctx.db.get("conversations", conversationId))!;
    }

    if (conversation.markedBot) {
      return { blocked: true as const, conversationId: conversation._id };
    }

    // A pause that has run out ends here, on the customer's next message,
    // rather than whenever the sweep next comes round — which is every fifteen
    // minutes, and a customer on a fifteen-minute pause should not wait up to
    // twice that for an answer.
    let humanHandling = conversation.humanHandling ?? false;
    if (humanHandling && holdIsOver(conversation, now)) {
      await releaseHold(ctx, conversation, now);
      humanHandling = false;
    }

    // History must be read before the new message is inserted.
    const priorMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation!._id)
      )
      .order("desc")
      .take(args.historyLimit * 2);

    const history = priorMessages
      .filter(
        (m) =>
          (m.kind === "text" || m.kind === "rich") &&
          (m.role === "user" || m.role === "assistant")
      )
      .reverse()
      .slice(-args.historyLimit)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        // A rich message's stored text is its transcript summary, which spells
        // the options out in brackets. Replaying that taught the model to type
        // "[list: A | B]" at customers, so the model gets the sentence the
        // customer actually read and no control syntax at all.
        content: richHistoryText(m.kind, m.payload) ?? m.text ?? "",
      }))
      .filter((m) => m.content.length > 0);

    await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: conversation._id,
      role: "user",
      kind: "text",
      text: args.text,
      createdAt: now,
    });

    const repeatText = args.text.trim().toLowerCase().replace(/\s+/g, " ");
    const repeatCount =
      repeatText === conversation.repeatText
        ? (conversation.repeatCount ?? 0) + 1
        : 1;
    const caughtAsBot = repeatCount > BOT_REPEAT_LIMIT;

    await noteMessage(
      ctx,
      conversation,
      { from: "customer", preview: args.text, at: now },
      {
      channelId: conversation.channelId ?? args.channelId,
      repeatText,
      repeatCount,
      ...(caughtAsBot ? { markedBot: true, markedBotAt: now } : {}),
      // A thread the marketing desk opened becomes a real conversation the
      // moment the customer answers it.
      ...(conversation.marketingOnly ? { marketingOnly: undefined } : {}),
      }
    );

    if (caughtAsBot) {
      await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: conversation._id,
        role: "system",
        kind: "note",
        text: `Blocked as a bot — the same message arrived more than ${BOT_REPEAT_LIMIT} times in a row. Its messages are now ignored and no agent answers it. Unmark it as a bot to let it through again.`,
        createdAt: now,
      });
      return { blocked: true as const, conversationId: conversation._id };
    }

    const limitReached =
      !!args.messageLimit && conversation.messageCount >= args.messageLimit;
    if (limitReached && !conversation.messageLimitReachedAt) {
      await ctx.db.patch(conversation._id, { messageLimitReachedAt: now });
      await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: conversation._id,
        role: "system",
        kind: "note",
        text: `This conversation reached the workspace limit of ${args.messageLimit} messages, so the agent has stopped replying. Answer by hand, or raise the limit in Settings.`,
        createdAt: now,
      });
    } else if (!limitReached && conversation.messageLimitReachedAt) {
      await ctx.db.patch(conversation._id, { messageLimitReachedAt: undefined });
    }

    return {
      blocked: false as const,
      contactId: contact._id,
      conversationId: conversation._id,
      // Whoever the last handoff left in charge. The engine runs this agent,
      // not necessarily the one the channel points at.
      activeAgentId: conversation.activeAgentId ?? conversation.agentId,
      // Set when a colleague has taken the thread over. The inbound message
      // above is still recorded; the engine reads this and does not answer.
      humanHandling,
      limitReached,
      contact: {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
        attributes: contact.attributes,
      },
      history,
      isFirstTurn: conversation.messageCount === 0,
    };
  },
});

// Records the tool trace plus the assistant reply produced for one turn.
export const finishTurn = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    // Which agent ended up answering. Recorded on the message so a routed
    // conversation reads correctly weeks later.
    agentId: v.optional(v.id("agents")),
    replyText: v.optional(v.string()),
    errorText: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    toolCalls: v.array(
      v.object({
        toolName: v.string(),
        toolInput: v.string(),
        toolOutput: v.string(),
        toolOk: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const call of args.toolCalls) {
      await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        role: "system",
        kind: "tool",
        toolName: call.toolName,
        toolInput: call.toolInput,
        toolOutput: call.toolOutput,
        toolOk: call.toolOk,
        createdAt: now,
      });
    }

    if (args.errorText) {
      await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        role: "system",
        kind: "error",
        text: args.errorText,
        createdAt: now,
      });
    }

    let replyMessageId: Id<"messages"> | undefined;
    if (args.replyText) {
      const conversation = await ctx.db.get(
        "conversations",
        args.conversationId
      );
      const delivery =
        conversation?.channelType === "whatsapp" ? ("pending" as const) : undefined;
      replyMessageId = await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        role: "assistant",
        kind: "text",
        text: args.replyText,
        agentId: args.agentId,
        latencyMs: args.latencyMs,
        delivery,
        deliveryAt: delivery ? now : undefined,
        createdAt: now,
      });
      await recordAgentReply(ctx, args.workspaceId, args.agentId, {
        at: now,
        text: args.replyText,
        latencyMs: args.latencyMs,
      });
      if (conversation) {
        const agent = args.agentId ? await ctx.db.get("agents", args.agentId) : null;
        await noteMessage(ctx, conversation, {
          from: "agent",
          sender: agent?.botName,
          preview: args.replyText,
          at: now,
          latencyMs: args.latencyMs,
          delivery,
        });
      }
    }

    return { success: true, replyMessageId };
  },
});

/**
 * Moves the conversation to another agent and leaves a trace of why.
 *
 * The conversation's `agentId` deliberately does not move: it is the channel's
 * entry point and the key the next inbound message is looked up by. Only
 * `activeAgentId` follows the handoff.
 */
export const recordHandoff = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    fromAgentId: v.id("agents"),
    toAgentId: v.id("agents"),
    fromBotName: v.string(),
    toBotName: v.string(),
    reason: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return { success: false };

    await ctx.db.patch(args.conversationId, {
      activeAgentId: args.toAgentId,
      handoffCount: (conversation.handoffCount ?? 0) + 1,
    });

    await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "system",
      kind: "handoff",
      agentId: args.toAgentId,
      text: `${args.fromBotName} → ${args.toBotName}: ${args.reason}`,
      toolName: "transfer_to_agent",
      toolInput: JSON.stringify({
        from: args.fromBotName,
        to: args.toBotName,
        reason: args.reason,
        summary: args.summary,
      }),
      toolOk: true,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Record a message the customer was shown that is not prose — buttons, a list,
 * media, a pin, a card.
 *
 * Written on every channel, WhatsApp included, where the same message also
 * goes out over the wire. The transcript, the web chat and the model's own
 * replayed history all read from this table, so a rich message that was only
 * sent would be invisible to all three: the team could not see what the
 * customer was shown, and the agent would offer the same menu again next turn.
 */
export const recordRichMessage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    agentId: v.optional(v.id("agents")),
    /** One line, for the transcript preview and for history replay. */
    summary: v.string(),
    payload: v.string(),
    whatsapp: v.optional(v.object({ wamid: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "assistant",
      kind: "rich",
      text: args.summary,
      payload: args.payload,
      agentId: args.agentId,
      createdAt: now,
    });
    const delivery = await noteSent(ctx, messageId, args.whatsapp);
    await recordAgentReply(ctx, args.workspaceId, args.agentId, { at: now });

    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) {
      const agent = args.agentId ? await ctx.db.get("agents", args.agentId) : null;
      await noteMessage(ctx, conversation, {
        from: "agent",
        sender: agent?.botName,
        preview: args.summary,
        at: now,
        delivery,
      });
    }
    return { success: true };
  },
});

/**
 * What answering a thread from outside a customer message needs: a form
 * submitted or an offer played on a link an agent sent.
 *
 * `agentId` is the entry agent, not whoever holds the thread, because it is
 * the key `startTurn` finds the conversation by — the engine then picks up the
 * active agent itself, exactly as for an inbound message.
 */
export const eventContext = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return null;
    const contact = await ctx.db.get("contacts", conversation.contactId);
    if (!contact) return null;
    return {
      workspaceId: conversation.workspaceId,
      agentId: conversation.agentId,
      channelType: conversation.channelType,
      channelId: conversation.channelId ?? null,
      externalId: contact.externalId,
      contactName: contact.name ?? null,
      contactPhone: contact.phone ?? null,
    };
  },
});

/**
 * Files something the customer did elsewhere as their turn, without an agent
 * answering it — the Magic apps' results when replying is switched off.
 *
 * Their own turn rather than a note because it is theirs, and because only
 * text rows reach the model: the agent has to see the answers next time they
 * write, or it will ask for them all over again.
 */
export const recordCustomerEvent = internalMutation({
  args: { conversationId: v.id("conversations"), text: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return { success: false };
    const now = Date.now();
    await ctx.db.insert("messages", {
      workspaceId: conversation.workspaceId,
      conversationId: conversation._id,
      role: "user",
      kind: "text",
      text: args.text,
      createdAt: now,
    });
    await noteMessage(
      ctx,
      conversation,
      { from: "customer", preview: args.text, at: now },
      conversation.marketingOnly ? { marketingOnly: undefined } : {}
    );
    return { success: true };
  },
});

export const markEscalated = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) await patchConversation(ctx, conversation, { status: "escalated" });
  },
});

export const saveContactDetail = internalMutation({
  args: {
    contactId: v.id("contacts"),
    field: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get("contacts", args.contactId);
    if (!contact) return { success: false };

    const field = args.field.trim().toLowerCase();
    const value = args.value.trim();
    if (!value) return { success: false };

    const known: Record<string, keyof Doc<"contacts">> = {
      name: "name",
      full_name: "name",
      phone: "phone",
      email: "email",
      company: "company",
      company_name: "company",
    };

    // A birthday the customer mentions is what the marketing desk wishes on,
    // so it goes to the indexed field rather than into free-form attributes.
    // One the parser cannot read falls through and is kept as an attribute,
    // so what they said is not lost.
    if (["birthday", "date_of_birth", "dob", "birth_date"].includes(field)) {
      const birthday = normaliseBirthday(value);
      if (birthday) {
        await ctx.db.patch(args.contactId, { birthday });
        return { success: true, stored: "birthday" };
      }
    }

    if (known[field]) {
      await ctx.db.patch(args.contactId, { [known[field]]: value });
      await refreshContactSearch(ctx, args.contactId);
      return { success: true, stored: known[field] };
    }

    const attributes = contact.attributes.filter((a) => a.key !== args.field);
    attributes.push({ key: args.field, value });
    await ctx.db.patch(args.contactId, { attributes: attributes.slice(-40) });
    return { success: true, stored: args.field };
  },
});

export const getContactInternal = internalQuery({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get("contacts", args.contactId);
  },
});

export const listContacts = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(args.limit ?? 100);
  },
});

export const updateContact = mutation({
  args: {
    contactId: v.id("contacts"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    attributes: v.optional(v.array(kvPair)),
  },
  handler: async (ctx, args) => {
    await requireContact(ctx, args.contactId);
    const { contactId, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(contactId, patch);
    await refreshContactSearch(ctx, contactId);
    return { success: true };
  },
});

export type ConversationId = Id<"conversations">;

const RECOUNT_BATCH = 100;

/**
 * Rebuilds every workspace's inbox counts from its conversations. Daily from
 * the cron, so a write that slipped past the helper cannot leave them wrong
 * for long. With `fields`, it also fills the inbox fields older rows lack.
 */
export const recountInbox = internalMutation({
  args: {
    fields: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: 20, cursor: args.cursor ?? null });
    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(0, internal.conversations.recountInboxForWorkspace, {
        workspaceId: workspace._id,
        fields: args.fields ?? false,
        cursor: null,
        totals: EMPTY_INBOX_COUNTS,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.conversations.recountInbox, {
        fields: args.fields,
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

const countsValidator = v.object({
  total: v.number(),
  open: v.number(),
  escalated: v.number(),
  closed: v.number(),
  unread: v.number(),
  escalatedUnread: v.number(),
  team: v.number(),
  bots: v.number(),
});

export const recountInboxForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    fields: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    totals: countsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .paginate({ numItems: RECOUNT_BATCH, cursor: args.cursor });

    const totals = { ...args.totals };
    for (const conversation of page.page) {
      const current = args.fields
        ? await fillInboxFields(ctx, conversation)
        : conversation;
      const counts = countsOf(current);
      for (const key of INBOX_COUNT_KEYS) totals[key] += counts[key];
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.conversations.recountInboxForWorkspace, {
        ...args,
        cursor: page.continueCursor,
        totals,
      });
      return;
    }

    const row = await ctx.db
      .query("inboxCounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (row) await ctx.db.patch(row._id, totals);
    else await ctx.db.insert("inboxCounts", { workspaceId: args.workspaceId, ...totals });
  },
});

async function fillInboxFields(
  ctx: MutationCtx,
  conversation: Doc<"conversations">
): Promise<Doc<"conversations">> {
  const tail = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
    .order("desc")
    .take(30);
  const spoken = tail.filter(
    (message) =>
      (message.kind === "text" || message.kind === "rich") &&
      (message.role === "user" || message.role === "assistant")
  );
  const last = spoken[0];
  let unreadCount = 0;
  for (const message of spoken) {
    if (message.role !== "user") break;
    unreadCount += 1;
  }

  let sender: string | undefined;
  let from: Doc<"conversations">["lastMessageFrom"];
  if (last?.role === "user") from = "customer";
  else if (last?.sentByHuman) {
    from = "team";
    const member = last.teamMemberId ? await ctx.db.get("teamMembers", last.teamMemberId) : null;
    sender = member?.name;
  } else if (last?.agentId) {
    from = "agent";
    sender = (await ctx.db.get("agents", last.agentId))?.botName;
  } else if (last) {
    from = "system";
  }

  const contact = await ctx.db.get("contacts", conversation.contactId);
  const filled = {
    lastMessageRole:
      conversation.lastMessageRole ?? (last ? (last.role === "user" ? "user" : "assistant") : undefined),
    lastMessageFrom: from,
    lastMessageSender: sender,
    unreadCount,
    activeAgentId: conversation.activeAgentId ?? conversation.agentId,
    searchText: searchTextFor(contact, conversation.lastMessagePreview),
  } as const;
  const changed = (Object.keys(filled) as (keyof typeof filled)[]).some(
    (key) => conversation[key] !== filled[key]
  );
  if (changed) await ctx.db.patch(conversation._id, filled);
  return { ...conversation, ...filled };
}
