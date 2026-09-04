import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { kvPair } from "./schema";
import { slugify, randomKey } from "./lib/shared";
import {
  requireAdmin,
  requireWorkspace,
} from "./lib/auth";

const workspaceFields = {
  name: v.string(),
  ownerName: v.optional(v.string()),
  tagline: v.optional(v.string()),
  description: v.optional(v.string()),
  industry: v.optional(v.string()),
  website: v.optional(v.string()),
  supportEmail: v.optional(v.string()),
  supportPhone: v.optional(v.string()),
  address: v.optional(v.string()),
  locale: v.optional(v.string()),
  timezone: v.optional(v.string()),
  currency: v.optional(v.string()),
  theme: v.optional(v.string()),
  webhookUrl: v.optional(v.string()),
  facts: v.optional(v.array(kvPair)),
};

async function uniqueSlug(ctx: MutationCtx, desired: string): Promise<string> {
  const base = slugify(desired) || `workspace-${randomKey(6)}`;
  let candidate = base;
  for (let attempt = 0; attempt < 20; attempt++) {
    const clash = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    if (!clash) return candidate;
    candidate = `${base}-${attempt + 2}`;
  }
  return `${base}-${randomKey(6)}`;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("workspaces").order("desc").collect();
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!workspace) return null;
    // Resolve first, then check — a company must not be able to probe for
    // other workspaces by slug.
    await requireWorkspace(ctx, workspace._id);
    return workspace;
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db.get("workspaces", args.workspaceId);
  },
});

// Counts for the workspace overview cards.
export const summary = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const ws = args.workspaceId;
    const [agents, sources, channels, products, orders, conversations, tools, contacts] =
      await Promise.all([
        ctx.db.query("agents").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("knowledgeSources").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("channels").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("products").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("orders").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("conversations").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("tools").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
        ctx.db.query("contacts").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect(),
      ]);

    return {
      agents: agents.length,
      activeAgents: agents.filter((a) => a.status === "active").length,
      knowledgeSources: sources.length,
      knowledgeChunks: sources.reduce((sum, s) => sum + s.chunkCount, 0),
      channels: channels.length,
      liveChannels: channels.filter((c) => c.status === "active").length,
      products: products.filter((p) => p.status === "active").length,
      orders: orders.length,
      newOrders: orders.filter((o) => o.status === "new").length,
      conversations: conversations.length,
      escalated: conversations.filter((c) => c.status === "escalated").length,
      tools: tools.length,
      enabledTools: tools.filter((t) => t.status === "enabled").length,
      contacts: contacts.length,
    };
  },
});

export const create = mutation({
  args: workspaceFields,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const slug = await uniqueSlug(ctx, args.name);
    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name.trim(),
      slug,
      ownerName: args.ownerName?.trim() || undefined,
      tagline: args.tagline,
      description: args.description,
      industry: args.industry,
      website: args.website,
      supportEmail: args.supportEmail,
      supportPhone: args.supportPhone,
      address: args.address,
      locale: args.locale ?? "en-GB",
      timezone: args.timezone ?? "Europe/London",
      currency: args.currency ?? "GBP",
      theme: args.theme,
      webhookUrl: args.webhookUrl,
      webhookSecret: randomKey(32),
      facts: args.facts ?? [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { workspaceId, slug };
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    ...workspaceFields,
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const { workspaceId, ...rest } = args;
    const existing = await ctx.db.get("workspaces", workspaceId);
    if (!existing) throw new Error("Workspace not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    // An omitted field means "leave it alone", so there is no way to clear one
    // by omission. `theme: ""` is how the picker says "back to the default",
    // and that has to become an actual unset or the choice is one-way. The
    // owner's name is the same: clearing the box has to fall the greeting back
    // to the company name rather than store a blank.
    if (rest.theme === "") patch.theme = undefined;
    if (rest.ownerName !== undefined) {
      patch.ownerName = rest.ownerName.trim() || undefined;
    }
    await ctx.db.patch(workspaceId, patch);
    return { success: true };
  },
});

export const rotateWebhookSecret = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const secret = randomKey(32);
    await ctx.db.patch(args.workspaceId, {
      webhookSecret: secret,
      updatedAt: Date.now(),
    });
    return { secret };
  },
});

export const setStatus = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.union(v.literal("active"), v.literal("archived")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.workspaceId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Hard delete, cascading through every table that references the workspace.
export const remove = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id)
        )
        .collect();
      for (const message of messages) await ctx.db.delete(message._id);
      await ctx.db.delete(conversation._id);
    }

    const sources = await ctx.db
      .query("knowledgeSources")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const source of sources) {
      const chunks = await ctx.db
        .query("knowledgeChunks")
        .withIndex("by_source", (q) => q.eq("sourceId", source._id))
        .collect();
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      if (source.storageId) await ctx.storage.delete(source.storageId);
      await ctx.db.delete(source._id);
    }

    // Uploaded product images live in storage, not in the row, so the bulk
    // table sweep below would leave the files behind.
    const products = await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const product of products) {
      for (const image of product.images ?? []) {
        if (!image.storageId) continue;
        await ctx.storage.delete(image.storageId).catch(() => undefined);
      }
    }

    const tables = [
      "agents",
      "channels",
      "products",
      "orders",
      "tools",
      "contacts",
      "webhookEvents",
    ] as const;

    for (const table of tables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }

    await ctx.db.delete(args.workspaceId);
    return { success: true };
  },
});

export const getInternal = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db.get("workspaces", args.workspaceId);
  },
});

// Convenience for the "start from a template" flow on the empty dashboard.
export const seedDemo = mutation({
  args: {},
  handler: async (ctx): Promise<{ workspaceId: Id<"workspaces">; slug: string }> => {
    await requireAdmin(ctx);
    const now = Date.now();
    const slug = await uniqueSlug(ctx, "Northwind Print Co");
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Northwind Print Co",
      slug,
      tagline: "Commercial print, packaging and merchandise",
      description:
        "Northwind Print Co is a commercial printer supplying business stationery, marketing print, packaging and branded merchandise to UK businesses. Quotes are prepared by the sales team; the bot never quotes prices itself.",
      industry: "Commercial printing",
      website: "https://example.com",
      supportEmail: "hello@example.com",
      locale: "en-GB",
      timezone: "Europe/London",
      currency: "GBP",
      facts: [
        { key: "Founded", value: "1982" },
        { key: "Delivery", value: "UK mainland only, 3–7 working days" },
        { key: "Minimum order", value: "£75 excluding VAT" },
      ],
      webhookSecret: randomKey(32),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { workspaceId, slug };
  },
});
