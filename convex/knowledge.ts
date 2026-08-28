import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  requireKnowledgeSource,
  requireSignedIn,
  requireWorkspace,
} from "./lib/auth";

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const sources = await ctx.db
      .query("knowledgeSources")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const agentNames = new Map(agents.map((a) => [a._id, a.name]));

    return sources.map((source) => ({
      ...source,
      // Keep list payloads small — the full text can be megabytes
      rawText: undefined,
      preview: source.rawText?.slice(0, 240),
      agentName: source.agentId ? agentNames.get(source.agentId) : undefined,
    }));
  },
});

export const get = query({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    await requireKnowledgeSource(ctx, args.sourceId);
    const source = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!source) return null;
    const chunks = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    return {
      source,
      chunks: chunks
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ _id: c._id, order: c.order, text: c.text })),
    };
  },
});

function scopeKeyFor(workspaceId: string, agentId: string | undefined): string {
  return `${workspaceId}|${agentId ?? "*"}`;
}

export const addSource = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    title: v.string(),
    kind: v.union(
      v.literal("text"),
      v.literal("faq"),
      v.literal("url"),
      v.literal("file")
    ),
    rawText: v.optional(v.string()),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.kind === "url" && !args.url?.trim()) {
      throw new Error("A URL is required for url sources");
    }
    if ((args.kind === "text" || args.kind === "faq") && !args.rawText?.trim()) {
      throw new Error("Text content is required");
    }
    if (args.kind === "file" && !args.storageId) {
      throw new Error("Upload the file before creating a file source");
    }

    const now = Date.now();
    const sourceId = await ctx.db.insert("knowledgeSources", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      title: args.title.trim() || args.filename || args.url || "Untitled source",
      kind: args.kind,
      rawText: args.rawText,
      url: args.url,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      size: args.size,
      tags: args.tags ?? [],
      chunkCount: 0,
      charCount: args.rawText?.length ?? 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.ingest.processSource, { sourceId });
    return sourceId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const reprocess = mutation({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    await requireKnowledgeSource(ctx, args.sourceId);
    const existing = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!existing) throw new Error("Source not found");

    const chunks = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    for (const chunk of chunks) await ctx.db.delete(chunk._id);

    await ctx.db.patch(args.sourceId, {
      status: "pending",
      chunkCount: 0,
      failureReason: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.ingest.processSource, {
      sourceId: args.sourceId,
    });
    return { success: true };
  },
});

/**
 * Edit a source in place.
 *
 * Re-embedding is the expensive part, so it happens only when the text
 * actually changes: chunk vectors are built from the passage text alone, never
 * the title, and retrieval reads the title off the source at query time. A
 * rename is therefore pure metadata.
 */
export const updateSource = mutation({
  args: {
    sourceId: v.id("knowledgeSources"),
    title: v.optional(v.string()),
    rawText: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireKnowledgeSource(ctx, args.sourceId);
    const source = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!source) throw new Error("Source not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    let mustReindex = false;

    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("A title is required");
      patch.title = title;
    }

    if (args.tags !== undefined) {
      patch.tags = args.tags.map((tag) => tag.trim()).filter(Boolean);
    }

    if (args.rawText !== undefined) {
      if (source.kind !== "text" && source.kind !== "faq") {
        throw new Error(
          `The text of a ${source.kind} source comes from the ${source.kind} itself. Edit the ${source.kind}, then reprocess.`
        );
      }
      const rawText = args.rawText.trim();
      if (!rawText) throw new Error("Text content is required");
      if (rawText !== source.rawText) {
        patch.rawText = rawText;
        patch.charCount = rawText.length;
        mustReindex = true;
      }
    }

    if (args.url !== undefined) {
      if (source.kind !== "url") {
        throw new Error("Only a url source has a URL to change");
      }
      const url = args.url.trim();
      if (!url) throw new Error("A URL is required");
      if (url !== source.url) {
        patch.url = url;
        mustReindex = true;
      }
    }

    if (mustReindex) {
      // Old chunks are dropped before the new ones land, so a retrieval that
      // runs mid-edit can return nothing but never a mix of both versions.
      const chunks = await ctx.db
        .query("knowledgeChunks")
        .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
        .collect();
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      patch.status = "pending";
      patch.chunkCount = 0;
      patch.failureReason = undefined;
    }

    await ctx.db.patch(args.sourceId, patch);

    if (mustReindex) {
      await ctx.scheduler.runAfter(0, internal.ingest.processSource, {
        sourceId: args.sourceId,
      });
    }

    return { success: true, reindexing: mustReindex };
  },
});

export const remove = mutation({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    await requireKnowledgeSource(ctx, args.sourceId);
    const source = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!source) return { success: true };

    const chunks = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    if (source.storageId) await ctx.storage.delete(source.storageId);
    await ctx.db.delete(args.sourceId);
    return { success: true };
  },
});

export const setScope = mutation({
  args: {
    sourceId: v.id("knowledgeSources"),
    agentId: v.optional(v.id("agents")),
  },
  handler: async (ctx, args) => {
    await requireKnowledgeSource(ctx, args.sourceId);
    const source = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!source) throw new Error("Source not found");

    await ctx.db.patch(args.sourceId, {
      agentId: args.agentId,
      updatedAt: Date.now(),
    });

    // Chunks carry a denormalised scope key for vector filtering — keep it in sync.
    const chunks = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    const scopeKey = scopeKeyFor(source.workspaceId, args.agentId);
    for (const chunk of chunks) await ctx.db.patch(chunk._id, { scopeKey });

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Internal — used by the ingestion action
// ---------------------------------------------------------------------------

export const getSourceInternal = internalQuery({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    return await ctx.db.get("knowledgeSources", args.sourceId);
  },
});

export const markProcessing = internalMutation({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceId, {
      status: "processing",
      updatedAt: Date.now(),
    });
  },
});

export const saveChunks = internalMutation({
  args: {
    sourceId: v.id("knowledgeSources"),
    charCount: v.number(),
    chunks: v.array(
      v.object({
        text: v.string(),
        order: v.number(),
        embedding: v.array(v.float64()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!source) throw new Error("Source not found");

    const scopeKey = scopeKeyFor(source.workspaceId, source.agentId);
    for (const chunk of args.chunks) {
      await ctx.db.insert("knowledgeChunks", {
        workspaceId: source.workspaceId,
        sourceId: args.sourceId,
        sourceTitle: source.title,
        text: chunk.text,
        order: chunk.order,
        embedding: chunk.embedding,
        scopeKey,
      });
    }

    const existingCount = source.chunkCount;
    await ctx.db.patch(args.sourceId, {
      chunkCount: existingCount + args.chunks.length,
      charCount: args.charCount,
      updatedAt: Date.now(),
    });
  },
});

export const markReady = internalMutation({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceId, {
      status: "ready",
      failureReason: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: { sourceId: v.id("knowledgeSources"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceId, {
      status: "failed",
      failureReason: args.reason.slice(0, 1000),
      updatedAt: Date.now(),
    });
  },
});

// Hydrates vector-search hits. Vector search only returns ids and scores.
export const hydrateChunks = internalQuery({
  args: { chunkIds: v.array(v.id("knowledgeChunks")) },
  handler: async (ctx, args) => {
    const out: Array<{ text: string; sourceTitle: string }> = [];
    for (const id of args.chunkIds) {
      const chunk = await ctx.db.get("knowledgeChunks", id);
      if (chunk) out.push({ text: chunk.text, sourceTitle: chunk.sourceTitle });
    }
    return out;
  },
});
