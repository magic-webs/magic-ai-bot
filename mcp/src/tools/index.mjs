/**
 * Every tool group, in the order they are registered.
 *
 * Order is the order a client lists them in, so it reads as a tour of the
 * platform: what you can see, then agents, what they sell, what they know,
 * where customers reach them, what they can call, what they did — and last the
 * admin tools most callers will never be allowed to use.
 */

import { register as context } from "./context.mjs";
import { register as agents } from "./agents.mjs";
import { register as catalogue } from "./catalogue.mjs";
import { register as knowledge } from "./knowledge.mjs";
import { register as channels } from "./channels.mjs";
import { register as customTools } from "./custom-tools.mjs";
import { register as operations } from "./operations.mjs";
import { register as admin } from "./admin.mjs";

const GROUPS = [
  context,
  agents,
  catalogue,
  knowledge,
  channels,
  customTools,
  operations,
  admin,
];

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerAll(server) {
  for (const register of GROUPS) register(server);
}
