import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair, requirementField } from "./schema";
import { slugify, buildSearchBlob, randomKey } from "./lib/shared";
import {
  requireProduct,
  requireWorkspace,
} from "./lib/auth";

const productInput = {
  sku: v.optional(v.string()),
  name: v.string(),
  category: v.optional(v.string()),
  description: v.optional(v.string()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  unit: v.optional(v.string()),
  requirementFields: v.optional(v.array(requirementField)),
  attributes: v.optional(v.array(kvPair)),
  exampleSpec: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
};

function blobFor(p: {
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  sku?: string;
}): string {
  return buildSearchBlob([
    p.name,
    p.category,
    p.description,
    p.sku,
    ...(p.tags ?? []),
  ]);
}

async function uniqueProductSlug(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  desired: string
): Promise<string> {
  const base = slugify(desired) || `product-${randomKey(6)}`;
  let candidate = base;
  for (let attempt = 0; attempt < 20; attempt++) {
    const clash = await ctx.db
      .query("products")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", workspaceId).eq("slug", candidate)
      )
      .unique();
    if (!clash) return candidate;
    candidate = `${base}-${attempt + 2}`;
  }
  return `${base}-${randomKey(6)}`;
}

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    search: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const term = args.search?.trim();
    if (term) {
      return await ctx.db
        .query("products")
        .withSearchIndex("search_products", (q) =>
          q
            .search("searchBlob", term.toLowerCase())
            .eq("workspaceId", args.workspaceId)
        )
        .take(100);
    }

    if (args.category) {
      return await ctx.db
        .query("products")
        .withIndex("by_workspace_category", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("category", args.category!)
        )
        .order("desc")
        .take(200);
    }

    return await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);
  },
});

export const categories = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const products = await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  },
});

export const get = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireProduct(ctx, args.productId);
    return await ctx.db.get("products", args.productId);
  },
});

export const create = mutation({
  args: { workspaceId: v.id("workspaces"), ...productInput },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const now = Date.now();
    const slug = await uniqueProductSlug(ctx, args.workspaceId, args.name);
    return await ctx.db.insert("products", {
      workspaceId: args.workspaceId,
      slug,
      sku: args.sku,
      name: args.name.trim(),
      category: args.category?.trim() || "General",
      description: args.description?.trim() || "",
      price: args.price,
      currency: args.currency,
      unit: args.unit,
      requirementFields: args.requirementFields ?? [],
      attributes: args.attributes ?? [],
      exampleSpec: args.exampleSpec,
      notes: args.notes,
      tags: args.tags ?? [],
      searchBlob: blobFor(args),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    productId: v.id("products"),
    ...productInput,
    name: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    await requireProduct(ctx, args.productId);
    const { productId, ...rest } = args;
    const existing = await ctx.db.get("products", productId);
    if (!existing) throw new Error("Product not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    patch.searchBlob = blobFor({
      name: (patch.name as string) ?? existing.name,
      category: (patch.category as string) ?? existing.category,
      description: (patch.description as string) ?? existing.description,
      sku: (patch.sku as string) ?? existing.sku,
      tags: (patch.tags as string[]) ?? existing.tags,
    });

    await ctx.db.patch(productId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireProduct(ctx, args.productId);
    await ctx.db.delete(args.productId);
    return { success: true };
  },
});

// Paste-a-JSON-array import. Keeps catalogue onboarding to one step.
export const bulkImport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    products: v.array(
      v.object({
        name: v.string(),
        sku: v.optional(v.string()),
        category: v.optional(v.string()),
        description: v.optional(v.string()),
        price: v.optional(v.number()),
        currency: v.optional(v.string()),
        unit: v.optional(v.string()),
        requirementFields: v.optional(v.array(requirementField)),
        attributes: v.optional(v.array(kvPair)),
        exampleSpec: v.optional(v.string()),
        notes: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    let created = 0;
    let updated = 0;
    const now = Date.now();

    for (const input of args.products) {
      if (!input.name?.trim()) continue;
      const slug = slugify(input.name);
      const existing = await ctx.db
        .query("products")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", slug)
        )
        .unique();

      const shared = {
        sku: input.sku,
        name: input.name.trim(),
        category: input.category?.trim() || "General",
        description: input.description?.trim() || "",
        price: input.price,
        currency: input.currency,
        unit: input.unit,
        requirementFields: input.requirementFields ?? [],
        attributes: input.attributes ?? [],
        exampleSpec: input.exampleSpec,
        notes: input.notes,
        tags: input.tags ?? [],
        searchBlob: blobFor(input),
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, shared);
        updated++;
      } else {
        await ctx.db.insert("products", {
          workspaceId: args.workspaceId,
          slug: slug || `product-${randomKey(6)}`,
          status: "active",
          createdAt: now,
          ...shared,
        });
        created++;
      }
    }

    return { created, updated };
  },
});

// ---------------------------------------------------------------------------
// Internal — backing the search_products / get_product_requirements tools
// ---------------------------------------------------------------------------

function toToolShape(product: Doc<"products">) {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    description: product.description,
    price: product.price ?? null,
    currency: product.currency ?? null,
    unit: product.unit ?? null,
    tags: product.tags,
    attributes: product.attributes,
    exampleSpec: product.exampleSpec ?? null,
    notes: product.notes ?? null,
    requiredFields: product.requirementFields
      .filter((f) => f.required)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        example: f.example ?? null,
      })),
    optionalFields: product.requirementFields
      .filter((f) => !f.required)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        example: f.example ?? null,
      })),
  };
}

async function runSearch(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  term: string | undefined,
  limit: number
): Promise<Doc<"products">[]> {
  const cleaned = term?.trim().toLowerCase();
  if (!cleaned) {
    return await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(limit);
  }

  const hits = await ctx.db
    .query("products")
    .withSearchIndex("search_products", (q) =>
      q
        .search("searchBlob", cleaned)
        .eq("workspaceId", workspaceId)
        .eq("status", "active")
    )
    .take(limit);

  if (hits.length > 0) return hits;

  // Search index needs whole-word matches; fall back to substring for
  // partial product names the customer typed loosely.
  const all = await ctx.db
    .query("products")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return all
    .filter(
      (p) => p.status === "active" && p.searchBlob.includes(cleaned)
    )
    .slice(0, limit);
}

export const searchForTool = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const products = await runSearch(
      ctx,
      args.workspaceId,
      args.query,
      args.limit ?? 8
    );
    return products.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
      price: p.price ?? null,
      currency: p.currency ?? null,
      unit: p.unit ?? null,
      requiredFieldCount: p.requirementFields.filter((f) => f.required).length,
    }));
  },
});

export const requirementsForTool = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    product: v.string(),
  },
  handler: async (ctx, args) => {
    const matches = await runSearch(ctx, args.workspaceId, args.product, 3);
    if (matches.length === 0) {
      const all = await ctx.db
        .query("products")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .take(30);
      return {
        found: false,
        product: null,
        availableProducts: all.map((p) => p.name),
      };
    }
    return {
      found: true,
      product: toToolShape(matches[0]),
      alternatives: matches.slice(1).map((p) => p.name),
    };
  },
});
