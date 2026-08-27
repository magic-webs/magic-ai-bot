"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
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
  type ToolSet,
} from "ai";
import { z } from "zod";
import { compileSystemPrompt } from "./lib/prompt";
import { EMBEDDING_MODEL, truncate } from "./lib/shared";
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

type TurnContext = {
  workspace: Doc<"workspaces">;
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
  }
): Promise<Array<{ text: string; sourceTitle: string }>> {
  const openai = createOpenAI({ apiKey: opts.apiKey });
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: opts.queryText,
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
  apiKey: string
): ToolSet {
  const { workspace, agent, trace } = turn;
  const registry: ToolSet = {};
  const enabled = new Set(agent.builtinTools);

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

export const respond = action({
  args: {
    agentId: v.id("agents"),
    channelType: v.union(v.literal("whatsapp"), v.literal("web")),
    channelId: v.optional(v.id("channels")),
    externalId: v.string(),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    text: string | null;
    conversationId: Id<"conversations"> | null;
    toolCalls: string[];
    error?: string;
  }> => {
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
    const { agent, workspace } = loaded;

    if (agent.status === "paused") {
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

    // Persist the inbound message and read back the replay history.
    const session = await ctx.runMutation(internal.conversations.startTurn, {
      workspaceId: workspace._id,
      agentId: agent._id,
      channelId: args.channelId,
      channelType: args.channelType,
      externalId: args.externalId,
      contactName: args.contactName,
      contactPhone: args.contactPhone,
      text: message,
      historyLimit: agent.historyLimit,
    });

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
    };

    // Pre-retrieve knowledge for the incoming message so the model has context
    // on the very first step, in addition to the search_knowledge tool.
    let knowledgeContext = "";
    if (agent.knowledgeEnabled) {
      try {
        const passages = await retrieveKnowledge(ctx, {
          apiKey,
          workspaceId: workspace._id,
          agentId: agent._id,
          queryText: message,
          topK: agent.knowledgeTopK,
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
      ...buildBuiltinTools(ctx, turn, apiKey),
      ...buildCustomTools(ctx, turn, customTools),
    };

    const system = compileSystemPrompt({
      workspace,
      agent,
      contact: turn.contact,
      knowledgeContext,
      toolNames: Object.keys(toolset),
      now: new Date().toISOString(),
    });

    const openai = createOpenAI({ apiKey });

    let replyText = "";
    let generationError: string | undefined;

    try {
      const result = await generateText({
        model: openai(agent.model),
        system,
        messages: [
          ...session.history,
          { role: "user" as const, content: message },
        ],
        tools: toolset,
        stopWhen: stepCountIs(Math.max(1, Math.min(agent.maxSteps, 12))),
        temperature: agent.temperature,
      });

      replyText = result.text?.trim() ?? "";

      // When the loop stops on a tool call the final text can be empty —
      // fall back to the last step that produced any.
      if (!replyText && Array.isArray(result.steps)) {
        for (let i = result.steps.length - 1; i >= 0; i--) {
          const stepText = result.steps[i]?.text?.trim();
          if (stepText) {
            replyText = stepText;
            break;
          }
        }
      }
    } catch (error) {
      generationError = error instanceof Error ? error.message : String(error);
      console.error("[engine] generation failed", generationError);
    }

    if (!replyText) {
      replyText = generationError
        ? "Sorry — something went wrong on my side. Could you send that again?"
        : "Thanks for your message. Could you tell me a little more about what you need?";
    }

    await ctx.runMutation(internal.conversations.finishTurn, {
      workspaceId: workspace._id,
      conversationId: turn.conversationId,
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
      error: generationError,
    };
  },
});
