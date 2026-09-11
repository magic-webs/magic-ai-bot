/**
 * Resolving named things to ids.
 *
 * Tools take names, not Convex ids: an assistant should be able to say
 * "the Sales agent" without having looked up `j57e17...` first. An id is still
 * accepted, so anything echoed back by a previous call can be passed straight
 * in.
 */

import { api, call } from "./convex.mjs";

const norm = (value) => value.trim().toLowerCase();

export function pickByName(rows, wanted, label, fields) {
  const target = norm(wanted);
  const exact = rows.filter((row) =>
    fields.some((field) => row[field] && norm(String(row[field])) === target)
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `"${wanted}" matches ${exact.length} ${label}s. Use its id instead: ${exact
        .map((row) => row._id)
        .join(", ")}`
    );
  }

  const partial = rows.filter((row) =>
    fields.some((field) => row[field] && norm(String(row[field])).includes(target))
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${wanted}" is ambiguous. Did you mean: ${partial
        .map((row) => row.name ?? row.title ?? row._id)
        .join(", ")}?`
    );
  }

  throw new Error(
    `No ${label} called "${wanted}". Available: ${
      rows.map((row) => row.name ?? row.title ?? row._id).join(", ") || "none"
    }`
  );
}

export async function findAgent(workspaceId, wanted) {
  const agents = await call.query(api.agents.listByWorkspace, { workspaceId });
  if (agents.some((agent) => agent._id === wanted)) {
    return agents.find((agent) => agent._id === wanted);
  }
  return pickByName(agents, wanted, "agent", ["name", "botName", "role"]);
}

export async function findProduct(workspaceId, wanted) {
  const products = await call.query(api.products.listByWorkspace, {
    workspaceId,
  });
  if (products.some((p) => p._id === wanted)) {
    return products.find((p) => p._id === wanted);
  }
  return pickByName(products, wanted, "product", ["name", "sku", "slug"]);
}

export async function findChannel(workspaceId, wanted) {
  const channels = await call.query(api.channels.listByWorkspace, {
    workspaceId,
  });
  if (channels.some((c) => c._id === wanted)) {
    return channels.find((c) => c._id === wanted);
  }
  return pickByName(channels, wanted, "channel", ["name", "channelKey"]);
}

export async function findKnowledge(workspaceId, wanted) {
  const sources = await call.query(api.knowledge.listByWorkspace, {
    workspaceId,
  });
  if (sources.some((s) => s._id === wanted)) {
    return sources.find((s) => s._id === wanted);
  }
  return pickByName(sources, wanted, "knowledge source", ["title"]);
}

export async function findCustomTool(workspaceId, wanted) {
  const tools = await call.query(api.tools.listByWorkspace, { workspaceId });
  if (tools.some((t) => t._id === wanted)) {
    return tools.find((t) => t._id === wanted);
  }
  return pickByName(tools, wanted, "custom tool", ["name", "displayName"]);
}
