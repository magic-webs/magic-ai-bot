import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair } from "./schema";
import { historyText, type Outbound } from "./lib/whatsappSend";
import {
  WHATSAPP_FREE_FORM_WINDOW_HOURS,
  WHATSAPP_TEXT_LIMIT,
} from "./lib/shared";
import {
  requireAgent,
  requireContact,
  requireConversation,
  requireWorkspace,
} from "./lib/auth";

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = args.agentId
      ? await ctx.db
          .query("conversations")
          .withIndex("by_agent", (q) => q.eq("agentId", args.agentId!))
          .order("desc")
          .take(args.limit ?? 60)
      : await ctx.db
          .query("conversations")
          .withIndex("by_workspace", (q) =>
            q.eq("workspaceId", args.workspaceId)
          )
          .order("desc")
          .take(args.limit ?? 60);

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const agentNames = new Map(agents.map((a) => [a._id, a.botName]));

    const out = [];
    for (const row of rows) {
      const contact = await ctx.db.get("contacts", row.contactId);
      const holderId = row.activeAgentId ?? row.agentId;
      out.push({
        ...row,
        agentName: agentNames.get(row.agentId) ?? "—",
        // Who answered last. Differs from agentName once the front desk has
        // routed the conversation on.
        activeAgentName: agentNames.get(holderId) ?? "—",
        handedOff: holderId !== row.agentId,
        contactLabel:
          contact?.name ?? contact?.phone ?? contact?.externalId ?? "Unknown",
        contactExternalId: contact?.externalId,
      });
    }
    return out;
  },
});

export const listMessages = query({
  args: {
    conversationId: v.optional(v.id("conversations")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.conversationId) return [];
    await requireConversation(ctx, args.conversationId);
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
    await requireConversation(ctx, args.conversationId);
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return null;
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

    return { conversation, contact, agent, lastInboundAt, freeFormWindowClosed };
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
    for (const message of messages) await ctx.db.delete(message._id);

    await ctx.db.patch(args.conversationId, {
      messageCount: 0,
      status: "open",
      lastMessagePreview: undefined,
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
    await requireConversation(ctx, args.conversationId);
    await ctx.db.patch(args.conversationId, { status: args.status });
    return { success: true };
  },
});

export const remove = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.conversationId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
    for (const message of messages) await ctx.db.delete(message._id);
    await ctx.db.delete(args.conversationId);
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
    await requireConversation(ctx, args.conversationId);
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return null;
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "assistant",
      kind: "text",
      text: args.text,
      agentId: args.agentId,
      sentByHuman: true,
      createdAt: now,
    });

    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) {
      await ctx.db.patch(args.conversationId, {
        messageCount: conversation.messageCount + 1,
        lastMessageAt: now,
        lastMessagePreview: args.text.slice(0, 140),
        // Replying by hand is the takeover. Anything else would have the agent
        // answer the customer's next message over the top of a colleague who
        // is mid-conversation with them.
        humanHandling: true,
      });
    }
    return { success: true };
  },
});

/** Hands the thread back to the agent, or takes it over without replying. */
export const setHumanHandling = mutation({
  args: {
    conversationId: v.id("conversations"),
    handling: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.conversationId);
    await ctx.db.patch(args.conversationId, { humanHandling: args.handling });
    return { success: true };
  },
});

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
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const body = args.text.trim().slice(0, WHATSAPP_TEXT_LIMIT);
    if (!body) return { ok: false, error: "Type a message first." };

    const context = await ctx.runQuery(internal.conversations.manualSendContext, {
      conversationId: args.conversationId,
    });
    if (!context) return { ok: false, error: "This conversation no longer exists." };

    if (context.channelType === "whatsapp") {
      if (!context.channelId || !context.externalId) {
        return {
          ok: false,
          error:
            "This thread has no WhatsApp channel attached, so there is nowhere to send it.",
        };
      }
      const sent: { ok: boolean; error?: string } = await ctx.runAction(
        internal.whatsapp.sendOutbound,
        {
          channelId: context.channelId,
          to: context.externalId,
          message: { kind: "text", body },
        }
      );
      if (!sent.ok) {
        return {
          ok: false,
          error: sent.error ?? "WhatsApp rejected the message.",
        };
      }
    }
    // On the web widget there is nothing to post to: recording the message is
    // the delivery, and the visitor's open subscription renders it. Same
    // reasoning as the follow-up desk in convex/followUp.ts.

    await ctx.runMutation(internal.conversations.recordManualReply, {
      workspaceId: context.workspaceId,
      conversationId: args.conversationId,
      agentId: context.agentId,
      text: body,
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
      const conversationId = await ctx.db.insert("conversations", {
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
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
      });
      conversation = (await ctx.db.get("conversations", conversationId))!;
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

    await ctx.db.patch(conversation._id, {
      messageCount: conversation.messageCount + 1,
      lastMessageAt: now,
      lastMessagePreview: args.text.slice(0, 140),
      channelId: conversation.channelId ?? args.channelId,
    });

    return {
      contactId: contact._id,
      conversationId: conversation._id,
      // Whoever the last handoff left in charge. The engine runs this agent,
      // not necessarily the one the channel points at.
      activeAgentId: conversation.activeAgentId ?? conversation.agentId,
      // Set when a colleague has taken the thread over. The inbound message
      // above is still recorded; the engine reads this and does not answer.
      humanHandling: conversation.humanHandling ?? false,
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

    if (args.replyText) {
      await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        role: "assistant",
        kind: "text",
        text: args.replyText,
        agentId: args.agentId,
        latencyMs: args.latencyMs,
        createdAt: now,
      });

      const conversation = await ctx.db.get(
        "conversations",
        args.conversationId
      );
      if (conversation) {
        await ctx.db.patch(args.conversationId, {
          messageCount: conversation.messageCount + 1,
          lastMessageAt: now,
          lastMessagePreview: args.replyText.slice(0, 140),
        });
      }
    }

    return { success: true };
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "assistant",
      kind: "rich",
      text: args.summary,
      payload: args.payload,
      agentId: args.agentId,
      createdAt: now,
    });

    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) {
      await ctx.db.patch(args.conversationId, {
        messageCount: conversation.messageCount + 1,
        lastMessageAt: now,
        lastMessagePreview: args.summary.slice(0, 140),
      });
    }
    return { success: true };
  },
});

export const markEscalated = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "escalated" });
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

    if (known[field]) {
      await ctx.db.patch(args.contactId, { [known[field]]: value });
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
    return { success: true };
  },
});

export type ConversationId = Id<"conversations">;
