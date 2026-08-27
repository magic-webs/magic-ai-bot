import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { kvPair, orderStatus } from "./schema";
import { randomKey } from "./lib/shared";

function makeOrderNumber(workspaceName: string, at: number): string {
  const initials =
    workspaceName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 3)
      .toUpperCase() || "ORD";
  const d = new Date(at);
  const stamp = `${d.getUTCFullYear() % 100}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${initials}-${stamp}-${randomKey(4).toUpperCase()}`;
}

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(orderStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = args.status
      ? await ctx.db
          .query("orders")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("status", args.status!)
          )
          .order("desc")
          .take(args.limit ?? 100)
      : await ctx.db
          .query("orders")
          .withIndex("by_workspace", (q) =>
            q.eq("workspaceId", args.workspaceId)
          )
          .order("desc")
          .take(args.limit ?? 100);
    return rows;
  },
});

export const get = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get("orders", args.orderId);
    if (!order) return null;
    const agent = order.agentId
      ? await ctx.db.get("agents", order.agentId)
      : null;
    return { order, agentName: agent?.botName ?? null };
  },
});

export const updateStatus = mutation({
  args: { orderId: v.id("orders"), status: orderStatus },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.orderId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Internal — backing the create_order / lookup_orders tools
// ---------------------------------------------------------------------------

export const createFromTool = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    source: v.union(v.literal("whatsapp"), v.literal("web"), v.literal("api")),
    customer: v.object({
      name: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      company: v.optional(v.string()),
    }),
    items: v.array(
      v.object({
        productName: v.string(),
        quantity: v.string(),
        specs: v.array(kvPair),
      })
    ),
    delivery: v.optional(
      v.object({
        address: v.optional(v.string()),
        city: v.optional(v.string()),
        postcode: v.optional(v.string()),
        country: v.optional(v.string()),
        requiredDate: v.optional(v.string()),
      })
    ),
    notes: v.optional(v.string()),
    rawPayload: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const now = Date.now();
    const orderNumber = makeOrderNumber(workspace.name, now);

    // Link each line to a catalogue product where the name matches, and price
    // the order only from catalogue prices — never from anything the model said.
    const items = [];
    let total = 0;
    let priced = false;

    for (const item of args.items) {
      const matches = await ctx.db
        .query("products")
        .withSearchIndex("search_products", (q) =>
          q
            .search("searchBlob", item.productName.toLowerCase())
            .eq("workspaceId", args.workspaceId)
            .eq("status", "active")
        )
        .take(1);
      const product = matches[0];

      const numericQty = Number(item.quantity.replace(/[^0-9.]/g, ""));
      if (product?.price !== undefined && Number.isFinite(numericQty)) {
        total += product.price * (numericQty || 1);
        priced = true;
      }

      items.push({
        productId: product?._id,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: product?.price,
        specs: item.specs,
      });
    }

    const orderId = await ctx.db.insert("orders", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      orderNumber,
      customer: args.customer,
      items,
      delivery: args.delivery,
      notes: args.notes,
      total: priced ? Math.round(total * 100) / 100 : undefined,
      currency: priced ? workspace.currency : undefined,
      source: args.source,
      status: "new",
      rawPayload: args.rawPayload,
      createdAt: now,
      updatedAt: now,
    });

    return { orderId, orderNumber };
  },
});

export const listForContactInternal = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    contactId: v.optional(v.id("contacts")),
    orderNumber: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let rows;
    if (args.orderNumber?.trim()) {
      const wanted = args.orderNumber.trim().toUpperCase();
      const all = await ctx.db
        .query("orders")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(300);
      rows = all.filter((o) => o.orderNumber.toUpperCase() === wanted);
    } else if (args.contactId) {
      rows = await ctx.db
        .query("orders")
        .withIndex("by_contact", (q) => q.eq("contactId", args.contactId!))
        .order("desc")
        .take(args.limit ?? 10);
    } else {
      return [];
    }

    return rows.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      placedAt: new Date(o.createdAt).toISOString().slice(0, 10),
      items: o.items.map((i) => `${i.quantity} × ${i.productName}`),
      total: o.total ?? null,
      currency: o.currency ?? null,
      requiredDate: o.delivery?.requiredDate ?? null,
    }));
  },
});

export const getForWebhook = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    return await ctx.db.get("orders", args.orderId);
  },
});
