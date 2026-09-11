/**
 * Result shaping.
 *
 * A raw Convex document carries _creationTime, searchBlob, embeddings and other
 * noise. Trimming it keeps a tool result readable and cheap.
 */

const MAX_RESULT_CHARS = 60_000;

export function ok(payload) {
  let text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated (${
      text.length - MAX_RESULT_CHARS
    } more characters). Narrow the request.`;
  }
  return { content: [{ type: "text", text }] };
}

export function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/** Wraps a handler so a Convex error becomes a tool error, not a crash. */
export function handler(run) {
  return async (args) => {
    try {
      return await run(args ?? {});
    } catch (error) {
      return fail(error);
    }
  };
}

export const money = (nano) =>
  nano === undefined || nano === null
    ? null
    : `$${(nano / 1_000_000_000).toFixed(4)}`;

export const agentBrief = (agent) => ({
  id: agent._id,
  name: agent.name,
  botName: agent.botName,
  gender: agent.gender ?? null,
  role: agent.role,
  kind: agent.kind ?? "specialist",
  status: agent.status,
  model: agent.model,
  routingDescription: agent.routingDescription ?? null,
  acceptsHandoff: agent.acceptsHandoff !== false,
  builtinTools: agent.builtinTools,
  knowledgeEnabled: agent.knowledgeEnabled,
});

export const productBrief = (product) => ({
  id: product._id,
  name: product.name,
  sku: product.sku ?? null,
  slug: product.slug,
  category: product.category,
  description: product.description,
  price: product.price ?? null,
  currency: product.currency ?? null,
  unit: product.unit ?? null,
  status: product.status,
  tags: product.tags,
  images: (product.resolvedImages ?? []).map((image) => image.url),
  attributes: product.attributes,
  requirementFields: product.requirementFields,
  exampleSpec: product.exampleSpec ?? null,
  notes: product.notes ?? null,
});
