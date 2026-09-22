/**
 * The AI model catalogue, as endpoints.
 *
 * Adding a model used to mean two edits and a deploy — a price in
 * convex/lib/pricing.ts and a label in CHAT_MODELS — which is why a model the
 * gateway shipped last week bills at zero until someone notices. These let an
 * administrator add or reprice one from /admin/models instead. The constants
 * stay as the floor; see convex/lib/modelCatalogue.ts for how the two layer.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireSignedIn } from "./lib/auth";
import {
  chatModelOptions,
  lookupPrice,
  mergedCatalogue,
} from "./lib/modelCatalogue";
import { costNanoUsd } from "./lib/pricing";

// A mutation may not rewrite an unbounded number of rows, and repricing is a
// correction rather than a migration. The page reports what is left so an
// operator can press it again.
const REPRICE_CAP = 2_000;

const kindValidator = v.union(v.literal("chat"), v.literal("embedding"));

/**
 * The gateway addresses models as `creator/model`, and `gatewayModelId`
 * qualifies a bare id to `openai/…`. So a bare id typed here would not be the
 * model that gets called — it would silently become an OpenAI one. Rejected
 * with the reason rather than accepted and mis-routed.
 */
function normaliseModelId(raw: string): string {
  const modelId = raw.trim();
  if (!modelId) throw new Error("A model id is required.");
  if (/\s/.test(modelId)) {
    throw new Error("A model id cannot contain spaces.");
  }
  const parts = modelId.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `"${modelId}" is not a gateway model id. Use the creator/model form, e.g. xiaomi/mimo-v2.6-flash — a bare id is sent to OpenAI.`
    );
  }
  return modelId;
}

/** USD per 1M tokens. Negative or non-finite would cost history nonsense. */
function price(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a number of USD per 1M tokens, 0 or more.`);
  }
  return value;
}

/**
 * Every model the platform knows about, with where each one came from.
 *
 * Admin-only: it is the price list, and it names models no workspace is
 * offered.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await mergedCatalogue(ctx);
  },
});

/**
 * What the agent model picker offers.
 *
 * Any signed-in principal, because the picker is on the workspace's own agent
 * screen. It carries labels and ids only — a company has no business reading
 * what the platform pays per token.
 */
export const catalogue = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    return await chatModelOptions(ctx);
  },
});

/**
 * Add a model, or change one that is already there.
 *
 * One endpoint rather than create/update because the model id is the identity:
 * an admin typing an id that already exists means "reprice that", not "make a
 * second row for it", and a unique index with a create-only mutation would
 * just turn that into an error to explain.
 */
export const upsert = mutation({
  args: {
    modelId: v.string(),
    label: v.string(),
    kind: kindValidator,
    inputPer1M: v.number(),
    outputPer1M: v.number(),
    enabled: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const modelId = normaliseModelId(args.modelId);
    const label = args.label.trim() || modelId;
    const inputPer1M = price(args.inputPer1M, "Input price");
    // An embedding model is only ever charged on input; storing an output
    // price for one would put a number in the table that can never be reached.
    const outputPer1M =
      args.kind === "embedding" ? 0 : price(args.outputPer1M, "Output price");
    const notes = args.notes?.trim() || undefined;
    const now = Date.now();

    const existing = await ctx.db
      .query("aiModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        label,
        kind: args.kind,
        inputPer1M,
        outputPer1M,
        enabled: args.enabled,
        notes,
        updatedAt: now,
      });
      return { modelId, created: false };
    }

    await ctx.db.insert("aiModels", {
      modelId,
      label,
      kind: args.kind,
      inputPer1M,
      outputPer1M,
      enabled: args.enabled,
      notes,
      createdAt: now,
      updatedAt: now,
    });
    return { modelId, created: true };
  },
});

/** Offer it in the picker, or stop offering it. Its price is untouched. */
export const setEnabled = mutation({
  args: { modelId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const modelId = args.modelId.trim();

    const existing = await ctx.db
      .query("aiModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: Date.now(),
      });
      return { modelId };
    }

    // Toggling a built-in writes the override that makes the toggle stick —
    // the constant cannot be edited from here, so the row becomes the answer.
    const catalogue = await mergedCatalogue(ctx);
    const entry = catalogue.find((row) => row.modelId === modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);

    const now = Date.now();
    await ctx.db.insert("aiModels", {
      modelId,
      label: entry.label,
      kind: entry.kind,
      inputPer1M: entry.inputPer1M,
      outputPer1M: entry.outputPer1M,
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    return { modelId };
  },
});

/**
 * Drop the row.
 *
 * For a custom model that removes it outright. For an override it restores the
 * shipped price and label, which is the only way back to them — hence "reset"
 * in the UI rather than "delete".
 */
export const remove = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("aiModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId.trim()))
      .unique();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

/**
 * Re-cost the usage rows that were recorded before a price existed.
 *
 * A usage row carries the cost that was worked out when it was written, so
 * adding a price today leaves yesterday's calls at zero and the dashboard
 * understating spend. This walks the rows flagged `priced: false`, costs each
 * one against the catalogue as it stands now, and leaves alone any model still
 * without a price.
 *
 * Only unpriced rows: a row that was costed correctly at the time is history,
 * and re-costing it against a price that has since moved would rewrite what
 * was actually charged.
 */
export const repriceUnpriced = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    // Newest first: the model that prompted this was almost certainly added
    // because it is running now, so the rows worth fixing are the recent ones.
    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(REPRICE_CAP);

    // One lookup per distinct model, not per row.
    const prices = new Map<string, Awaited<ReturnType<typeof lookupPrice>>>();
    let repriced = 0;
    let stillUnpriced = 0;
    let scanned = 0;

    for (const row of rows) {
      if (row.priced) continue;
      scanned += 1;

      if (!prices.has(row.model)) {
        prices.set(row.model, await lookupPrice(ctx, row.model));
      }
      const { costNanoUsd: cost, priced } = costNanoUsd(
        row.model,
        row.inputTokens,
        row.outputTokens,
        prices.get(row.model)
      );

      if (!priced) {
        stillUnpriced += 1;
        continue;
      }
      await ctx.db.patch(row._id, { costNanoUsd: cost, priced: true });
      repriced += 1;
    }

    return {
      repriced,
      stillUnpriced,
      scanned,
      // True when the cap was hit, so the page can say there may be more
      // rather than implying the job is finished.
      truncated: rows.length === REPRICE_CAP,
    };
  },
});
