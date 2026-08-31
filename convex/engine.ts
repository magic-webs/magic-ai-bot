"use node";

import { v } from "convex/values";
import {
  action,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  embed,
  tool,
  dynamicTool,
  jsonSchema,
  stepCountIs,
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
  EMBEDDING_MODEL,
  MAX_HANDOFFS_PER_TURN,
  MAX_WIDGET_MESSAGE_CHARS,
  truncate,
} from "./lib/shared";
import {
  parametersToJsonSchema,
  renderTemplate,
  unusedParameterKeys,
} from "./lib/toolSchema";

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
  contact: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    attributes: Array<{ key: string; value: string }>;
  };
  trace: ToolTrace[];
  pendingTransfer: PendingTransfer | null;
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
      const message = error instanceof Error ? error.message : String(error);
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
  const openai = createOpenAI({ apiKey: opts.apiKey });
  const { embedding, usage } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
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
        return { count: products.length, products };
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
        return await ctx.runQuery(internal.products.requirementsForTool, {
          workspaceId: workspace._id,
          product,
        });
      }),
    });
  }

  if (enabled.has("create_order")) {
    registry.create_order = tool({
      description:
        "Record the order or enquiry once every required detail has been collected AND the customer has confirmed the summary. Never call this with placeholder values.",
      inputSchema: z.object({
        customerName: z.string().describe("The customer's full name"),
        customerEmail: z.string().optional(),
        customerCompany: z.string().optional(),
        customerPhone: z.string().optional(),
        items: z
          .array(
            z.object({
              productName: z.string(),
              quantity: z.string().describe("Quantity as the customer stated it"),
              specs: z
                .array(
                  z.object({
                    key: z
                      .string()
                      .describe("Specification name, e.g. size, material"),
                    value: z.string(),
                  })
                )
                .describe("Every specification collected for this line"),
            })
          )
          .min(1),
        deliveryAddress: z.string().optional(),
        deliveryCity: z.string().optional(),
        deliveryPostcode: z.string().optional(),
        deliveryCountry: z.string().optional(),
        requiredDate: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: traced(trace, "create_order", async (input) => {
        const items = input.items.filter(
          (item) => item.productName?.trim() && item.quantity?.trim()
        );
        if (items.length === 0) {
          throw new Error(
            "Every line needs a product name and a quantity. Ask the customer for the missing detail instead of calling this again."
          );
        }
        if (!input.customerName?.trim()) {
          throw new Error("The customer's name is required.");
        }

        const { orderId, orderNumber } = await ctx.runMutation(
          internal.orders.createFromTool,
          {
            workspaceId: workspace._id,
            agentId: agent._id,
            conversationId: turn.conversationId,
            contactId: turn.contactId,
            source: turn.channelType === "whatsapp" ? "whatsapp" : "web",
            customer: {
              name: input.customerName.trim(),
              phone: input.customerPhone ?? turn.contact.phone,
              email: input.customerEmail,
              company: input.customerCompany,
            },
            items: items.map((item) => ({
              productName: item.productName.trim(),
              quantity: item.quantity.trim(),
              specs: (item.specs ?? []).filter(
                (spec) => spec.key?.trim() && spec.value?.trim()
              ),
            })),
            delivery:
              input.deliveryAddress ||
              input.deliveryPostcode ||
              input.requiredDate ||
              input.deliveryCity ||
              input.deliveryCountry
                ? {
                    address: input.deliveryAddress,
                    city: input.deliveryCity,
                    postcode: input.deliveryPostcode,
                    country: input.deliveryCountry,
                    requiredDate: input.requiredDate,
                  }
                : undefined,
            notes: input.notes,
            rawPayload: JSON.stringify(input),
          }
        );

        const order = await ctx.runQuery(internal.orders.getForWebhook, {
          orderId,
        });
        await ctx.runAction(internal.webhooks.deliver, {
          workspaceId: workspace._id,
          event: "order_created",
          data: order,
        });

        return {
          ok: true,
          orderNumber,
          message: `Order recorded as ${orderNumber}. Tell the customer their reference number and what happens next.`,
        };
      }),
    });
  }

  if (enabled.has("lookup_orders")) {
    registry.lookup_orders = tool({
      description:
        "Look up orders already placed by the person you are talking to, or one specific order by its reference number.",
      inputSchema: z.object({
        orderNumber: z
          .string()
          .optional()
          .describe("An order reference if the customer gave one"),
      }),
      execute: traced(trace, "lookup_orders", async ({ orderNumber }) => {
        const orders = await ctx.runQuery(
          internal.orders.listForContactInternal,
          {
            workspaceId: workspace._id,
            contactId: turn.contactId,
            orderNumber,
            limit: 10,
          }
        );
        return { count: orders.length, orders };
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
            "One of name, email, phone, company, or a short snake_case label for anything else"
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
// Custom tools defined in the dashboard (or drafted by the model)
// ---------------------------------------------------------------------------

async function executeHttpTool(
  toolDoc: Doc<"tools">,
  input: Record<string, unknown>
): Promise<unknown> {
  const config = toolDoc.http;
  if (!config) throw new Error("This tool has no HTTP configuration");

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
      throw new Error("The request timed out.");
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
        if (!config) throw new Error("This tool has no query configuration");
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
  toolCalls: string[];
  /** Which agent actually produced `text`. */
  agentId?: Id<"agents">;
  agentBotName?: string;
  /** Every hop this message took, oldest first, e.g. ["Front desk", "Priya"]. */
  handoffPath?: string[];
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        text: null,
        conversationId: null,
        toolCalls: [],
        error:
          "OPENAI_API_KEY is not set on the Convex deployment. Run: npx convex env set OPENAI_API_KEY sk-...",
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
    });

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
      contact: {
        name: session.contact.name ?? undefined,
        phone: session.contact.phone ?? undefined,
        email: session.contact.email ?? undefined,
        company: session.contact.company ?? undefined,
        attributes: session.contact.attributes,
      },
      trace: [],
      pendingTransfer: null,
    };

    const conversationMessages = [
      ...session.history,
      { role: "user" as const, content: message },
    ];

    const openai = createOpenAI({ apiKey });

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

      const toolset: ToolSet = {
        ...buildBuiltinTools(ctx, turn, apiKey, {
          team,
          allowTransfer,
          alreadyHeld,
        }),
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
        now: new Date().toISOString(),
      });

      let stepText = "";
      try {
        const result = await generateText({
          model: openai(agent.model),
          system,
          messages: conversationMessages,
          tools: toolset,
          stopWhen: [
            stepCountIs(Math.max(1, Math.min(agent.maxSteps, 12))),
            // Once the handover is requested there is nothing left for this
            // agent to say, so do not pay for another step.
            hasToolCall("transfer_to_agent"),
          ],
          temperature: agent.temperature,
        });

        stepText = result.text?.trim() ?? "";

        // totalUsage, not usage: the agent loop can run several steps and only
        // the total covers all of them. Attributed to the agent that spent it,
        // so a routed conversation splits its cost correctly.
        await ctx.runMutation(internal.usage.record, {
          workspaceId: workspace._id,
          agentId: agent._id,
          conversationId: turn.conversationId,
          source: "chat",
          channelType: args.channelType,
          model: agent.model,
          kind: "chat",
          inputTokens: result.totalUsage?.inputTokens ?? 0,
          outputTokens: result.totalUsage?.outputTokens ?? 0,
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
        generationError = error instanceof Error ? error.message : String(error);
        console.error("[engine] generation failed", generationError);
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

    if (!replyText) {
      replyText = generationError
        ? "Sorry — something went wrong on my side. Could you send that again?"
        : "Thanks for your message. Could you tell me a little more about what you need?";
    }

    await ctx.runMutation(internal.conversations.finishTurn, {
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
      conversationId: turn.conversationId,
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
