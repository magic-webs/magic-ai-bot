import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { noteSendDelivery } from "./marketingStats";

export type Delivery = NonNullable<Doc<"messages">["delivery"]>;

const RANK: Record<Delivery, number> = {
  pending: 0,
  sent: 1,
  failed: 1,
  delivered: 2,
  read: 3,
};

/** Receipts arrive out of order, so a status only ever moves forward. */
export function advances(current: Delivery | undefined, next: Delivery): boolean {
  if (!current) return true;
  if (next === "failed") return current === "pending" || current === "sent";
  return RANK[next] > RANK[current];
}

export async function linkWamids(
  ctx: MutationCtx,
  message: Pick<Doc<"messages">, "_id" | "workspaceId" | "conversationId">,
  wamids: string[]
) {
  const now = Date.now();
  for (const wamid of wamids) {
    await ctx.db.insert("whatsappMessageIds", {
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      messageId: message._id,
      wamid,
      createdAt: now,
    });
  }
}

export async function setDelivery(
  ctx: MutationCtx,
  message: Doc<"messages">,
  delivery: Delivery,
  error?: string
) {
  if (!advances(message.delivery, delivery)) return;
  const now = Date.now();
  await ctx.db.patch(message._id, {
    delivery,
    deliveryAt: now,
    deliveryError: delivery === "failed" ? error : undefined,
  });
  const conversation = await ctx.db.get("conversations", message.conversationId);
  if (conversation && conversation.lastMessageAt === message.createdAt) {
    await ctx.db.patch(conversation._id, { lastMessageDelivery: delivery });
  }
  if (message.role === "assistant") {
    await noteSendDelivery(ctx, message._id, delivery, now, error);
  }
}

export async function deleteMessage(ctx: MutationCtx, message: Doc<"messages">) {
  if (message.delivery) {
    const links = await ctx.db
      .query("whatsappMessageIds")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .take(20);
    for (const link of links) await ctx.db.delete(link._id);
  }
  await ctx.db.delete(message._id);
}

/** For a message recorded after the provider already accepted it. */
export async function noteSent(
  ctx: MutationCtx,
  messageId: Doc<"messages">["_id"],
  whatsapp: { wamid?: string } | undefined
): Promise<Delivery | undefined> {
  if (!whatsapp) return undefined;
  const message = await ctx.db.get("messages", messageId);
  if (!message) return undefined;
  await ctx.db.patch(messageId, { delivery: "sent", deliveryAt: Date.now() });
  if (whatsapp.wamid) await linkWamids(ctx, message, [whatsapp.wamid]);
  return "sent";
}
