/**
 * The model catalogue — the fixed `MODELS` list, with whatever an
 * administrator has changed about each one from /admin/models layered on top.
 *
 * An `aiModels` row may relabel or reprice a model, take a chat model out of
 * the picker, or switch its prompt caching off. A row for a model that is not
 * in `MODELS` is ignored.
 *
 * Kept in lib/ rather than in models.ts because usage.ts costs every call
 * through `lookupPrice` and should not have to import a module of endpoints to
 * do it.
 */

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MODEL_PRICES, type ModelPrice } from "./pricing";
import {
  MODELS,
  builtinModel,
  supportsPromptCaching,
  type ModelRole,
} from "./shared";

type Ctx = QueryCtx | MutationCtx;

export type CatalogueEntry = {
  modelId: string;
  label: string;
  role: ModelRole;
  /** USD per 1M tokens. */
  inputPer1M: number;
  outputPer1M: number;
  isDefault: boolean;
  /** Whether the agent picker offers it. Only chat models are offered. */
  enabled: boolean;
  promptCaching: boolean;
  notes?: string;
  /** An administrator has changed it from what ships. */
  customised: boolean;
};

export async function modelRow(
  ctx: Ctx,
  modelId: string
): Promise<Doc<"aiModels"> | null> {
  return await ctx.db
    .query("aiModels")
    .withIndex("by_modelId", (q) => q.eq("modelId", modelId.trim()))
    .unique();
}

/** The price to cost a call at, or null to fall through to `MODEL_PRICES`. */
export async function lookupPrice(
  ctx: Ctx,
  model: string
): Promise<ModelPrice | null> {
  if (!builtinModel(model.trim())) return null;
  const row = await modelRow(ctx, model);
  return row ? { input: row.inputPer1M, output: row.outputPer1M } : null;
}

/** Whether a call to this model should ask the gateway to cache its prompt. */
export async function lookupPromptCaching(
  ctx: Ctx,
  model: string
): Promise<boolean> {
  const modelId = model.trim();
  if (!builtinModel(modelId) || !supportsPromptCaching(modelId)) return false;
  return (await modelRow(ctx, modelId))?.promptCaching ?? true;
}

export async function mergedCatalogue(ctx: Ctx): Promise<CatalogueEntry[]> {
  const rows = await ctx.db.query("aiModels").collect();
  const byId = new Map(rows.map((row) => [row.modelId, row]));

  return MODELS.map((model) => {
    const row = byId.get(model.id);
    const price = MODEL_PRICES[model.id];
    return {
      modelId: model.id,
      label: row?.label ?? model.label,
      role: model.role,
      inputPer1M: row?.inputPer1M ?? price.input,
      outputPer1M: row?.outputPer1M ?? price.output,
      isDefault: model.isDefault,
      enabled:
        model.role === "chat" && (model.isDefault || (row?.enabled ?? true)),
      promptCaching:
        supportsPromptCaching(model.id) && (row?.promptCaching ?? true),
      notes: row?.notes,
      customised: row !== undefined,
    };
  });
}

/** What the agent screen's model picker offers, in the order it offers it. */
export async function chatModelOptions(
  ctx: Ctx
): Promise<Array<{ id: string; label: string }>> {
  const catalogue = await mergedCatalogue(ctx);
  return catalogue
    .filter((entry) => entry.enabled)
    .map((entry) => ({ id: entry.modelId, label: entry.label }));
}
