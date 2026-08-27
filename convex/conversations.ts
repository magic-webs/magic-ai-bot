import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair } from "./schema";

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
      out.push({
        ...row,
        agentName: agentNames.get(row.agentId) ?? "—",
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
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return null;
    const contact = await ctx.db.get("contacts", conversation.contactId);
    const agent = await ctx.db.get("agents", conversation.agentId);
    return { conversation, contact, agent };
  },
});

// ---------------------------------------------------------------------------
// Dashboard writes
// ---------------------------------------------------------------------------

export const reset = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
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
    await ctx.db.patch(args.conversationId, { status: args.status });
    return { success: true };
  },
});

export const remove = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
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
// Runtime internals
// ---------------------------------------------------------------------------

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
      .filter((m) => m.kind === "text" && (m.role === "user" || m.role === "assistant"))
      .reverse()
      .slice(-args.historyLimit)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.text ?? "",
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
