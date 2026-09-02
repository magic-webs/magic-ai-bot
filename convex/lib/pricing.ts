/**
 * Model prices, in USD per million tokens.
 *
 * Kept as data rather than folded into the recording call so the numbers are
 * auditable in one place, and so an unknown model is a visible gap rather than
 * a silent zero.
 *
 * Keyed the way the gateway addresses a model, `creator/model`. The bare
 * OpenAI ids below it are the old keys: usage rows written before the gateway
 * carry them, and an agent still configured with one is priced by it, so
 * removing them would turn history into an unpriced gap.
 *
 * Read straight off the gateway's own catalogue —
 * https://ai-gateway.vercel.sh/v1/models returns a per-token `pricing` object
 * for every model. Re-check there when adding one; these are list prices and
 * they move.
 */
export type ModelPrice = {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. Zero for embedding models. */
  output: number;
  kind: "chat" | "embedding";
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // --- Gateway ids ---------------------------------------------------------
  "deepseek/deepseek-v4-flash": { input: 0.13, output: 0.26, kind: "chat" },
  "deepseek/deepseek-v4-pro": { input: 0.66, output: 1.98, kind: "chat" },
  "openai/gpt-4.1": { input: 2.0, output: 8.0, kind: "chat" },
  "openai/gpt-4.1-mini": { input: 0.4, output: 1.6, kind: "chat" },
  "openai/gpt-4.1-nano": { input: 0.1, output: 0.4, kind: "chat" },
  "openai/gpt-4o": { input: 2.5, output: 10.0, kind: "chat" },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6, kind: "chat" },
  "openai/o4-mini": { input: 1.1, output: 4.4, kind: "chat" },
  "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0, kind: "chat" },
  "openai/text-embedding-3-small": { input: 0.02, output: 0, kind: "embedding" },
  "openai/text-embedding-3-large": { input: 0.13, output: 0, kind: "embedding" },

  // --- Pre-gateway ids, kept so old usage rows stay priced -----------------
  "gpt-4.1": { input: 2.0, output: 8.0, kind: "chat" },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, kind: "chat" },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, kind: "chat" },
  "gpt-4o": { input: 2.5, output: 10.0, kind: "chat" },
  "gpt-4o-mini": { input: 0.15, output: 0.6, kind: "chat" },
  "o4-mini": { input: 1.1, output: 4.4, kind: "chat" },

  // Embeddings — output is always zero.
  "text-embedding-3-small": { input: 0.02, output: 0, kind: "embedding" },
  "text-embedding-3-large": { input: 0.13, output: 0, kind: "embedding" },
  "text-embedding-ada-002": { input: 0.1, output: 0, kind: "embedding" },
};

const NANO = 1_000_000_000;

/**
 * Cost of one call in integer nano-USD, plus whether the model was priced.
 *
 * Rounded once at the end. Summing already-rounded per-token values would
 * accumulate error across thousands of rows.
 */
export function costNanoUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): { costNanoUsd: number; priced: boolean } {
  const price = MODEL_PRICES[model];
  if (!price) return { costNanoUsd: 0, priced: false };

  const usd =
    (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return { costNanoUsd: Math.round(usd * NANO), priced: true };
}

/** Nano-USD back to dollars, for display. */
export function nanoUsdToUsd(nano: number): number {
  return nano / NANO;
}
