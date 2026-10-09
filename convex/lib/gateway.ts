/**
 * The model provider: Vercel AI Gateway.
 *
 * One key reaches every model the platform needs — DeepSeek for chat, OpenAI's
 * embedding model for retrieval, Whisper for voice notes — so there is a single
 * credential and a single bill instead of one per vendor.
 *
 * Imported only by the Node actions (engine, ai, ingest, whatsapp). Never from
 * lib/shared.ts or lib/prompt.ts: those are imported by React, and pulling the
 * SDK into the browser bundle for a couple of constants would be a poor trade.
 */

import { createGateway } from "ai";
import { ConvexError } from "convex/values";

// Re-exported, not redeclared: the value has to be reachable from queries and
// mutations too, which may not import the SDK, so it lives in shared.ts.
// Claude Haiku 5.5 is tool-capable, reads images and holds 1M tokens of
// context, at $0.10/$0.50 per million up to 100K prompt tokens.
export { DEFAULT_CHAT_MODEL } from "./shared";

/**
 * Retrieval. Deliberately still OpenAI's small embedding model, routed through
 * the gateway: the knowledgeChunks vector index is pinned to 1536 dimensions,
 * so any other model would silently stop matching and every source in every
 * workspace would need re-embedding. DeepSeek publishes no embedding model
 * anyway. Same vectors as before, same index, new billing route.
 */
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

/** Voice notes. The same Whisper the direct OpenAI call used. */
export const TRANSCRIPTION_MODEL = "openai/whisper-1";

/**
 * Spoken replies. Fish Audio's S2.1, on the gateway's free tier.
 *
 * Text-to-speech is not token-priced, so — like `TRANSCRIPTION_MODEL` — a call
 * to it records no usage row: `usage.record` costs from a per-token table and
 * would price every greeting at zero.
 */
export const SPEECH_MODEL = "fish-audio/s2.1-pro-free";

export function aiGateway() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    console.error("gateway: AI_GATEWAY_API_KEY is not set");
    throw new ConvexError("The assistant is not available right now.");
  }
  return createGateway({ apiKey });
}

/**
 * The gateway addresses models as `creator/model`. Agent rows written before
 * this change hold bare OpenAI ids like `gpt-4.1-mini`, so they are qualified
 * on the way out rather than migrated — an agent nobody has touched keeps
 * answering on the model it was configured with, through the new route.
 */
export function gatewayModelId(model: string): string {
  const trimmed = model.trim();
  return trimmed.includes("/") ? trimmed : `openai/${trimmed}`;
}

/**
 * The inference providers a model may run on, in the order the gateway tries
 * them. Left to itself the gateway picks from every provider serving the model
 * on recent uptime and latency, so a turn can land on any of them; listing a
 * model here pins it to these and falls through them in turn.
 *
 * A model not listed is routed however the gateway chooses.
 */
const PROVIDER_ROUTING: Record<string, string[]> = {
  "deepseek/deepseek-v4.1-flash": ["deepseek", "deepinfra","morph","fireworks"],
};

/** `providerOptions` for a gateway model id, or undefined when it needs none. */
export function gatewayRouting(model: string) {
  const providers = PROVIDER_ROUTING[model];
  const caching = model.startsWith("anthropic/") ? ("auto" as const) : undefined;
  if (!providers && !caching) return undefined;
  return {
    gateway: {
      ...(providers && { order: providers, only: providers }),
      ...(caching && { caching }),
    },
  };
}
