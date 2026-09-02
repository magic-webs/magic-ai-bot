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

// Re-exported, not redeclared: the value has to be reachable from queries and
// mutations too, which may not import the SDK, so it lives in shared.ts.
// DeepSeek V4 Flash is tool-capable and, at $0.13/$0.26 per million tokens,
// about a quarter of what gpt-4.1-mini cost for the same conversation.
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

export function aiGateway() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_GATEWAY_API_KEY is not set on the Convex deployment. Every model call happens inside a Convex action, which cannot read .env.local — run: npx convex env set AI_GATEWAY_API_KEY <key>"
    );
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
