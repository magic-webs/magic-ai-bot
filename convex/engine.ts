"use node";

import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { aiGateway, gatewayModelId, gatewayOptions, EMBEDDING_MODEL } from "./lib/gateway";
import {
  generateText,
  embed,
  tool,
  dynamicTool,
  jsonSchema,
  isStepCount,
  hasToolCall,
  type ToolSet,
} from "ai";
import { z } from "zod";
import {
  compileSystemPrompt,
  type HandoffShape,
  type TeammateShape,
} from "./lib/prompt";
import {
  DEFAULT_MESSAGES_PER_SESSION,
  MAX_HANDOFFS_PER_TURN,
  MAX_WIDGET_MESSAGE_CHARS,
  randomKey,
  readableError,
  truncate,
} from "./lib/shared";
import {
  BUTTON_TEXT_MAX,
  buildPrefill,
  formatPhone,
  formGroups,
  groupPrefillFields,
  type AppItem,
  type AppPrefillField,
} from "./lib/apps";
import { callApp } from "./lib/appClient";
import { summarise, type HeaderSpec, type Outbound } from "./lib/whatsappSend";
import {
  parametersToJsonSchema,
  renderTemplate,
  unusedParameterKeys,
} from "./lib/toolSchema";
import {
  checkValues,
  recordToolNames,
  type RecordField,
} from "./lib/records";

const MAX_TOOL_OUTPUT_CHARS = 4000;
const DEFAULT_HTTP_TIMEOUT_MS = 12_000;

type ToolTrace = {
  toolName: string;
  toolInput: string;
  toolOutput: string;
  toolOk: boolean;
};

// A handover the acting agent has asked for. Set by the transfer_to_agent
// tool and consumed by the turn loop once generation stops — the tool itself
// cannot swap the model out from under the call it is running inside.
type PendingTransfer = {
  agentId: Id<"agents">;
  botName: string;
  reason: string;
  summary: string;
};

type TurnContext = {
  workspace: Doc<"workspaces">;
  // The agent currently holding the turn. Reassigned on every handoff, so the
  // toolset and prompt are rebuilt against whoever is answering.
  agent: Doc<"agents">;
  conversationId: Id<"conversations">;
  contactId: Id<"contacts">;
  channelType: "whatsapp" | "web";
  // Both needed to send anything richer than the reply text: the channel holds
  // the credentials, and on WhatsApp the external id *is* the phone number.
  channelId?: Id<"channels">;
  externalId: string;
  contact: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    attributes: Array<{ key: string; value: string }>;
  };
  trace: ToolTrace[];
  pendingTransfer: PendingTransfer | null;
  /**
   * Whether a control that puts a question to the customer has already gone out
   * this turn. One reply cannot answer two menus, so the second is refused.
   */
  askedThisTurn: boolean;
  /**
   * Which agent sent that control, so the trailing prose can be dropped for
   * the agent that already asked and kept for a colleague it was handed to.
   */
  askedBy: Id<"agents"> | null;
};

function record(
  trace: ToolTrace[],
  toolName: string,
  input: unknown,
  output: unknown,
  ok: boolean
) {
  trace.push({
    toolName,
    toolInput: truncate(JSON.stringify(input ?? {}), 2000),
    toolOutput: truncate(
      typeof output === "string" ? output : JSON.stringify(output ?? null),
      MAX_TOOL_OUTPUT_CHARS
    ),
    toolOk: ok,
  });
}

// Wraps a tool implementation so a thrown error becomes a value the model can
// reason about, and every call lands in the conversation's tool trace.
function traced<TInput>(
  trace: ToolTrace[],
  name: string,
  run: (input: TInput) => Promise<unknown>
) {
  return async (input: TInput) => {
    try {
      const output = await run(input);
      record(trace, name, input, output, true);
      return output;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = readableError(raw);
      if (message !== raw) console.error(`[engine] tool ${name} failed`, raw);
      const failure = { ok: false, error: message };
      record(trace, name, input, failure, false);
      return failure;
    }
  };
}

// ---------------------------------------------------------------------------
// Knowledge retrieval
// ---------------------------------------------------------------------------

async function retrieveKnowledge(
  ctx: ActionCtx,
  opts: {
    apiKey: string;
    workspaceId: Id<"workspaces">;
    agentId: Id<"agents">;
    queryText: string;
    topK: number;
    // Carried purely for usage attribution: the embedding is part of whatever
    // conversation asked for it, and reporting it as channel-less would put
    // real per-message spend under "no channel".
    channelType?: "whatsapp" | "web";
    conversationId?: Id<"conversations">;
  }
): Promise<Array<{ text: string; sourceTitle: string }>> {
  const { embedding, usage } = await embed({
    model: aiGateway().embedding(EMBEDDING_MODEL),
    value: opts.queryText,
  });

  // Every retrieval embeds the query, so it is a real per-message cost even
  // though it is tiny next to the chat call.
  await ctx.runMutation(internal.usage.record, {
    workspaceId: opts.workspaceId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    channelType: opts.channelType,
    source: "retrieval",
    model: EMBEDDING_MODEL,
    kind: "embedding",
    inputTokens: usage?.tokens ?? 0,
    outputTokens: 0,
  });

  const hits = await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
    vector: embedding,
    limit: opts.topK,
    // Workspace-wide chunks plus chunks private to this agent
    filter: (q) =>
      q.or(
        q.eq("scopeKey", `${opts.workspaceId}|*`),
        q.eq("scopeKey", `${opts.workspaceId}|${opts.agentId}`)
      ),
  });

  if (hits.length === 0) return [];
  return await ctx.runQuery(internal.knowledge.hydrateChunks, {
    chunkIds: hits.map((hit) => hit._id),
  });
}

