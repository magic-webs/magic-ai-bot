/**
 * The model catalogue — what the platform offers, and what it charges for it.
 *
 * Two sources, deliberately layered:
 *
 *   1. The constants this repo ships with — `MODEL_PRICES` for the price and
 *      `CHAT_MODELS` for what the picker offers. They are the floor: code
 *      review sees them, and history written before the `aiModels` table
 *      existed is still costed by them.
 *   2. The `aiModels` table, which an administrator edits from
 *      /admin/models. A row either introduces a model the constants have never
 *      heard of, or overrides one whose list price has moved.
 *
 * The table wins. That is the whole point: the gateway adds models and moves
 * prices faster than this repo ships, and an unpriced model silently bills a
 * workspace at zero.
 *
 * Kept in lib/ rather than in models.ts because usage.ts costs every call
 * through `lookupPrice` and should not have to import a module of endpoints to
 * do it.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MODEL_PRICES, type ModelPrice } from "./pricing";
import { CHAT_MODELS } from "./shared";

type Ctx = QueryCtx | MutationCtx;

export type ModelKind = "chat" | "embedding";

export type CatalogueEntry = {
  modelId: string;
  label: string;
  kind: ModelKind;
  /** USD per 1M tokens. */
  inputPer1M: number;
  outputPer1M: number;
  /** Whether the model picker offers it. A disabled model is still priced. */
  enabled: boolean;
  notes?: string;
  /**
   * builtin  — shipped in the constants, untouched
   * override — shipped, but repriced or relabelled from the dashboard
   * custom   — added from the dashboard; the constants know nothing about it
   *
   * The admin table shows this so nobody wonders why deleting a row leaves the
   * model on screen: deleting an override falls back to the constant.
   */
  source: "builtin" | "override" | "custom";
};

/**
 * The price to cost a call at, or null to fall through to `MODEL_PRICES`.
 *
 * One indexed read per model call. `usage.record` already writes a row, so the
 * extra read is on a path that was never free.
 */
export async function lookupPrice(
  ctx: Ctx,
  model: string
): Promise<ModelPrice | null> {
  const row = await ctx.db
    .query("aiModels")
    .withIndex("by_modelId", (q) => q.eq("modelId", model.trim()))
    .unique();
  if (!row) return null;
  return { input: row.inputPer1M, output: row.outputPer1M, kind: row.kind };
}

/** Where a built-in sits in the picker, or -1 if the picker never offers it. */
function builtinRank(modelId: string): number {
  return CHAT_MODELS.findIndex((model) => model.id === modelId);
}

/**
 * Every model the platform knows about, constants and table merged.
 *
 * A built-in that is priced but not in `CHAT_MODELS` — the pre-gateway
 * `gpt-4o-mini`, the embedding models — is listed as disabled rather than
 * hidden, because that is exactly what it is: priced, not offered.
 */
export async function mergedCatalogue(ctx: Ctx): Promise<CatalogueEntry[]> {
  // The table is a handful of rows an operator typed; there is nothing to
  // paginate.
  const rows = await ctx.db.query("aiModels").collect();
  const byId = new Map(rows.map((row) => [row.modelId, row]));

  const entries: CatalogueEntry[] = [];
  const seen = new Set<string>();

  for (const [modelId, price] of Object.entries(MODEL_PRICES)) {
    seen.add(modelId);
    const override = byId.get(modelId);
    const label =
      CHAT_MODELS.find((model) => model.id === modelId)?.label ?? modelId;
    entries.push(
      override
        ? {
            modelId,
            label: override.label,
            kind: override.kind,
            inputPer1M: override.inputPer1M,
            outputPer1M: override.outputPer1M,
            enabled: override.enabled,
            notes: override.notes,
            source: "override",
          }
        : {
            modelId,
            label,
            kind: price.kind,
            inputPer1M: price.input,
            outputPer1M: price.output,
            enabled: builtinRank(modelId) >= 0,
            source: "builtin",
          }
    );
  }

  for (const row of rows) {
    if (seen.has(row.modelId)) continue;
    entries.push({
      modelId: row.modelId,
      label: row.label,
      kind: row.kind,
      inputPer1M: row.inputPer1M,
      outputPer1M: row.outputPer1M,
      enabled: row.enabled,
      notes: row.notes,
      source: "custom",
    });
  }

  // Chat before embeddings, offered before retired, and the built-in picker
  // order preserved inside that — an operator reading the table should meet
  // the models in the same order the agent screen offers them.
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "chat" ? -1 : 1;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const rankA = builtinRank(a.modelId);
    const rankB = builtinRank(b.modelId);
    if (rankA !== rankB) {
      if (rankA < 0) return 1;
      if (rankB < 0) return -1;
      return rankA - rankB;
    }
    return a.modelId.localeCompare(b.modelId);
  });
}

/** What the agent screen's model picker offers, in the order it offers it. */
export async function chatModelOptions(
  ctx: Ctx
): Promise<Array<{ id: string; label: string }>> {
  const catalogue = await mergedCatalogue(ctx);
  return catalogue
    .filter((entry) => entry.kind === "chat" && entry.enabled)
    .map((entry) => ({ id: entry.modelId, label: entry.label }));
}
