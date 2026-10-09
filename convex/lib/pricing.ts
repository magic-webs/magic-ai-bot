import type { ModelId } from "./shared";

/**
 * Model prices, in USD per million tokens, for the models in `MODELS`.
 *
 * Read off the gateway's own catalogue — https://ai-gateway.vercel.sh/v1/models
 * returns a per-token `pricing` object for every model. They are list prices
 * and they move; /admin/models can override them without a deploy, see
 * convex/lib/modelCatalogue.ts.
 */
export type ModelPrice = {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. Zero for embedding models. */
  output: number;
};

export const MODEL_PRICES: Record<ModelId, ModelPrice> = {
  // Up to 100K prompt tokens; the gateway charges 5x past that.
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
  "deepseek/deepseek-v4.1-flash": { input: 0.3, output: 1.2 },
  "openai/text-embedding-3-small": { input: 0.02, output: 0 },
  "typesafe-ai/jev": { input: 0.042, output: 0 },
};

const NANO = 1_000_000_000;

/**
 * Cost of one call in integer nano-USD, plus whether the model was priced.
 *
 * Rounded once at the end. Summing already-rounded per-token values would
 * accumulate error across thousands of rows.
 *
 * `override` is the `aiModels` row an administrator repriced from the
 * dashboard. It wins over the built-in table so a price can move
 * without a deploy — see `lookupPrice` in convex/lib/modelCatalogue.ts, which
 * is what every caller passes.
 */
export function costNanoUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  override?: ModelPrice | null
): { costNanoUsd: number; priced: boolean } {
  const price = override ?? MODEL_PRICES[model as ModelId];
  if (!price) return { costNanoUsd: 0, priced: false };

  const usd =
    (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return { costNanoUsd: Math.round(usd * NANO), priced: true };
}

/** Nano-USD back to dollars, for display. */
export function nanoUsdToUsd(nano: number): number {
  return nano / NANO;
}