function formatKnowledge(
  passages: Array<{ text: string; sourceTitle: string }>
): string {
  return passages
    .map((p, idx) => `[${idx + 1}] From "${p.sourceTitle}":\n${p.text}`)
    .join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Builtin tools
// ---------------------------------------------------------------------------

function buildBuiltinTools(
  ctx: ActionCtx,
  turn: TurnContext,
  apiKey: string,
  routing: {
    /** Colleagues this agent may hand the conversation to, if any. */
    team: TeammateShape[];
    /** False once the hop budget is spent, or when nobody is available. */
    allowTransfer: boolean;
    /** Agents that have already held this turn — never hand back. */
    alreadyHeld: Id<"agents">[];
  }
): ToolSet {
  const { workspace, agent, trace } = turn;
  const registry: ToolSet = {};
  const enabled = new Set(agent.builtinTools);
  // The front desk exists only to route, so it always has the tool whatever
  // its saved configuration says.
  if (agent.kind === "router") enabled.add("transfer_to_agent");

  if (enabled.has("search_knowledge")) {
    registry.search_knowledge = tool({
      description:
        "Search the company knowledge base for policies, specifications, guidelines and FAQs. Use it instead of guessing whenever the answer would be documented.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to look up, phrased as a search query or question"),
      }),
      execute: traced(trace, "search_knowledge", async ({ query }) => {
        const passages = await retrieveKnowledge(ctx, {
          apiKey,
          workspaceId: workspace._id,
          agentId: agent._id,
          queryText: query,
          topK: agent.knowledgeTopK,
          channelType: turn.channelType,
          conversationId: turn.conversationId,
        });
        if (passages.length === 0) {
          return {
            found: false,
            note: "Nothing in the knowledge base matched. Say you will check with the team rather than inventing an answer.",
          };
        }
        return {
          found: true,
          passages: passages.map((p) => ({
            source: p.sourceTitle,
            text: truncate(p.text, 1200),
          })),
        };
      }),
    });
  }

  if (enabled.has("search_products")) {
    registry.search_products = tool({
      description:
        "Search the product catalogue by name, category or keyword to confirm what is actually offered.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Product name or keyword. Omit to list the catalogue."),
      }),
      execute: traced(trace, "search_products", async ({ query }) => {
        const products = await ctx.runQuery(internal.products.searchForTool, {
          workspaceId: workspace._id,
          query,
          limit: 8,
        });
        const withImages = products.filter((p) => p.imageUrl).length;
        return {
          count: products.length,
          products,
          // Said here rather than only in the prompt because this is where the
          // URL is handed over, and a bare imageUrl reads as an invitation to
          // paste it into the reply.
          ...(withImages > 0 && enabled.has("rich_messages")
            ? {
                note: "imageUrl is for send_media, not for your reply. If the customer wants to see a product, call send_media with its imageUrl and a short caption — one call per product. Never write the URL out.",
              }
            : withImages > 0
              ? {
                  note: "Do not put imageUrl in your reply — the customer cannot open it. Describe the product instead.",
                }
              : {}),
        };
      }),
    });
  }

  if (enabled.has("get_product_requirements")) {
    registry.get_product_requirements = tool({
      description:
        "Get the full specification checklist for one product: every detail that must be collected before an order can be created.",
      inputSchema: z.object({
        product: z.string().describe("The product name the customer wants"),
      }),
      execute: traced(trace, "get_product_requirements", async ({ product }) => {
        const result = await ctx.runQuery(internal.products.requirementsForTool, {
          workspaceId: workspace._id,
          product,
        });

        // Which control each field wants, decided here where the option
        // counts are, rather than left to the model to remember. Reply buttons
        // hold three; anything more has to be a list.
        if (!enabled.has("rich_messages") || !result.found) return result;
        const choices = [
          ...(result.product?.requiredFields ?? []),
          ...(result.product?.optionalFields ?? []),
        ].filter((field) => (field.options?.length ?? 0) >= 2);
        const asButtons = choices.filter((f) => (f.options?.length ?? 0) <= 3);
        const asList = choices.filter((f) => (f.options?.length ?? 0) > 3);

        const note = [
          asButtons.length > 0
            ? `Ask with send_buttons, one field at a time: ${asButtons
                .map((f) => f.label)
                .join(", ")}.`
            : null,
          asList.length > 0
            ? `Ask with send_list — more than three options, which reply buttons cannot hold: ${asList
                .map((f) => `${f.label} (${f.options?.length})`)
                .join(", ")}.`
            : null,
          choices.length > 0
            ? "Never also write the options out in your own text; the control shows them, and doing both asks twice."
            : null,
        ]
          .filter(Boolean)
          .join(" ");

        return { ...result, ...(note ? { note } : {}) };
      }),
    });
  }

  if (enabled.has("save_contact_detail")) {
    registry.save_contact_detail = tool({
      description:
        "Save a detail you learned about the customer so it is remembered next time — name, email, company, or any stated preference.",
      inputSchema: z.object({
        field: z
          .string()
          .describe(
            "One of name, email, phone, company, birthday, or a short snake_case label for anything else"
          ),
        value: z.string(),
      }),
      execute: traced(trace, "save_contact_detail", async ({ field, value }) => {
        return await ctx.runMutation(
          internal.conversations.saveContactDetail,
          { contactId: turn.contactId, field, value }
        );
      }),
    });
  }

  if (enabled.has("escalate_to_human")) {
    registry.escalate_to_human = tool({
      description:
        "Hand this conversation to a human colleague. Use it when the customer asks for a person, raises a complaint, or needs something outside what you can do.",
      inputSchema: z.object({
        reason: z.string().describe("Why a human is needed, in one sentence"),
        department: z
          .enum(["sales", "support", "accounts", "other"])
          .describe("Which team should pick this up"),
        summary: z
          .string()
          .describe("A short handover summary of the conversation so far"),
      }),
      execute: traced(trace, "escalate_to_human", async (input) => {
        await ctx.runMutation(internal.conversations.markEscalated, {
          conversationId: turn.conversationId,
        });
        await ctx.runAction(internal.webhooks.deliver, {
          workspaceId: workspace._id,
          event: "escalation",
          data: {
            reason: input.reason,
            department: input.department,
            summary: input.summary,
            agent: agent.botName,
            conversationId: turn.conversationId,
            contact: turn.contact,
          },
        });
        return {
          ok: true,
          message:
            "The team has been notified. Tell the customer a colleague will be in touch, and do not promise a specific time.",
        };
      }),
    });
  }

  if (enabled.has("transfer_to_agent") && routing.allowTransfer) {
    const roster = routing.team.map((mate) => mate.key);
    registry.transfer_to_agent = tool({
      description:
        "Hand this conversation to the AI colleague best suited to it. They answer the customer's current message directly — the customer never learns a transfer happened. Call this instead of offering to connect, transfer or put the customer through to anyone, and instead of asking whether they would like that. After calling it, stop: write nothing else. " +
        `Colleagues you may transfer to: ${roster.join(", ")}.`,
      inputSchema: z.object({
        agent: z
          .string()
          .describe(
            `Which colleague takes over. One of: ${roster.join(", ")}.`
          ),
        reason: z
          .string()
          .describe("Why they are the right colleague, in one sentence"),
        summary: z
          .string()
          .describe(
            "Everything you have learned from the customer so far, as compact facts: what they want, quantities, names, dates, anything already answered."
          ),
      }),
      execute: async (input) => {
        const resolved = await ctx.runQuery(
          internal.agents.resolveHandoffTarget,
          {
            workspaceId: workspace._id,
            agentId: agent._id,
            target: input.agent,
            excludeAgentIds: routing.alreadyHeld,
          }
        );

        if (!resolved.found) {
          // A value error, not a thrown failure: the model can pick again from
          // the list, or decide to answer the customer itself.
          const failure = {
            ok: false,
            error: `There is no colleague called "${input.agent}".`,
            available: resolved.available,
            note:
              resolved.available.length > 0
                ? "Use one of the keys in `available`, exactly as written, or answer the customer yourself."
                : "Nobody is available to take this. Answer the customer yourself, or escalate to a human.",
          };
          record(trace, "transfer_to_agent", input, failure, false);
          return failure;
        }

        turn.pendingTransfer = {
          agentId: resolved.agentId,
          botName: resolved.botName,
          reason: input.reason.trim() || "no reason given",
          summary: input.summary.trim(),
        };

        return {
          ok: true,
          transferredTo: resolved.key,
          message:
            "Handed over. Stop now and write nothing further — your colleague replies to the customer.",
        };
      },
    });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Rich messages
//
// Buttons, lists, media, pins and cards, on both channels. On WhatsApp they go
// out over the Cloud API; on the web widget the chat renders the same payload
// itself. Either way the message is recorded, so the transcript shows what the
// customer was actually shown and the model remembers having shown it.
//
// Each of these sends immediately, alongside the turn's text reply rather than
// instead of it — so every result tells the model not to repeat the contents in
// prose, which is the failure mode once a tool has already spoken.
// ---------------------------------------------------------------------------

// Kinds that put the question to the customer themselves, so the agent has
// nothing left to say this turn.
const ASKS_ITS_OWN_QUESTION = new Set<Outbound["kind"]>([
  "buttons",
  "list",
  "cta_url",
  "flow",
  "request_location",
  "request_address",
  "product",
  "product_list",
  "catalog",
]);

const ALREADY_ASKED =
  "You have already put a question to the customer this turn. They can only answer one, and a second would bury the first — wait for their reply before asking the next thing.";

type Delivered =
  | { ok: true; note: string }
  | { ok: false; error: string };

/**
 * Sends one rich message on the conversation's channel and records it.
 *
 * Shared by the rich-message tools and the Magic apps' tools, which end in the
 * same link button and must obey the same one-question-per-turn rule.
 */
function makeDeliver(ctx: ActionCtx, turn: TurnContext) {
  const { workspace, agent, conversationId, channelId, externalId, channelType } =
    turn;

  return async (message: Outbound): Promise<Delivered> => {
    if (ASKS_ITS_OWN_QUESTION.has(message.kind)) {
      if (turn.askedThisTurn) {
        return { ok: false, error: ALREADY_ASKED };
      }
      turn.askedThisTurn = true;
      turn.askedBy = agent._id;
    }

    // Send first, record second. A payload the provider rejected must not sit
    // in the transcript as something the customer saw.
    let wamid: string | undefined;
    if (channelType === "whatsapp") {
      if (!channelId || !externalId) {
        throw new ConvexError("This conversation has no WhatsApp channel to send on.");
      }
      const result: { ok: boolean; error?: string; wamid?: string } =
        await ctx.runAction(internal.whatsapp.sendOutbound, {
          channelId,
          to: externalId,
          message,
          source: "agent",
          conversationId,
        });
      if (!result.ok) {
        throw new ConvexError(
          result.error ?? "WhatsApp would not accept that message."
        );
      }
      wamid = result.wamid;
    }

    await ctx.runMutation(internal.conversations.recordRichMessage, {
      workspaceId: workspace._id,
      conversationId,
      agentId: agent._id,
      summary: summarise(message),
      payload: JSON.stringify(message),
      whatsapp: channelType === "whatsapp" ? { wamid } : undefined,
    });

    return {
      ok: true,
      note: ASKS_ITS_OWN_QUESTION.has(message.kind)
        ? "Sent, and it is your whole reply for this turn — it already asks the question and shows the options. Write nothing further: whatever you add arrives as a second bubble underneath, asking again."
        : "Sent. The customer can see it, so add at most one short line and never describe what is in it.",
    };
  };
}

function buildRichMessageTools(ctx: ActionCtx, turn: TurnContext): ToolSet {
  const { trace } = turn;
  const deliver = makeDeliver(ctx, turn);

  // A header is optional on most of these, and is either a line of text or an
  // image. Shared so the four tools that take one agree on the shape.
  const headerSchema = {
    headerText: z
      .string()
      .optional()
      .describe("Short bold line above the body. Max 60 characters."),
    headerImageUrl: z
      .string()
      .optional()
      .describe(
        "Public https URL of an image to show above the body. Use instead of headerText, not as well."
      ),
  };
  const headerFrom = (input: {
    headerText?: string;
    headerImageUrl?: string;
  }): HeaderSpec | undefined =>
    input.headerImageUrl
      ? { type: "image", media: { link: input.headerImageUrl } }
      : input.headerText
        ? { type: "text", text: input.headerText }
        : undefined;

  const registry: ToolSet = {};

  registry.send_buttons = tool({
    description:
      "Send the customer up to three tappable quick-reply buttons. Use it whenever you would otherwise ask them to type one of a short set of choices — confirming a summary, picking a service, answering yes or no. Tapping one sends its label back as their next message. Write the body as the question; do not also list the options in it. THREE IS A HARD LIMIT: with four or more choices use send_list instead. Never drop options to make them fit — a size menu missing XL is worse than a list.",
    inputSchema: z.object({
      body: z.string().describe("The question or prompt. Max 1024 characters."),
      buttons: z
        .array(
          z
            .string()
            .describe(
              "Button label. Twenty characters, hard — write 'Classic tee', not 'Classic Cotton T-Shirt', which is cut short on the phone. Shorten it yourself rather than letting it be trimmed."
            )
        )
        .min(1)
        .max(3),
      footer: z.string().optional().describe("Small grey line underneath"),
      ...headerSchema,
    }),
    execute: traced(trace, "send_buttons", async (input) =>
      deliver({
        kind: "buttons",
        body: input.body,
        footer: input.footer,
        header: headerFrom(input),
        // id mirrors the label, as the provider's own examples do; the inbound
        // webhook reads the title back, so the two must not disagree.
        buttons: input.buttons.map((title) => ({ id: title, title })),
      })
    ),
  });

  registry.send_list = tool({
    description:
      "Send a scrollable menu of options, grouped into sections. Use it when there are more than three choices — a service list, a product range, appointment slots. Ten rows in total at most, across every section. The customer taps one and its title comes back as their next message.",
    inputSchema: z.object({
      body: z.string().describe("What the list is for. Max 1024 characters."),
      buttonText: z
        .string()
        .describe("Label on the button that opens the list, max 20 characters"),
      sections: z
        .array(
          z.object({
            title: z.string().describe("Section heading, max 24 characters"),
            rows: z
              .array(
                z.object({
                  title: z.string().describe("Option label, max 24 characters"),
                  description: z
                    .string()
                    .optional()
                    .describe("One line under the label, max 72 characters"),
                })
              )
              .min(1),
          })
        )
        .min(1)
        .max(10),
      footer: z.string().optional(),
      ...headerSchema,
    }),
    execute: traced(trace, "send_list", async (input) =>
      deliver({
        kind: "list",
        body: input.body,
        buttonText: input.buttonText,
        footer: input.footer,
        header: headerFrom(input),
        sections: input.sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.title,
            title: row.title,
            description: row.description,
          })),
        })),
      })
    ),
  });

  registry.send_media = tool({
    description:
      "Send an image, a PDF or a video with a caption — a product photo, a price list, a brochure, a spec sheet. The file must already be on a public https URL; you cannot attach something you do not have a link for.",
    inputSchema: z.object({
      media: z.enum(["image", "document", "video"]),
      url: z.string().describe("Public https URL of the file"),
      caption: z
        .string()
        .optional()
        .describe("Shown under the file. Max 1024 characters."),
      filename: z
        .string()
        .optional()
        .describe("Documents only — the name the customer sees when saving it"),
    }),
    execute: traced(trace, "send_media", async (input) =>
      deliver({
        kind: "media",
        media: input.media,
        source: { link: input.url },
        caption: input.caption,
        filename: input.filename,
      })
    ),
  });

  registry.send_link_button = tool({
    description:
      "Send a message with one button that opens a web page — a booking form, a catalogue, a payment page, a map. Use this rather than pasting a bare URL into your reply.",
    inputSchema: z.object({
      body: z.string().describe("Why they should tap it"),
      displayText: z
        .string()
        .describe("Button label, max 20 characters, e.g. 'View catalogue'"),
      url: z.string().describe("The https URL the button opens"),
      footer: z.string().optional(),
      ...headerSchema,
    }),
    execute: traced(trace, "send_link_button", async (input) =>
      deliver({
        kind: "cta_url",
        body: input.body,
        displayText: input.displayText,
        url: input.url,
        footer: input.footer,
        header: headerFrom(input),
      })
    ),
  });

  registry.request_location = tool({
    description:
      "Ask the customer to share their location, with a button that opens their map picker. Far more reliable than asking them to type an address when what you need is a point on a map — a delivery pin, a site visit, the nearest branch.",
    inputSchema: z.object({
      body: z.string().describe("Why you need it, in one sentence"),
    }),
    execute: traced(trace, "request_location", async (input) =>
      deliver({ kind: "request_location", body: input.body })
    ),
  });

  registry.request_address = tool({
    description:
      "Ask for a full delivery address using WhatsApp's own address form, which returns it as structured fields rather than as prose you have to interpret. Use it when you need a postal address for an order.",
    inputSchema: z.object({
      body: z.string().describe("Why you need it, in one sentence"),
      country: z
        .string()
        .length(2)
        .describe(
          "Two-letter ISO country code the form should be laid out for, e.g. IN or GB"
        ),
    }),
    execute: traced(trace, "request_address", async (input) =>
      deliver({
        kind: "request_address",
        body: input.body,
        country: input.country.toUpperCase(),
      })
    ),
  });

  registry.send_location = tool({
    description:
      "Send a pin on the map — the shop, the office, a site. It opens in the customer's map app and can be navigated to, which a typed address cannot. Only send coordinates you actually have from the knowledge base or company facts; never estimate them.",
    inputSchema: z.object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional().describe("What is at that pin"),
      address: z.string().optional().describe("The address, as one line"),
    }),
    execute: traced(trace, "send_location", async (input) =>
      deliver({
        kind: "location",
        latitude: input.latitude,
        longitude: input.longitude,
        name: input.name,
        address: input.address,
      })
    ),
  });

  registry.send_contact_card = tool({
    description:
      "Send a saveable contact card — a colleague's or the company's number — so the customer can tap to call or save it instead of copying digits out of a chat. Use it when handing someone to a person, alongside escalate_to_human rather than in place of it.",
    inputSchema: z.object({
      name: z.string().describe("The name as it should be saved"),
      phone: z.string().describe("In full international form, e.g. +919876543210"),
      email: z.string().optional(),
      company: z.string().optional(),
      jobTitle: z.string().optional(),
    }),
    execute: traced(trace, "send_contact_card", async (input) =>
      deliver({
        kind: "contacts",
        contacts: [
          {
            formattedName: input.name,
            phones: [
              {
                phone: input.phone,
                type: "WORK",
                waId: input.phone.replace(/\D/g, "") || undefined,
              },
            ],
            ...(input.email
              ? { emails: [{ email: input.email, type: "WORK" }] }
              : {}),
            ...(input.company || input.jobTitle
              ? {
                  org: {
                    ...(input.company ? { company: input.company } : {}),
                    ...(input.jobTitle ? { title: input.jobTitle } : {}),
                  },
                }
              : {}),
          },
        ],
      })
    ),
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Custom tools defined in the dashboard (or drafted by the model)
// ---------------------------------------------------------------------------

async function executeHttpTool(
  toolDoc: Doc<"tools">,
  input: Record<string, unknown>
): Promise<unknown> {
  const config = toolDoc.http;
  if (!config) throw new ConvexError("This tool has no HTTP configuration");

  const url = new URL(renderTemplate(config.urlTemplate, input, true));

  // Anything the template didn't consume rides along as a query parameter
  const leftovers = unusedParameterKeys(toolDoc.parameters, [
    config.urlTemplate,
    config.bodyTemplate,
  ]);
  for (const key of leftovers) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  for (const header of config.headers) {
    if (header.key.trim()) {
      headers[header.key.trim()] = renderTemplate(header.value, input);
    }
  }

  let body: string | undefined;
  if (config.method !== "GET" && config.method !== "DELETE") {
    body = config.bodyTemplate?.trim()
      ? renderTemplate(config.bodyTemplate, input)
      : JSON.stringify(input);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS
  );

  try {
    const response = await fetch(url.toString(), {
      method: config.method,
      headers,
      body,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* plain text response */
    }

    return {
      ok: response.ok,
      status: response.status,
      data:
        typeof parsed === "string"
          ? truncate(parsed, MAX_TOOL_OUTPUT_CHARS)
          : parsed,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ConvexError("The request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCustomTools(
  ctx: ActionCtx,
  turn: TurnContext,
  customTools: Doc<"tools">[]
): ToolSet {
  const registry: ToolSet = {};

  for (const toolDoc of customTools) {
    const description = [toolDoc.description, toolDoc.whenToUse]
      .filter(Boolean)
      .join(" ");

    registry[toolDoc.name] = dynamicTool({
      description,
      inputSchema: jsonSchema(parametersToJsonSchema(toolDoc.parameters)),
      execute: traced(turn.trace, toolDoc.name, async (rawInput: unknown) => {
        const input = (rawInput ?? {}) as Record<string, unknown>;
        await ctx.runMutation(internal.tools.recordCall, {
          toolId: toolDoc._id,
        });

        if (toolDoc.kind === "http") {
          return await executeHttpTool(toolDoc, input);
        }

        const config = toolDoc.dbQuery;
        if (!config) throw new ConvexError("This tool has no query configuration");
        const searchValue = config.searchParam
          ? input[config.searchParam]
          : undefined;
        const rows = await ctx.runQuery(internal.tools.runDbQuery, {
          workspaceId: turn.workspace._id,
          table: config.table,
          search:
            searchValue === undefined || searchValue === null
              ? undefined
              : String(searchValue),
          limit: config.limit,
        });
        return { count: rows.length, rows };
      }),
    });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Record tools
//
// One book becomes up to three tools named after it — `file_membership`,
// `find_membership`, `update_membership` — rather than one generic
// `create_record(type)`. The model picks a tool far more reliably than it picks
// a string argument, and the tool list is then a readable description of what
// this particular agent's job actually is.
//
// `dynamicTool` because the input schema comes out of the book's fields at
// runtime, so there is no static type to give `tool()`.
// ---------------------------------------------------------------------------

/** The book's fields, plus the person the record is about. */
function recordInputSchema(fields: RecordField[], forUpdate: boolean) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const field of fields) {
    const key = field.key.trim();
    if (!key) continue;

    const property: Record<string, unknown> = {
      // Everything crosses as a string. A date the customer gave as "next
      // Tuesday" and a number they gave as "about 20" are both worth keeping
      // verbatim, and a typed schema would make the model discard or invent
      // rather than pass them on.
      type: "string",
      description: [
        field.label,
        field.type === "select" && field.options?.length
          ? ` — one of: ${field.options.join(", ")}`
          : "",
        field.type === "boolean" ? " — yes or no" : "",
        field.type === "date" ? " — a date, ideally YYYY-MM-DD" : "",
        field.type === "number" ? " — a number" : "",
        field.example ? `. Example: ${field.example}` : "",
      ].join(""),
    };
    if (field.type === "select" && field.options?.length) {
      property.enum = field.options;
    }
    properties[key] = property;
    // On an update the model is changing one detail, not restating all of them.
    if (field.required && !forUpdate) required.push(key);
  }

  properties.personName = {
    type: "string",
    description: "Who this record is about, if it is not the person you are talking to or you have only just learned their name",
  };
  properties.personPhone = { type: "string", description: "Their phone number" };
  properties.personEmail = { type: "string", description: "Their email address" };
  properties.personCompany = { type: "string", description: "Their company" };
  properties.notes = {
    type: "string",
    description:
      "Anything else worth recording that has no field of its own. Not a summary of the conversation.",
  };

  return {
    type: "object" as const,
    properties,
    required,
    additionalProperties: false as const,
  };
}

function splitPerson(input: Record<string, unknown>): {
  person?: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
  };
  notes?: string;
  details: Record<string, unknown>;
} {
  const text = (value: unknown) => {
    const asString = value === undefined || value === null ? "" : String(value).trim();
    return asString || undefined;
  };

  const person = {
    name: text(input.personName),
    phone: text(input.personPhone),
    email: text(input.personEmail),
    company: text(input.personCompany),
  };

  const details = { ...input };
  delete details.personName;
  delete details.personPhone;
  delete details.personEmail;
  delete details.personCompany;
  delete details.notes;

  const hasPerson = Object.values(person).some(Boolean);
  return {
    person: hasPerson ? person : undefined,
    notes: text(input.notes),
    details,
  };
}

function buildRecordTools(
  ctx: ActionCtx,
  turn: TurnContext,
  books: Doc<"recordBooks">[]
): ToolSet {
  const { workspace, agent, trace } = turn;
  const registry: ToolSet = {};

  for (const book of books) {
    const names = recordToolNames(book.handle);
    const fields = book.fields as RecordField[];
    const one = book.name.toLowerCase();

    registry[names.file] = dynamicTool({
      description: [
        `Record ${one === book.name ? `a ${one}` : `a ${one}`} once you have collected every required detail and the customer has confirmed it back to you.`,
        book.purpose.trim(),
        "Never call this with placeholder or invented values — ask the customer instead.",
      ]
        .filter(Boolean)
        .join(" "),
      inputSchema: jsonSchema(recordInputSchema(fields, false)),
      execute: traced(trace, names.file, async (rawInput: unknown) => {
        const input = (rawInput ?? {}) as Record<string, unknown>;
        const { person, notes, details } = splitPerson(input);
        const checked = checkValues(fields, details);

        // Thrown rather than returned, so the AI SDK feeds it back as a tool
        // error and the model treats it as "go and ask", not as a result it
        // can report to the customer as success.
        if (checked.missing.length > 0) {
          throw new ConvexError(
            `Not filed — still missing: ${checked.missing.join(", ")}. Ask the customer for those, then call this again with everything.`
          );
        }
        if (checked.problems.length > 0) {
          throw new ConvexError(`Not filed. ${checked.problems.join(" ")}`);
        }

        const filed = await ctx.runMutation(internal.records.fileFromTool, {
          bookId: book._id,
          agentId: agent._id,
          conversationId: turn.conversationId,
          contactId: turn.contactId,
          source: turn.channelType === "whatsapp" ? "whatsapp" : "web",
          person:
            person ??
            (turn.contact.name || turn.contact.phone
              ? {
                  name: turn.contact.name,
                  phone: turn.contact.phone,
                  email: turn.contact.email,
                  company: turn.contact.company,
                }
              : undefined),
          values: checked.values,
          notes,
        });

        return {
          ok: true,
          reference: filed.reference,
          stage: filed.stage,
          message: `Recorded as ${filed.reference}. Give the customer that reference and tell them what happens next.`,
        };
      }),
    });

    if (book.allowLookup) {
      registry[names.find] = dynamicTool({
        description: `Look up an existing ${one} — by the reference the customer quotes, by a name or detail they give, or, with no arguments at all, whatever this customer already has on file.`,
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            reference: {
              type: "string",
              description: `The reference the customer quoted, such as ${book.referencePrefix}-H4K82Q`,
            },
            search: {
              type: "string",
              description:
                "A name, phone number, email or other detail to search on",
            },
          },
          required: [] as string[],
          additionalProperties: false as const,
        }),
        execute: traced(trace, names.find, async (rawInput: unknown) => {
          const input = (rawInput ?? {}) as Record<string, unknown>;
          const rows = await ctx.runQuery(internal.records.findForTool, {
            bookId: book._id,
            workspaceId: workspace._id,
            reference: input.reference ? String(input.reference) : undefined,
            search: input.search ? String(input.search) : undefined,
            contactId: turn.contactId,
            limit: 5,
          });

          if (rows.length === 0) {
            return {
              found: false,
              note: `No ${book.pluralName.toLowerCase()} matched. Say so plainly rather than guessing, and offer to take the details for a new one.`,
            };
          }

          return {
            found: true,
            count: rows.length,
            results: rows.map((row) => ({
              reference: row.reference,
              stage: row.stage ?? null,
              person: row.person ?? null,
              details: Object.fromEntries(
                row.values.map((pair) => [pair.key, pair.value])
              ),
              notes: row.notes ?? null,
              filedOn: new Date(row.createdAt).toISOString().slice(0, 10),
            })),
          };
        }),
      });
    }

    if (book.allowUpdate) {
      const updateSchema = recordInputSchema(fields, true);
      registry[names.update] = dynamicTool({
        description: [
          `Change an existing ${one} rather than filing a second one.`,
          book.allowLookup
            ? `Find its reference with ${names.find} first if the customer has not quoted one.`
            : "",
          "Pass only the details that are changing.",
        ]
          .filter(Boolean)
          .join(" "),
        inputSchema: jsonSchema({
          ...updateSchema,
          properties: {
            reference: {
              type: "string",
              description: `Which one to change, by its reference, e.g. ${book.referencePrefix}-H4K82Q`,
            },
            ...(book.stages.length > 0
              ? {
                  stage: {
                    type: "string",
                    description: `Move it to a different stage. One of: ${book.stages.join(", ")}`,
                    enum: book.stages,
                  },
                }
              : {}),
            ...updateSchema.properties,
          },
          required: ["reference"],
        }),
        execute: traced(trace, names.update, async (rawInput: unknown) => {
          const input = (rawInput ?? {}) as Record<string, unknown>;
          const reference = String(input.reference ?? "").trim();
          if (!reference) {
            throw new ConvexError(
              "Which one? Pass the reference of the record to change."
            );
          }

          const found = await ctx.runQuery(internal.records.findForTool, {
            bookId: book._id,
            workspaceId: workspace._id,
            reference,
            limit: 1,
          });
          const existing = found[0];
          if (!existing) {
            throw new ConvexError(
              `No ${one} has the reference ${reference}. Check it with the customer rather than filing a new one.`
            );
          }

          const stage = input.stage ? String(input.stage) : undefined;
          if (stage && !book.stages.includes(stage)) {
            throw new ConvexError(
              `"${stage}" is not one of the stages. They are: ${book.stages.join(", ")}.`
            );
          }

          const rest = { ...input };
          delete rest.reference;
          delete rest.stage;
          const { person, notes, details } = splitPerson(rest);
          const checked = checkValues(fields, details);
          if (checked.problems.length > 0) {
            throw new ConvexError(`Not changed. ${checked.problems.join(" ")}`);
          }
          // `missing` is ignored on purpose: an update carries the one detail
          // that changed, and demanding the rest back would make the model
          // re-ask the customer for everything it already filed.

          const changed = await ctx.runMutation(
            internal.records.updateFromTool,
            {
              recordId: existing._id,
              bookId: book._id,
              person,
              values: checked.values,
              stage,
              notes,
            }
          );

          return {
            ok: true,
            reference: changed.reference,
            stage: changed.stage ?? null,
            message: `${book.name} ${changed.reference} updated. Confirm the change back to the customer.`,
          };
        }),
      });
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Magic apps
//
// `send_form` and `send_offer`, each built only for an agent that has the app
// switched on and only when the app has something to send. Both end in the
// same link button as send_link_button — what makes them more than that is
// the ref: minted here, filed against this conversation, carried by the link,
// and handed back with the result so it lands in this thread.
// ---------------------------------------------------------------------------

/** An app's copy of its forms or offers is re-read once it is older than this. */
const APP_ITEMS_STALE_MS = 30 * 60 * 1000;

function buttonLabel(given: unknown, fallback: string): string {
  const text = typeof given === "string" ? given.trim() : "";
  const label = text || fallback;
  return label.length <= BUTTON_TEXT_MAX
    ? label
    : `${label.slice(0, BUTTON_TEXT_MAX - 1)}…`;
}

function buildAppTools(
  ctx: ActionCtx,
  turn: TurnContext,
  connections: Doc<"appConnections">[]
): ToolSet {
  const { trace } = turn;
  const deliver = makeDeliver(ctx, turn);
  const registry: ToolSet = {};

  // What the apps prefill from. On WhatsApp the external id is the number
  // even when the contact row has not stored it yet.
  const known = {
    name: turn.contact.name,
    phone: formatPhone(
      turn.contact.phone ??
        (turn.channelType === "whatsapp" ? turn.externalId : undefined)
    ),
    email: turn.contact.email,
    company: turn.contact.company,
    attributes: turn.contact.attributes,
  };

  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  for (const connection of connections) {
    if (connection.items.length === 0) continue;

    const find = (key: unknown): AppItem => {
      const item = connection.items.find((row) => row.key === String(key ?? ""));
      if (!item) {
        throw new ConvexError(
          `There is no ${connection.app === "magic_forms" ? "form" : "offer"} called "${String(key)}". Use one of: ${connection.items.map((row) => row.key).join(", ")}.`
        );
      }
      return item;
    };

    const fileLink = async (
      item: { key: string; title: string },
      ref: string,
      url: string
    ) =>
      ctx.runMutation(internal.apps.recordLink, {
        connectionId: connection._id,
        ref,
        conversationId: turn.conversationId,
        contactId: turn.contactId,
        agentId: turn.agent._id,
        itemKey: item.key,
        itemTitle: item.title,
        url,
      });

    if (connection.app === "magic_forms") {
      const groups = formGroups(connection.items);
      const fieldList = (fields: AppPrefillField[]) =>
        fields
          .slice(0, 12)
          .map((field) => `${field.key} (${field.label})`)
          .join(", ");
      const catalogue = connection.items
        .map((item) => {
          const fields = fieldList(item.prefill ?? []);
          return [
            `- ${item.key}: ${item.title}`,
            item.description ? ` — ${item.description}` : "",
            item.groupKey ? ` [in group ${item.groupKey}]` : "",
            fields ? `. Can prefill: ${fields}` : "",
          ].join("");
        })
        .join("\n");
      const groupCatalogue = groups
        .map((group) => {
          const fields = fieldList(groupPrefillFields(group));
          return [
            `- ${group.key}: ${group.title} — the customer picks one of: ${group.forms.map((form) => form.title).join(", ")}`,
            fields ? `. Can prefill: ${fields}` : "",
          ].join("");
        })
        .join("\n");

      registry.send_form = dynamicTool({
        description: [
          "Send the customer one of the company's forms, as a button that opens it. Use it when the customer asks for a form, or has to give details a form collects better than a chat — a booking, an application, a detailed enquiry.",
          "Their name, number and email are filled in for them where the form asks; put anything else they have already told you in prefill, so they do not type it twice.",
          'When they submit it, their answers arrive in this conversation as their next message, starting "[Form submitted". Do not ask them to tell you once they are done.',
          `The forms:\n${catalogue}`,
          groups.length > 0
            ? `\nForm groups — one link where the customer picks the form that fits them. Send a group instead of a form when it holds the forms they might need and you cannot tell which one applies:\n${groupCatalogue}`
            : "",
        ].join(" "),
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            form: {
              type: "string",
              enum: connection.items.map((item) => item.key),
              description:
                groups.length > 0
                  ? "Which form, by its key from the list. Leave it out when you send a group."
                  : "Which form, by its key from the list",
            },
            ...(groups.length > 0
              ? {
                  group: {
                    type: "string",
                    enum: groups.map((group) => group.key),
                    description:
                      "Which form group, by its key from the list, instead of a single form",
                  },
                }
              : {}),
            message: {
              type: "string",
              description:
                "Why they should open it, in a sentence or two. Max 1024 characters.",
            },
            buttonText: {
              type: "string",
              description: `Button label, max ${BUTTON_TEXT_MAX} characters. 'Open form' if you leave it out.`,
            },
            prefill: {
              type: "object",
              description:
                "Answers the customer has already given you, keyed by the form's field keys. Only what they actually said — never a guess.",
              additionalProperties: { type: "string" },
            },
          },
          required: groups.length > 0 ? ["message"] : ["form", "message"],
          additionalProperties: false as const,
        }),
        execute: traced(trace, "send_form", async (rawInput: unknown) => {
          const input = (rawInput ?? {}) as Record<string, unknown>;
          if (turn.askedThisTurn) return { ok: false, error: ALREADY_ASKED };

          const groupKey = text(input.group);
          const group = groupKey
            ? groups.find((row) => row.key === groupKey)
            : undefined;
          if (groupKey && !group) {
            throw new ConvexError(
              `There is no form group called "${groupKey}". Use one of: ${groups.map((row) => row.key).join(", ")}.`
            );
          }
          const account = encodeURIComponent(connection.account.slug);
          const target = group
            ? {
                key: group.key,
                title: group.title,
                fields: groupPrefillFields(group),
                path: `/api/v1/links/group/${account}/${encodeURIComponent(group.key)}`,
              }
            : (() => {
                const item = find(input.form);
                return {
                  key: item.key,
                  title: item.title,
                  fields: item.prefill ?? [],
                  path: `/api/v1/links/form/${account}/${encodeURIComponent(item.key)}`,
                };
              })();
          const path = target.path;

          const prefill = buildPrefill(
            target.fields,
            (input.prefill ?? {}) as Record<string, unknown>,
            known
          );
          const ref = randomKey(24);
          // The number the customer is chatting from, saved by Magic Forms on
          // every response through this link — whether or not the form asks
          // for a phone. Only on WhatsApp, where the external id is the
          // number; a web visitor has none to give.
          const whatsapp =
            turn.channelType === "whatsapp"
              ? turn.externalId.replace(/\D/g, "") || undefined
              : undefined;

          let link = await callApp(connection, "POST", path, {
            data: prefill,
            ref,
            whatsapp,
          });
          // The app refuses the whole link over one answer it does not like.
          // A blank form still beats no form, so ask once more without them.
          if (
            !link.ok &&
            (link.status === 400 || link.status === 422) &&
            Object.keys(prefill).length > 0
          ) {
            link = await callApp(connection, "POST", path, {
              data: {},
              ref,
              whatsapp,
            });
          }
          if (!link.ok) {
            if (link.status === 404) {
              await ctx.scheduler.runAfter(0, internal.apps.refreshItems, {
                connectionId: connection._id,
              });
              throw new ConvexError(
                `"${target.title}" is no longer available. Do not offer it again.`
              );
            }
            throw new ConvexError(`The form link could not be made: ${link.error}`);
          }
          const body = link.body as { url?: unknown; warning?: unknown } | null;
          if (group && text(body?.warning)) {
            throw new ConvexError(
              `The "${group.title}" group's link is switched off in Magic Forms. Send one of its forms instead: ${group.forms.map((form) => form.key).join(", ")}.`
            );
          }
          const url = text(body?.url);
          if (!url) throw new ConvexError("Magic Forms returned no link.");

          await fileLink(target, ref, url);
          const sent = await deliver({
            kind: "cta_url",
            body: text(input.message) ?? `Please fill in ${target.title}.`,
            displayText: buttonLabel(input.buttonText, "Open form"),
            url,
          });
          if (!sent.ok) return sent;
          return {
            ...sent,
            form: target.title,
            note: `${sent.note} Their answers will arrive here as their next message.`,
          };
        }),
      });
    }

    if (connection.app === "magic_reward") {
      const catalogue = connection.items
        .map((item) => {
          const prizes = (item.prizes ?? [])
            .filter((prize) => prize.isWin)
            .map((prize) => prize.label)
            .join(", ");
          return [
            `- ${item.key}: ${item.title}`,
            item.kind ? ` (${item.kind})` : "",
            prizes ? ` — prizes: ${prizes}` : "",
          ].join("");
        })
        .join("\n");

      registry.send_offer = dynamicTool({
        description: [
          "Send the customer one of the company's running offers — a game such as spin the wheel or a scratch card, where they win a prize — as a button that opens it.",
          "These are the only offers that exist. Offer one when the customer asks about offers, deals or discounts, or when your job says to; never mention, promise or invent any other offer or prize.",
          "Their name and number are filled in for them. Each customer can play each offer once.",
          'When they play, the result arrives in this conversation as their next message, starting "[Played the offer".',
          `The offers:\n${catalogue}`,
        ].join(" "),
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            offer: {
              type: "string",
              enum: connection.items.map((item) => item.key),
              description: "Which offer, by its key from the list",
            },
            message: {
              type: "string",
              description:
                "Why they should open it, in a sentence or two. Max 1024 characters.",
            },
            buttonText: {
              type: "string",
              description: `Button label, max ${BUTTON_TEXT_MAX} characters, e.g. 'Spin the wheel'.`,
            },
          },
          required: ["offer", "message"],
          additionalProperties: false as const,
        }),
        execute: traced(trace, "send_offer", async (rawInput: unknown) => {
          const input = (rawInput ?? {}) as Record<string, unknown>;
          if (turn.askedThisTurn) return { ok: false, error: ALREADY_ASKED };
          const item = find(input.offer);

          const ref = randomKey(24);
          const invite = await callApp(
            connection,
            "POST",
            `/api/v1/offers/${encodeURIComponent(item.id)}/invites`,
            { name: known.name, phone: known.phone, externalRef: ref }
          );
          if (!invite.ok) {
            if (invite.status === 404) {
              await ctx.scheduler.runAfter(0, internal.apps.refreshItems, {
                connectionId: connection._id,
              });
              throw new ConvexError(
                `"${item.title}" is not running any more. Do not offer it again.`
              );
            }
            throw new ConvexError(`The offer link could not be made: ${invite.error}`);
          }

          const body = (invite.body ?? {}) as {
            url?: unknown;
            alreadyPlayed?: unknown;
            prize?: { label?: unknown; isWin?: unknown } | null;
          };
          if (body.alreadyPlayed === true) {
            const label = text(body.prize?.label);
            return {
              ok: true,
              sent: false,
              alreadyPlayed: true,
              prize: label ?? null,
              won: body.prize?.isWin === true,
              note: `Not sent: this customer has already played ${item.title}${label ? ` and got "${label}"` : ""}. Tell them so rather than offering it again.`,
            };
          }
          const url = text(body.url);
          if (!url) throw new ConvexError("Magic Reward returned no link.");

          await fileLink(item, ref, url);
          const sent = await deliver({
            kind: "cta_url",
            body: text(input.message) ?? `You have a chance to win with ${item.title}.`,
            displayText: buttonLabel(
              input.buttonText,
              item.kind && item.kind.length <= BUTTON_TEXT_MAX ? item.kind : "Play now"
            ),
            url,
          });
          if (!sent.ok) return sent;
          return {
            ...sent,
            offer: item.title,
            note: `${sent.note} Their result will arrive here as their next message.`,
          };
        }),
      });
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

const turnArgs = {
  agentId: v.id("agents"),
  channelType: v.union(v.literal("whatsapp"), v.literal("web")),
  channelId: v.optional(v.id("channels")),
  externalId: v.string(),
  contactName: v.optional(v.string()),
  contactPhone: v.optional(v.string()),
  text: v.string(),
};

type TurnArgs = {
  agentId: Id<"agents">;
  channelType: "whatsapp" | "web";
  channelId?: Id<"channels">;
  externalId: string;
  contactName?: string;
  contactPhone?: string;
  text: string;
};

export type TurnResult = {
  ok: boolean;
  text: string | null;
  conversationId: Id<"conversations"> | null;
  replyMessageId?: Id<"messages">;
  toolCalls: string[];
  /** Which agent actually produced `text`. */
  agentId?: Id<"agents">;
  agentBotName?: string;
  /** Every hop this message took, oldest first, e.g. ["Front desk", "Priya"]. */
  handoffPath?: string[];
  /**
   * The customer's message was stored but deliberately left unanswered,
   * because a colleague has taken the thread over. Distinct from `text: null`
   * with an error, which means the turn broke: callers must not report this
   * one as a failure or write it to the channel's error log.
   */
  heldForHuman?: boolean;
  /**
   * The reply was a menu, buttons or a location request rather than prose, so
   * `text` is deliberately empty. Like `heldForHuman`, this is a complete
   * answer and not a failure to produce one.
   */
  answeredWithControl?: boolean;
  error?: string;
};

// The turn itself. Shared so the authorized dashboard path and the WhatsApp
// webhook path cannot drift apart.
//
// One inbound message produces exactly one reply, but not necessarily from the
// agent the channel points at: the entry agent is normally the workspace's
// front desk, which reads the message and hands the turn to a specialist. The
// specialist can hand it on again. The customer sees only the final reply.
async function runTurn(ctx: ActionCtx, args: TurnArgs): Promise<TurnResult> {
    const startedAt = Date.now();

    const message = args.text.trim();
    if (!message) {
      return {
        ok: false,
        text: null,
        conversationId: null,
        toolCalls: [],
        error: "Empty message",
      };
    }

    const loaded = await ctx.runQuery(internal.agents.getInternal, {
      agentId: args.agentId,
    });
    if (!loaded) {
      return {
        ok: false,
        text: null,
        conversationId: null,
        toolCalls: [],
        error: "Agent not found",
      };
    }
    const { workspace } = loaded;
    const entryAgent = loaded.agent;

    if (entryAgent.status === "paused") {
      return {
        ok: false,
        text: null,
        conversationId: null,
        toolCalls: [],
        error: "This agent is paused",
      };
    }

    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
      console.error("engine: AI_GATEWAY_API_KEY is not set");
      return {
        ok: false,
        text: null,
        conversationId: null,
        toolCalls: [],
        error: "The assistant is not available right now.",
      };
    }

    // Persist the inbound message and read back the replay history. The entry
    // agent's historyLimit governs the replay: it is the one agent guaranteed
    // to exist before the conversation is read.
    const session = await ctx.runMutation(internal.conversations.startTurn, {
      workspaceId: workspace._id,
      agentId: entryAgent._id,
      channelId: args.channelId,
      channelType: args.channelType,
      externalId: args.externalId,
      contactName: args.contactName,
      contactPhone: args.contactPhone,
      text: message,
      historyLimit: entryAgent.historyLimit,
      messageLimit:
        workspace.maxMessagesPerConversation ?? DEFAULT_MESSAGES_PER_SESSION,
    });

    if (session.blocked && "optReply" in session && session.optReply) {
      return {
        ok: true,
        text: session.optReply.text,
        conversationId: session.conversationId,
        replyMessageId: session.optReply.messageId,
        toolCalls: [],
      };
    }

    if (session.blocked) {
      return {
        ok: true,
        text: null,
        conversationId: session.conversationId,
        toolCalls: [],
        heldForHuman: true,
      };
    }

    // A colleague is dealing with this thread by hand. The message is already
    // recorded by startTurn above — it belongs in the transcript either way,
    // and the person replying needs to see it — but no agent answers it.
    if (session.humanHandling || session.limitReached) {
      return {
        ok: true,
        text: null,
        conversationId: session.conversationId,
        toolCalls: [],
        heldForHuman: true,
      };
    }

    // A previous turn may have left a specialist in charge. Pick the
    // conversation up where it was left, falling back to the entry agent if
    // that specialist has since been deleted or paused.
    let agent = entryAgent;
    if (session.activeAgentId && session.activeAgentId !== entryAgent._id) {
      const active = await ctx.runQuery(internal.agents.getInternal, {
        agentId: session.activeAgentId,
      });
      if (active && active.agent.status !== "paused") agent = active.agent;
    }

    const turn: TurnContext = {
      workspace,
      agent,
      conversationId: session.conversationId,
      contactId: session.contactId,
      channelType: args.channelType,
      channelId: args.channelId,
      externalId: args.externalId,
      contact: {
        name: session.contact.name ?? undefined,
        phone: session.contact.phone ?? undefined,
        email: session.contact.email ?? undefined,
        company: session.contact.company ?? undefined,
        attributes: session.contact.attributes,
      },
      trace: [],
      pendingTransfer: null,
      askedThisTurn: false,
      askedBy: null,
    };

    const conversationMessages = [
      ...session.history,
      { role: "user" as const, content: message },
    ];


    // Agents that have already held this message. Used both to keep the roster
    // honest and to make a hand-back impossible.
    const alreadyHeld: Id<"agents">[] = [agent._id];
    const handoffPath: string[] = [agent.botName];

    let replyText = "";
    let generationError: string | undefined;
    let handoff: HandoffShape | undefined;
    let hops = 0;

    // Each pass is one agent answering. A pass that ends in a transfer hands
    // over to the next and its own draft text is discarded, so the customer
    // never sees "let me pass you to a colleague".
    for (;;) {
      const team: TeammateShape[] = await ctx.runQuery(
        internal.agents.rosterForAgent,
        {
          workspaceId: workspace._id,
          agentId: agent._id,
          excludeAgentIds: alreadyHeld,
        }
      );
      const allowTransfer = hops < MAX_HANDOFFS_PER_TURN && team.length > 0;

      // Pre-retrieve knowledge for the incoming message so the model has
      // context on the very first step, in addition to the search_knowledge
      // tool. Scoped to the acting agent, so it is redone after a handoff.
      let knowledgeContext = "";
      if (agent.knowledgeEnabled) {
        try {
          const passages = await retrieveKnowledge(ctx, {
            apiKey,
            workspaceId: workspace._id,
            agentId: agent._id,
            queryText: message,
            topK: agent.knowledgeTopK,
            channelType: turn.channelType,
            conversationId: turn.conversationId,
          });
          knowledgeContext = formatKnowledge(passages);
        } catch (error) {
          console.error("[engine] knowledge retrieval failed", error);
        }
      }

      const customTools = await ctx.runQuery(internal.tools.resolveForAgent, {
        workspaceId: workspace._id,
        agentId: agent._id,
      });

      // Re-read after a handoff, like the roster and the knowledge above: the
      // colleague taking the conversation over files into their own books, not
      // the ones the front desk had.
      const books = await ctx.runQuery(internal.records.booksForAgent, {
        agentId: agent._id,
      });

      // Per agent for the same reason: send_form belongs to whoever has it
      // switched on, not to the conversation.
      const apps = await ctx.runQuery(internal.apps.forAgent, {
        agentId: agent._id,
      });
      // Refreshed behind the turn, not in front of it: this turn sends from
      // the copy it has, and the next one gets the fresh list.
      for (const connection of apps) {
        if (Date.now() - connection.syncedAt > APP_ITEMS_STALE_MS) {
          await ctx.scheduler.runAfter(0, internal.apps.refreshItems, {
            connectionId: connection._id,
          });
        }
      }

      const toolset: ToolSet = {
        ...buildBuiltinTools(ctx, turn, apiKey, {
          team,
          allowTransfer,
          alreadyHeld,
        }),
        // Empty unless this agent has the key AND the conversation is on
        // WhatsApp, so the web playground never sees a tool it cannot honour.
        ...(agent.builtinTools.includes("rich_messages")
          ? buildRichMessageTools(ctx, turn)
          : {}),
        ...buildRecordTools(ctx, turn, books),
        ...buildAppTools(ctx, turn, apps),
        ...buildCustomTools(ctx, turn, customTools),
      };

      const system = compileSystemPrompt({
        workspace,
        agent,
        contact: turn.contact,
        knowledgeContext,
        toolNames: Object.keys(toolset),
        team,
        handoff,
        recordBooks: books,
        now: new Date().toISOString(),
      });

      let stepText = "";
      try {
        // Qualified on the way out, so an agent still configured with a bare
        // OpenAI id keeps working through the gateway.
        const model = gatewayModelId(agent.model);
        const result = await generateText({
          model: aiGateway()(model),
          providerOptions: await gatewayOptions(ctx, model),
          instructions: system,
          messages: conversationMessages,
          tools: toolset,
          stopWhen: [
            isStepCount(Math.max(1, Math.min(agent.maxSteps, 12))),
            // Once the handover is requested there is nothing left for this
            // agent to say, so do not pay for another step.
            hasToolCall("transfer_to_agent"),
          ],
          temperature: agent.temperature,
        });

        stepText = result.text.trim();

        // `usage` is the sum across every step, which is what this loop needs:
        // it can run several. Attributed to the agent that spent it, so a
        // routed conversation splits its cost correctly.
        await ctx.runMutation(internal.usage.record, {
          workspaceId: workspace._id,
          agentId: agent._id,
          conversationId: turn.conversationId,
          source: "chat",
          channelType: args.channelType,
          model: agent.model,
          kind: "chat",
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        });

        // When the loop stops on a tool call the final text can be empty —
        // fall back to the last step that produced any.
        if (!stepText && Array.isArray(result.steps)) {
          for (let i = result.steps.length - 1; i >= 0; i--) {
            const text = result.steps[i]?.text?.trim();
            if (text) {
              stepText = text;
              break;
            }
          }
        }
      } catch (error) {
        console.error(
          "[engine] generation failed",
          error instanceof Error ? error.message : String(error)
        );
        generationError = "The assistant could not reply. Please try again.";
      }

      const requested = turn.pendingTransfer;
      turn.pendingTransfer = null;

      // A transfer that came back after the budget was spent is ignored: the
      // agent holding the conversation has to answer it.
      if (!requested || !allowTransfer || generationError) {
        replyText = stepText;
        break;
      }

      const target = await ctx.runQuery(internal.agents.getInternal, {
        agentId: requested.agentId,
      });
      if (!target || target.agent.status === "paused") {
        // The colleague went away between the roster read and the handover.
        replyText = stepText;
        break;
      }

      await ctx.runMutation(internal.conversations.recordHandoff, {
        workspaceId: workspace._id,
        conversationId: turn.conversationId,
        fromAgentId: agent._id,
        toAgentId: target.agent._id,
        fromBotName: agent.botName,
        toBotName: target.agent.botName,
        reason: requested.reason,
        summary: requested.summary,
      });

      handoff = {
        fromBotName: agent.botName,
        reason: requested.reason,
        summary: requested.summary,
      };
      agent = target.agent;
      turn.agent = agent;
      alreadyHeld.push(agent._id);
      handoffPath.push(agent.botName);
      hops++;
    }

    // A menu, a set of buttons or a location request is the whole reply: it
    // already carries the body text and puts the question. Whatever the model
    // writes alongside arrives as a second bubble underneath, asking the same
    // thing again in different words — which is what the tool result tells it
    // not to do, and what it does anyway often enough to be worth enforcing
    // here rather than hoping.
    //
    // Only for the agent that sent the control. A colleague it was handed to
    // has its own thing to say, and has not asked anything yet.
    const askedItself =
      turn.askedThisTurn && turn.askedBy === agent._id && !generationError;
    if (askedItself) replyText = "";

    // Only a failure gets a stand-in. A model that chose to say nothing sends
    // nothing: a canned "tell me more" reads as not having listened, and the
    // channel logs the empty turn as "the agent produced no reply" instead.
    if (!replyText && generationError) {
      replyText =
        "Sorry — something went wrong on my side. Could you send that again?";
    }

    const finished = await ctx.runMutation(internal.conversations.finishTurn, {
      workspaceId: workspace._id,
      conversationId: turn.conversationId,
      agentId: agent._id,
      replyText,
      errorText: generationError,
      latencyMs: Date.now() - startedAt,
      toolCalls: turn.trace,
    });

    return {
      ok: !generationError,
      text: replyText,
      // So a channel does not log "the agent produced no reply" over a turn
      // that answered perfectly well with a menu.
      answeredWithControl: askedItself,
      conversationId: turn.conversationId,
      replyMessageId: finished.replyMessageId,
      toolCalls: turn.trace.map((t) => t.toolName),
      agentId: agent._id,
      agentBotName: agent.botName,
      handoffPath,
      error: generationError,
    };
}

export const respond = internalAction({
  args: turnArgs,
  handler: async (ctx, args): Promise<TurnResult> => runTurn(ctx, args),
});

// Same turn, but only for a caller who may use this agent.
export const respondAsUser = action({
  args: turnArgs,
  handler: async (ctx, args): Promise<TurnResult> => {
    await ctx.runQuery(internal.authDb.assertAgent, { agentId: args.agentId });
    return await runTurn(ctx, args);
  },
});

// Same turn again, for an anonymous visitor on an embedded widget.
//
// The caller proves nothing and is given nothing: it passes the channel's
// unguessable key and its own browser session id, and the agent, workspace and
// contact are all resolved from those server-side. Nothing about the model
// configuration, the tool trace or the routing is returned.
const WIDGET_FAILURES: Record<string, string> = {
  unknown_channel: "This chat is no longer available.",
  channel_paused: "This chat is not accepting messages right now.",
  bad_session: "This chat session has expired. Reload the page to start again.",
  not_registered: "Tell us who you are before sending a message.",
};

export const respondFromWidget = action({
  args: {
    channelKey: v.string(),
    sessionId: v.string(),
    text: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; delivered: boolean; error?: string }> => {
    const text = args.text.trim();
    if (!text) {
      return { ok: false, delivered: false, error: "Type a message first." };
    }
    if (text.length > MAX_WIDGET_MESSAGE_CHARS) {
      return {
        ok: false,
        delivered: false,
        error: `Messages are limited to ${MAX_WIDGET_MESSAGE_CHARS} characters.`,
      };
    }

    const resolved = await ctx.runQuery(internal.widget.resolveForSend, {
      channelKey: args.channelKey,
      sessionId: args.sessionId,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        delivered: false,
        error: WIDGET_FAILURES[resolved.reason] ?? "This chat is unavailable.",
      };
    }

    const result = await runTurn(ctx, {
      agentId: resolved.agentId,
      channelType: "web",
      channelId: resolved.channelId,
      externalId: resolved.sessionId,
      contactName: resolved.contactName ?? undefined,
      contactPhone: resolved.contactPhone ?? undefined,
      text,
    });

    // The reply itself arrives through the `widget.session` subscription, so
    // there is nothing to hand back but success. An engine error is reported in
    // general terms: its own text names models, keys and deployment commands.
    if (!result.ok) {
      console.error("[widget] turn failed", result.error);
      return {
        ok: false,
        delivered: true,
        error: "Something went wrong answering that. Please try again.",
      };
    }
    return { ok: true, delivered: true };
  },
});
