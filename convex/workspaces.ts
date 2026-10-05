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
  requireStaff,
  requireWorkspace,
} from "./lib/auth";
import { logoSrcFor } from "./lib/branding";
import { ensureOrdersBook, orderRecords, statusForStage } from "./lib/ordersBook";
import {
  isValidCurrency,
  isValidLocale,
  isValidTimezone,
} from "./lib/regional";
import { deleteMessage } from "./lib/delivery";

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
  maxMessagesPerConversation: v.optional(v.number()),
  facts: v.optional(v.array(kvPair)),
};

/**
 * Tidies and checks the three regional fields, leaving absent ones absent.
 *
 * Checked here rather than trusted to the pickers because the MCP connector
 * writes these too, and a bad value fails quietly far from where it was
 * typed: an unknown timezone sends every scheduled greeting at UTC, and an
 * unknown currency code throws the first time a price is formatted.
 */
function regional(args: {
  locale?: string;
  timezone?: string;
  currency?: string;
}): { locale?: string; timezone?: string; currency?: string } {
  const locale = args.locale?.trim();
  const timezone = args.timezone?.trim();
  const currency = args.currency?.trim().toUpperCase();
  if (locale !== undefined && !isValidLocale(locale)) {
    throw new Error(`"${locale}" is not a locale — try one like en-GB or sw-TZ.`);
  }
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    throw new Error(
      `"${timezone}" is not a timezone — try one like Africa/Dar_es_Salaam.`
    );
  }
  if (currency !== undefined && !isValidCurrency(currency)) {
    throw new Error(`"${currency}" is not a currency code — try one like TZS.`);
  }
  return { locale, timezone, currency };
}

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
    const principal = await requireStaff(ctx);
    const all = await ctx.db.query("workspaces").order("desc").collect();
    const allowed = principal.workspaceIds;
    const workspaces = allowed
      ? all.filter((workspace) => allowed.includes(workspace._id))
      : all;
    return await Promise.all(
      workspaces.map(async (workspace) => ({
        ...workspace,
        logoSrc: await logoSrcFor(ctx, workspace),
      }))
    );
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
    // The logo resolved alongside, so every page under the workspace can draw
    // it from context without a query of its own.
    return { ...workspace, logoSrc: await logoSrcFor(ctx, workspace) };
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
        // The Orders record book — see convex/lib/ordersBook.ts.
        orderRecords(ctx, ws, 5000),
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
      newOrders: orders.filter((o) => statusForStage(o.stage) === "new").length,
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
    const checked = regional(args);
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
      locale: checked.locale || "en-GB",
      timezone: checked.timezone || "Europe/London",
      currency: checked.currency || "GBP",
      theme: args.theme,
      webhookUrl: args.webhookUrl,
      webhookSecret: randomKey(32),
      facts: args.facts ?? [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    // Every workspace keeps its orders in a record book of its own.
    await ensureOrdersBook(ctx, workspaceId);
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

    // Only what changed is checked. The company page sends every field on
    // every save, and a workspace set up with a hand-typed "en_GB" must still
    // be able to save its tagline — the picker shows the old value, and the
    // check applies the moment someone picks a new one.
    const changed = (key: "locale" | "timezone" | "currency") =>
      rest[key] !== undefined && rest[key] !== existing[key]
        ? rest[key]
        : undefined;
    const checked = regional({
      locale: changed("locale"),
      timezone: changed("timezone"),
      currency: changed("currency"),
    });

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && !(key in checked)) patch[key] = value;
    }
    for (const [key, value] of Object.entries(checked)) {
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
    if (rest.maxMessagesPerConversation !== undefined) {
      const limit = rest.maxMessagesPerConversation;
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error("The message limit must be a whole number, or 0 for no limit");
      }
      patch.maxMessagesPerConversation = limit;
    }
    await ctx.db.patch(workspaceId, patch);
    return { success: true };
  },
});

export const generateLogoUploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Set the company logo — an uploaded file, or a link to one hosted elsewhere.
 *
 * Exactly one of the two. The previous upload is deleted when it is replaced
 * or the logo moves to a link, so re-uploading a logo does not leave the old
 * file in storage forever.
 */
export const setLogo = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const url = args.url?.trim() || undefined;
    if (!args.storageId && !url) throw new Error("Upload a logo or paste a link.");
    if (!args.storageId && url && !/^https:\/\//i.test(url)) {
      // The web chat embeds on customers' https sites, where an http image is
      // blocked as mixed content — so a link that would not show is refused.
      throw new Error("The logo link has to start with https://.");
    }

    if (
      workspace.logoStorageId &&
      workspace.logoStorageId !== args.storageId
    ) {
      await ctx.storage.delete(workspace.logoStorageId).catch(() => undefined);
    }
    await ctx.db.patch("workspaces", args.workspaceId, {
      logoStorageId: args.storageId,
      logoUrl: args.storageId ? undefined : url,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

/** Back to the Magic Agent mark. */
export const clearLogo = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.logoStorageId) {
      await ctx.storage.delete(workspace.logoStorageId).catch(() => undefined);
    }
    await ctx.db.patch("workspaces", args.workspaceId, {
      logoStorageId: undefined,
      logoUrl: undefined,
      updatedAt: Date.now(),
    });
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
      for (const message of messages) await deleteMessage(ctx, message);
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
      "agentStats",
      "channels",
      "products",
      "orders",
      "tools",
      "contacts",
      "webhookEvents",
      "pushInbox",
    ] as const;

    for (const table of tables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }

    const counts = await ctx.db
      .query("inboxCounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (counts) await ctx.db.delete(counts._id);

    const days = await ctx.db
      .query("dailyStats")
      .withIndex("by_workspace_day", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const row of days) await ctx.db.delete(row._id);

    // The account's own rate card goes; its billing ledger stays. What a
    // company was charged is a record the platform still has to answer for
    // after the company is gone — the admin billing page reports it as a
    // deleted workspace, the way the usage page does for model spend.
    const rateCard = await ctx.db
      .query("billingRates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    if (rateCard) await ctx.db.delete(rateCard._id);

    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace?.logoStorageId) {
      await ctx.storage.delete(workspace.logoStorageId).catch(() => undefined);
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
    // Every workspace keeps its orders in a record book of its own.
    await ensureOrdersBook(ctx, workspaceId);
    return { workspaceId, slug };
  },
});
