/**
 * The server factory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "./tools/index.mjs";

/**
 * Builds a server instance with every tool registered.
 *
 * A factory rather than a singleton: an McpServer binds to exactly one
 * transport, and the HTTP transport needs a fresh one per client session.
 * Authentication and the Convex client are module-level, so a new instance
 * costs nothing but the registrations.
 */
export function buildServer() {
  const server = new McpServer(
    { name: "magic-agent", version: "1.0.0" },
    {
      instructions: [
        "Manage a Magic Agent workspace: agents, the front desk that routes between them, the product catalogue, the knowledge base, channels and custom tools.",
        "",
        "How the platform fits together, so configuration lands in the right place:",
        "- Every workspace has one front desk agent (kind: router). It answers first on every channel and hands each conversation to the specialist that should deal with it, silently. Specialists can hand on to each other.",
        "- Routing is driven entirely by each specialist's `routingDescription` — 'hand over to me when…'. An agent without one is nearly invisible to the front desk, so always set it.",
        "- Only *active* agents receive handoffs. A draft agent gets no traffic.",
        "- Agents refuse to discuss products that are not in the catalogue, and never quote a price that is not stored on the product.",
        "- After changing configuration, use chat_with_agent to see what the customer would actually get. It reports the handoff path, so you can tell whether routing worked.",
      ].join("\n"),
    }
  );

  registerAll(server);

  return server;
}
