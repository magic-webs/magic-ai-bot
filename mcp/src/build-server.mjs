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
        "- There are two places a conversation's result can land. `orders` is for things sold out of the catalogue, with products and prices behind it. Everything else a conversation collects — a membership, an appointment, a site visit, a quotation for work that is not a catalogue line — belongs in a *record book*, which defines its own fields and gives the agents switched on for it tools named after it (file_membership, find_membership). An agent using create_order to capture something that is not an order is a workspace that needs a record book.",
        "- The follow-up desk (kind: follow_up) reads each conversation once it has gone quiet, files it at a lead stage by matching it against every stage's description, and sends at most a couple of nudges while the stage is open. Stage descriptions are therefore the pipeline's real configuration: write them as tests a reader could apply to a transcript. A lead filed by hand with set_lead_stage is pinned, and the desk leaves it there.",
        "- Alerts (notification alerts) send a WhatsApp template or a ZeptoMail email when a record is filed, updated or changes stage, an order is taken, an agent escalates, or another system POSTs to the alert's own URL. WhatsApp alerts can only send approved templates synced from the panel (sync_whatsapp_templates), because nothing else reaches someone outside the 24-hour window. A template's blanks and an alert's recipients are text with {{path}} placeholders over the event's payload — list_whatsapp_templates shows the blanks, get_notification_settings the variables each event offers. Confirm one with test_notification_alert, and read list_notification_activity for why a send did not go.",
        "- After changing configuration, use chat_with_agent to see what the customer would actually get. It reports the handoff path, so you can tell whether routing worked.",
      ].join("\n"),
    }
  );

  registerAll(server);

  return server;
}
