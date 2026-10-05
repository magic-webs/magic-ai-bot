import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { measureAudience, normaliseTag } from "./lib/audience";
import { audienceSelection } from "./schema/marketing";

const SIZE_SCAN_CAP = 5000;
const MAX_BULK = 500;

async function requireAudience(ctx: QueryCtx, audienceId: Id<"audiences">) {
  const audience = await ctx.db.get("audiences", audienceId);
  if (!audience) throw new Error("Audience not found");
  await requireWorkspace(ctx, audience.workspaceId);
  return audience;
}

function personOf(contact: Doc<"contacts">) {
  return {
    _id: contact._id,
    name: contact.name ?? null,
    phone: contact.externalId,
    email: contact.email ?? null,
    company: contact.company ?? null,
    birthday: contact.birthday ?? null,
    category: contact.category ?? null,
    tags: contact.tags ?? [],
    source: contact.source ?? null,
    optedOutAt: contact.optedOutAt ?? null,
    createdAt: contact.createdAt,
  };
}

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("audiences")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);
    return rows;
  },
});

export const tags = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(SIZE_SCAN_CAP);
    const counts = new Map<string, number>();
    const categories = new Map<string, number>();
    for (const contact of contacts) {
      if (contact.channelType !== "whatsapp") continue;
      for (const tag of contact.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      const category = contact.category ?? "";
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    return {
      tags: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([tag, count]) => ({ tag, count })),
      categories: Object.fromEntries(categories),
      capped: contacts.length >= SIZE_SCAN_CAP,
    };
  },
});

export const people = query({
  args: {
    workspaceId: v.id("workspaces"),
    audienceId: v.optional(v.id("audiences")),
    category: v.optional(v.string()),
    tag: v.optional(v.string()),
    subscription: v.optional(v.union(v.literal("subscribed"), v.literal("unsubscribed"))),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const needle = args.search?.trim().toLowerCase() ?? "";
    const keep = (contact: Doc<"contacts"> | null): contact is Doc<"contacts"> => {
      if (!contact || contact.workspaceId !== args.workspaceId) return false;
      if (contact.channelType !== "whatsapp") return false;
      if (args.category !== undefined && (contact.category ?? "") !== args.category) return false;
      if (args.tag && !(contact.tags ?? []).includes(args.tag)) return false;
      if (args.subscription === "subscribed" && contact.optedOutAt) return false;
      if (args.subscription === "unsubscribed" && !contact.optedOutAt) return false;
      if (
        needle &&
        ![contact.name, contact.externalId, contact.company, contact.email]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle))
      ) {
        return false;
      }
      return true;
    };

    if (args.audienceId) {
      const audienceId = args.audienceId;
      await requireAudience(ctx, audienceId);
      const page = await ctx.db
        .query("audienceMembers")
        .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", audienceId))
        .paginate(args.paginationOpts);
      const contacts = await Promise.all(
        page.page.map((member) => ctx.db.get("contacts", member.contactId))
      );
      return { ...page, page: contacts.filter(keep).map(personOf) };
    }

    const category = args.category;
    const page = category
      ? await ctx.db
          .query("contacts")
          .withIndex("by_workspace_and_category", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("category", category)
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("contacts")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
          .order("desc")
          .paginate(args.paginationOpts);
    return { ...page, page: page.page.filter(keep).map(personOf) };
  },
});

