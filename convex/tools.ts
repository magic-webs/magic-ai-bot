import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { kvPair, toolParameter } from "./schema";


const httpConfig = v.object({
  method: v.union(
    v.literal("GET"),
    v.literal("POST"),
    v.literal("PUT"),
    v.literal("PATCH"),
    v.literal("DELETE")
  ),
  urlTemplate: v.string(),
  headers: v.array(kvPair),
  bodyTemplate: v.optional(v.string()),
  timeoutMs: v.optional(v.number()),
});

const dbQueryConfig = v.object({
  table: v.union(
    v.literal("products"),
    v.literal("orders"),
    v.literal("contacts")
  ),
  searchParam: v.optional(v.string()),
  limit: v.number(),
});

// snake_case, model-safe identifier. Underscores must survive, so this cannot
// go through slugify() — that strips them.
function toolName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return cleaned || "custom_tool";
}

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const agentNames = new Map(agents.map((a) => [a._id, a.name]));

    return tools.map((tool) => ({
      ...tool,
      agentName: tool.agentId ? agentNames.get(tool.agentId) : undefined,
    }));
  },
});

export const get = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    return await ctx.db.get("tools", args.toolId);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    name: v.string(),
    displayName: v.optional(v.string()),
    description: v.string(),
    whenToUse: v.optional(v.string()),
    kind: v.union(v.literal("http"), v.literal("db_query")),
    parameters: v.optional(v.array(toolParameter)),
    http: v.optional(httpConfig),
    dbQuery: v.optional(dbQueryConfig),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("enabled"), v.literal("disabled"))
    ),
    origin: v.optional(v.union(v.literal("manual"), v.literal("ai_drafted"))),
    sourceTask: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.kind === "http" && !args.http) {
      throw new Error("HTTP tools need a request configuration");
    }
    if (args.kind === "db_query" && !args.dbQuery) {
      throw new Error("Database tools need a table configuration");
    }

    const now = Date.now();
    let name = toolName(args.name);

    // Tool names are the model's handle for the tool — they must be unique.
    for (let attempt = 0; attempt < 20; attempt++) {
      const clash = await ctx.db
        .query("tools")
        .withIndex("by_workspace_name", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("name", name)
        )
        .unique();
      if (!clash) break;
      name = `${toolName(args.name)}_${attempt + 2}`;
    }

    return await ctx.db.insert("tools", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      name,
      displayName: args.displayName?.trim() || args.name.trim(),
      description: args.description.trim(),
      whenToUse: args.whenToUse?.trim() || undefined,
      kind: args.kind,
      parameters: args.parameters ?? [],
      http: args.http,
      dbQuery: args.dbQuery,
      status: args.status ?? "draft",
      origin: args.origin ?? "manual",
      sourceTask: args.sourceTask,
      callCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    agentId: v.optional(v.id("agents")),
    clearAgentScope: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    description: v.optional(v.string()),
    whenToUse: v.optional(v.string()),
    parameters: v.optional(v.array(toolParameter)),
    http: v.optional(httpConfig),
    dbQuery: v.optional(dbQueryConfig),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("enabled"), v.literal("disabled"))
    ),
  },
  handler: async (ctx, args) => {
    const { toolId, clearAgentScope, ...rest } = args;
    const existing = await ctx.db.get("tools", toolId);
    if (!existing) throw new Error("Tool not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    if (clearAgentScope) patch.agentId = undefined;

    await ctx.db.patch(toolId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.toolId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Internal — runtime resolution and call accounting
// ---------------------------------------------------------------------------

export const resolveForAgent = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return tools.filter(
      (tool) =>
        tool.status === "enabled" &&
        (tool.agentId === undefined || tool.agentId === args.agentId)
    );
  },
});

export const recordCall = internalMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const tool = await ctx.db.get("tools", args.toolId);
    if (!tool) return;
    await ctx.db.patch(args.toolId, {
      callCount: tool.callCount + 1,
      lastCalledAt: Date.now(),
    });
  },
});

// Used by the AI drafting action to persist what it designed.
export const insertDrafted = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    name: v.string(),
    displayName: v.string(),
    description: v.string(),
    whenToUse: v.optional(v.string()),
    kind: v.union(v.literal("http"), v.literal("db_query")),
    parameters: v.array(toolParameter),
    http: v.optional(httpConfig),
    dbQuery: v.optional(dbQueryConfig),
    sourceTask: v.string(),
    autoEnable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let name = toolName(args.name);
    for (let attempt = 0; attempt < 20; attempt++) {
      const clash = await ctx.db
        .query("tools")
        .withIndex("by_workspace_name", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("name", name)
        )
        .unique();
      if (!clash) break;
      name = `${toolName(args.name)}_${attempt + 2}`;
    }

    const toolId = await ctx.db.insert("tools", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      name,
      displayName: args.displayName,
      description: args.description,
      whenToUse: args.whenToUse,
      kind: args.kind,
      parameters: args.parameters,
      http: args.http,
      dbQuery: args.dbQuery,
      // Drafted tools stay out of the model's hands until a human enables them,
      // unless the caller explicitly opted in.
      status: args.autoEnable ? "enabled" : "draft",
      origin: "ai_drafted",
      sourceTask: args.sourceTask,
      callCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { toolId, name };
  },
});

// Read-only, workspace-scoped table access for db_query tools.
export const runDbQuery = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    table: v.union(
      v.literal("products"),
      v.literal("orders"),
      v.literal("contacts")
    ),
    search: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit, 1), 25);
    const term = args.search?.trim().toLowerCase();

    if (args.table === "products") {
      const rows = term
        ? await ctx.db
            .query("products")
            .withSearchIndex("search_products", (q) =>
              q
                .search("searchBlob", term)
                .eq("workspaceId", args.workspaceId)
                .eq("status", "active")
            )
            .take(limit)
        : await ctx.db
            .query("products")
            .withIndex("by_workspace", (q) =>
              q.eq("workspaceId", args.workspaceId)
            )
            .take(limit);
      return rows.map((r) => ({
        name: r.name,
        category: r.category,
        description: r.description,
        price: r.price ?? null,
        currency: r.currency ?? null,
        unit: r.unit ?? null,
        attributes: r.attributes,
      }));
    }

    if (args.table === "orders") {
      const rows = await ctx.db
        .query("orders")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(200);
      const filtered = term
        ? rows.filter((r) =>
            [
              r.orderNumber,
              r.customer.name,
              r.customer.company ?? "",
              r.customer.email ?? "",
              r.customer.phone ?? "",
              ...r.items.map((i) => i.productName),
            ]
              .join(" ")
              .toLowerCase()
              .includes(term)
          )
        : rows;
      return filtered.slice(0, limit).map((r) => ({
        orderNumber: r.orderNumber,
        status: r.status,
        customer: r.customer.name,
        company: r.customer.company ?? null,
        items: r.items.map((i) => `${i.quantity} × ${i.productName}`),
        specs: r.items.flatMap((i) =>
          i.specs.map((s) => `${s.key}: ${s.value}`)
        ),
        placedAt: new Date(r.createdAt).toISOString().slice(0, 10),
      }));
    }

    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);
    const filtered = term
      ? rows.filter((r) =>
          [r.name ?? "", r.phone ?? "", r.email ?? "", r.company ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(term)
        )
      : rows;
    return filtered.slice(0, limit).map((r) => ({
      name: r.name ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      company: r.company ?? null,
      attributes: r.attributes,
    }));
  },
});
