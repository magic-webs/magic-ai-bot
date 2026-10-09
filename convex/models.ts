/**
 * The AI model catalogue, as endpoints. The models themselves are fixed in
 * `MODELS`; these change how each one is labelled, priced and offered. See
 * convex/lib/modelCatalogue.ts for how the two layer.
 */

import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireSignedIn } from "./lib/auth";
import {
  chatModelOptions,
  lookupPrice,
  lookupPromptCaching,
  mergedCatalogue,
  modelRow,
} from "./lib/modelCatalogue";
import { MODEL_PRICES, costNanoUsd } from "./lib/pricing";
import { addToUsageDaily } from "./lib/usageDaily";
import {
  DEFAULT_CHAT_MODEL,
  builtinModel,
  supportsPromptCaching,
} from "./lib/shared";

// A mutation may not rewrite an unbounded number of rows, and repricing is a
// correction rather than a migration. The page reports what is left so an
// operator can press it again.
const REPRICE_CAP = 2_000;

// Agent rows carry whole prompts, so a page is kept well under what one
// mutation may read. The page calls again with the cursor until it is done.
const MOVE_BATCH = 100;

/** USD per 1M tokens. Negative or non-finite would cost history nonsense. */
function price(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError(`${field} must be a number of USD per 1M tokens, 0 or more.`);
  }
  return value;
}

function requireBuiltin(modelId: string) {
  const model = builtinModel(modelId.trim());
  if (!model) throw new ConvexError(`Unknown model: ${modelId}`);
  return model;
}

/** Write the override row for a built-in, creating it from the shipped values. */
async function patchRow(
  ctx: MutationCtx,
  modelId: string,
  patch: Partial<
    Pick<
      Doc<"aiModels">,
      "label" | "inputPer1M" | "outputPer1M" | "enabled" | "promptCaching" | "notes"
    >
  >
) {
  const model = requireBuiltin(modelId);
  const now = Date.now();
  const existing = await modelRow(ctx, model.id);
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
    return;
  }
  const shipped = MODEL_PRICES[model.id];
  await ctx.db.insert("aiModels", {
    modelId: model.id,
    label: model.label,
    kind: model.role,
    inputPer1M: shipped.input,
    outputPer1M: shipped.output,
    enabled: true,
    ...patch,
    createdAt: now,
    updatedAt: now,
  });
}

/** Every model with its price. Admin-only: it is the price list. */
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

/** Relabel or reprice a model. */
export const update = mutation({
  args: {
    modelId: v.string(),
    label: v.string(),
    inputPer1M: v.number(),
    outputPer1M: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const model = requireBuiltin(args.modelId);
    await patchRow(ctx, model.id, {
      label: args.label.trim() || model.label,
      inputPer1M: price(args.inputPer1M, "Input price"),
      outputPer1M:
        model.role === "chat" ? price(args.outputPer1M, "Output price") : 0,
      notes: args.notes?.trim() || undefined,
    });
    return { modelId: model.id };
  },
});

/** Offer a chat model in the picker, or stop offering it. */
export const setEnabled = mutation({
  args: { modelId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const model = requireBuiltin(args.modelId);
    if (model.role !== "chat") {
      throw new ConvexError("Only chat models are offered in the picker.");
    }
    if (model.isDefault && !args.enabled) {
      throw new ConvexError("The default chat model is always offered.");
    }
    await patchRow(ctx, model.id, { enabled: args.enabled });
    return { modelId: model.id };
  },
});

/** Turn the gateway's prompt caching on or off for an Anthropic model. */
export const setPromptCaching = mutation({
  args: { modelId: v.string(), promptCaching: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const model = requireBuiltin(args.modelId);
    if (!supportsPromptCaching(model.id)) {
      throw new ConvexError("Only Anthropic models need prompt caching set.");
    }
    await patchRow(ctx, model.id, { promptCaching: args.promptCaching });
    return { modelId: model.id };
  },
});

export const promptCaching = internalQuery({
  args: { modelId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => lookupPromptCaching(ctx, args.modelId),
});

/** Drop every change made from the dashboard and go back to what ships. */
export const reset = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await modelRow(ctx, args.modelId);
    if (!existing) return { reset: false };
    await ctx.db.delete(existing._id);
    return { reset: true };
  },
});

/** Delete every `aiModels` row for a model that is not in `MODELS`. */
export const removeCustomModels = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiModels").collect();
    const removed: string[] = [];
    for (const row of rows) {
      if (builtinModel(row.modelId)) continue;
      await ctx.db.delete(row._id);
      removed.push(row.modelId);
    }
    return { removed };
  },
});

/**
 * Put every agent in every workspace on the default model — desks included,
 * and agents an administrator had set to something else.
 *
 * An agent keeps the model it was saved with and a company cannot change it,
 * so moving `DEFAULT_CHAT_MODEL` alone leaves every existing agent where it
 * was. This is the other half. One page per call; `done` says when to stop.
 */
export const moveAgentsToDefault = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const page = await ctx.db
      .query("agents")
      .paginate({ numItems: MOVE_BATCH, cursor: args.cursor });

    const now = Date.now();
    let moved = 0;
    for (const agent of page.page) {
      if (agent.model === DEFAULT_CHAT_MODEL) continue;
      await ctx.db.patch(agent._id, { model: DEFAULT_CHAT_MODEL, updatedAt: now });
      moved += 1;
    }

    return {
      moved,
      scanned: page.page.length,
      cursor: page.continueCursor,
      done: page.isDone,
    };
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
      await addToUsageDaily(ctx, row, -1);
      await addToUsageDaily(ctx, { ...row, costNanoUsd: cost, priced: true });
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
