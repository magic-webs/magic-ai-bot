/**
 * The model provider: Vercel AI Gateway.
 *
 * One key reaches every model the platform needs — the chat models, OpenAI's
 * embedding model for retrieval, Jev for classification, Whisper for voice
 * notes — so there is a single credential and a single bill.
 *
 * Imported only by the Node actions (engine, ai, ingest, whatsapp). Never from
 * lib/shared.ts or lib/prompt.ts: those are imported by React, and pulling the
 * SDK into the browser bundle for a couple of constants would be a poor trade.
 */

import { createGateway } from "ai";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  isChatModel,
  supportsPromptCaching,
} from "./shared";

export { DEFAULT_CHAT_MODEL } from "./shared";

export const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;

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
 * The chat model a call runs on. An agent saved with a model that is no longer
 * in `MODELS` runs on the default rather than on a model nobody prices.
 */
export function gatewayModelId(model: string | undefined): string {
  const trimmed = model?.trim() ?? "";
  return isChatModel(trimmed) ? trimmed : DEFAULT_CHAT_MODEL;
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
export async function gatewayOptions(ctx: ActionCtx, model: string) {
  const providers = PROVIDER_ROUTING[model];
  const cached =
    supportsPromptCaching(model) &&
    (await ctx.runQuery(internal.models.promptCaching, { modelId: model }));
  const caching = cached ? ("auto" as const) : undefined;
  if (!providers && !caching) return undefined;
  return {
    gateway: {
      ...(providers && { order: providers, only: providers }),
      ...(caching && { caching }),
    },
  };
}