export const size = query({
  args: {
    workspaceId: v.id("workspaces"),
    audience: audienceSelection,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await measureAudience(ctx, args.workspaceId, args.audience, args.now);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    contactIds: v.optional(v.array(v.id("contacts"))),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new Error("Give the audience a name.");
    const now = Date.now();
    const audienceId = await ctx.db.insert("audiences", {
      workspaceId: args.workspaceId,
      name,
      description: args.description?.trim().slice(0, 200) || undefined,
      source: "manual",
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (args.contactIds?.length) {
      await addMembers(ctx, audienceId, args.workspaceId, args.contactIds.slice(0, MAX_BULK));
    }
    return audienceId;
  },
});

export const rename = mutation({
  args: {
    audienceId: v.id("audiences"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new Error("Give the audience a name.");
    await ctx.db.patch("audiences", audience._id, {
      name,
      description: args.description?.trim().slice(0, 200) || undefined,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: { audienceId: v.id("audiences") },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    await ctx.db.delete("audiences", audience._id);
    await ctx.scheduler.runAfter(0, internal.audience.purgeMembers, { audienceId: audience._id });
    return { success: true };
  },
});

export const purgeMembers = internalMutation({
  args: { audienceId: v.id("audiences") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", args.audienceId))
      .take(400);
    for (const row of rows) await ctx.db.delete("audienceMembers", row._id);
    if (rows.length === 400) {
      await ctx.scheduler.runAfter(0, internal.audience.purgeMembers, args);
    }
  },
});

async function addMembers(
  ctx: MutationCtx,
  audienceId: Id<"audiences">,
  workspaceId: Id<"workspaces">,
  contactIds: Id<"contacts">[]
) {
  const now = Date.now();
  let added = 0;
  for (const contactId of contactIds) {
    const contact = await ctx.db.get("contacts", contactId);
    if (!contact || contact.workspaceId !== workspaceId) continue;
    const existing = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audienceId_and_contactId", (q) =>
        q.eq("audienceId", audienceId).eq("contactId", contactId)
      )
      .unique();
    if (existing) continue;
    await ctx.db.insert("audienceMembers", { workspaceId, audienceId, contactId, addedAt: now });
    added++;
  }
  const audience = await ctx.db.get("audiences", audienceId);
  if (audience && added > 0) {
    await ctx.db.patch("audiences", audienceId, {
      memberCount: audience.memberCount + added,
      updatedAt: now,
    });
  }
  return added;
}

export const addPeople = mutation({
  args: { audienceId: v.id("audiences"), contactIds: v.array(v.id("contacts")) },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    if (args.contactIds.length > MAX_BULK) throw new Error(`Pick at most ${MAX_BULK} people.`);
    const added = await addMembers(ctx, audience._id, audience.workspaceId, args.contactIds);
    return { added };
  },
});

export const removePeople = mutation({
  args: { audienceId: v.id("audiences"), contactIds: v.array(v.id("contacts")) },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    if (args.contactIds.length > MAX_BULK) throw new Error(`Pick at most ${MAX_BULK} people.`);
    let removed = 0;
    for (const contactId of args.contactIds) {
      const row = await ctx.db
        .query("audienceMembers")
        .withIndex("by_audienceId_and_contactId", (q) =>
          q.eq("audienceId", audience._id).eq("contactId", contactId)
        )
        .unique();
      if (!row) continue;
      await ctx.db.delete("audienceMembers", row._id);
      removed++;
    }
    await ctx.db.patch("audiences", audience._id, {
      memberCount: Math.max(0, audience.memberCount - removed),
      updatedAt: Date.now(),
    });
    return { removed };
  },
});

export const updatePeople = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    contactIds: v.array(v.id("contacts")),
    category: v.optional(v.string()),
    addTags: v.optional(v.array(v.string())),
    removeTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.contactIds.length > MAX_BULK) throw new Error(`Pick at most ${MAX_BULK} people.`);
    const add = (args.addTags ?? []).map(normaliseTag).filter(Boolean);
    const drop = new Set((args.removeTags ?? []).map(normaliseTag));
    let updated = 0;
    for (const contactId of args.contactIds) {
      const contact = await ctx.db.get("contacts", contactId);
      if (!contact || contact.workspaceId !== args.workspaceId) continue;
      const tags = [...new Set([...(contact.tags ?? []), ...add])]
        .filter((tag) => !drop.has(tag))
        .slice(0, 30);
      await ctx.db.patch("contacts", contact._id, {
        tags,
        ...(args.category !== undefined ? { category: args.category || undefined } : {}),
      });
      updated++;
    }
    return { updated };
  },
});
