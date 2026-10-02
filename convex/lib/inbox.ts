import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { countMessage } from "./dailyStats";

type Conversation = Doc<"conversations">;
type ConversationFields = WithoutSystemFields<Conversation>;
type Counted = Pick<
  Conversation,
  "status" | "lastMessageRole" | "humanHandling" | "markedBot"
>;

export const INBOX_COUNT_KEYS = [
  "total",
  "open",
  "escalated",
  "closed",
  "unread",
  "escalatedUnread",
  "team",
  "bots",
] as const;
type CountKey = (typeof INBOX_COUNT_KEYS)[number];
export type InboxCounts = Record<CountKey, number>;

export const EMPTY_INBOX_COUNTS: InboxCounts = {
  total: 0,
  open: 0,
  escalated: 0,
  closed: 0,
  unread: 0,
  escalatedUnread: 0,
  team: 0,
  bots: 0,
};

/** The customer had the last word, and nobody has filed the thread away. */
export function isAwaitingReply(conversation: Counted): boolean {
  return (
    conversation.lastMessageRole === "user" &&
    conversation.status !== "closed" &&
    !conversation.markedBot
  );
}

export function countsOf(conversation: Counted): InboxCounts {
  const unread = isAwaitingReply(conversation);
  return {
    total: 1,
    open: conversation.status === "open" ? 1 : 0,
    escalated: conversation.status === "escalated" ? 1 : 0,
    closed: conversation.status === "closed" ? 1 : 0,
    unread: unread ? 1 : 0,
    escalatedUnread: unread && conversation.status === "escalated" ? 1 : 0,
    team: conversation.humanHandling ? 1 : 0,
    bots: conversation.markedBot ? 1 : 0,
  };
}

async function shiftCounts(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  before: Counted | null,
  after: Counted | null
) {
  const from = before ? countsOf(before) : EMPTY_INBOX_COUNTS;
  const to = after ? countsOf(after) : EMPTY_INBOX_COUNTS;
  if (INBOX_COUNT_KEYS.every((key) => from[key] === to[key])) return;

  const row = await ctx.db
    .query("inboxCounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const next = { ...(row ?? EMPTY_INBOX_COUNTS) } as InboxCounts;
  for (const key of INBOX_COUNT_KEYS) {
    next[key] = Math.max(0, next[key] + to[key] - from[key]);
  }
  if (row) {
    await ctx.db.patch(row._id, pickCounts(next));
  } else {
    await ctx.db.insert("inboxCounts", { workspaceId, ...pickCounts(next) });
  }
}

export function pickCounts(source: InboxCounts): InboxCounts {
  const out = { ...EMPTY_INBOX_COUNTS };
  for (const key of INBOX_COUNT_KEYS) out[key] = source[key];
  return out;
}

export function searchTextFor(
  contact: Doc<"contacts"> | null,
  preview: string | undefined
): string {
  return [contact?.name, contact?.phone, contact?.externalId, contact?.email, preview]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);
}

export async function insertConversation(
  ctx: MutationCtx,
  fields: ConversationFields
): Promise<Id<"conversations">> {
  const contact = await ctx.db.get("contacts", fields.contactId);
  const row = {
    ...fields,
    searchText: fields.searchText ?? searchTextFor(contact, fields.lastMessagePreview),
  };
  const id = await ctx.db.insert("conversations", row);
  await shiftCounts(ctx, fields.workspaceId, null, row);
  return id;
}

/** Every change to a conversation's status, last speaker, takeover or bot flag goes through here. */
export async function patchConversation(
  ctx: MutationCtx,
  conversation: Conversation,
  patch: Partial<ConversationFields>
): Promise<Conversation> {
  await ctx.db.patch(conversation._id, patch);
  const after = { ...conversation, ...patch };
  await shiftCounts(ctx, conversation.workspaceId, conversation, after);
  return after;
}

export async function deleteConversation(
  ctx: MutationCtx,
  conversation: Conversation
) {
  await ctx.db.delete(conversation._id);
  await shiftCounts(ctx, conversation.workspaceId, conversation, null);
}

export type MessageFrom = NonNullable<Conversation["lastMessageFrom"]>;

/** Moves the thread's "last message" to one just written, and counts it. */
export async function noteMessage(
  ctx: MutationCtx,
  conversation: Conversation,
  message: {
    from: MessageFrom;
    sender?: string;
    preview: string;
    at: number;
    latencyMs?: number;
  },
  extra: Partial<ConversationFields> = {}
): Promise<Conversation> {
  await countMessage(ctx, conversation.workspaceId, message.at, message.latencyMs);
  const contact = await ctx.db.get("contacts", conversation.contactId);
  const preview = message.preview.slice(0, 140);
  const fromCustomer = message.from === "customer";
  return await patchConversation(ctx, conversation, {
    messageCount: conversation.messageCount + 1,
    lastMessageAt: message.at,
    lastMessagePreview: preview,
    lastMessageRole: fromCustomer ? "user" : "assistant",
    lastMessageFrom: message.from,
    lastMessageSender: message.sender,
    unreadCount: fromCustomer ? (conversation.unreadCount ?? 0) + 1 : 0,
    searchText: searchTextFor(contact, preview),
    ...extra,
  });
}

/** Re-derives the search text of a contact's threads after their name or number changes. */
export async function refreshContactSearch(
  ctx: MutationCtx,
  contactId: Id<"contacts">
) {
  const contact = await ctx.db.get("contacts", contactId);
  if (!contact) return;
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) => q.eq("contactId", contactId))
    .take(50);
  for (const row of rows) {
    const searchText = searchTextFor(contact, row.lastMessagePreview);
    if (searchText !== row.searchText) await ctx.db.patch(row._id, { searchText });
  }
}
