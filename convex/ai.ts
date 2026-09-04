"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { aiGateway } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";
import { generateText, Output } from "ai";
import { z } from "zod";
import { DEFAULT_BUILTIN_TOOLS, BUILTIN_TOOLS } from "./lib/shared";

const DRAFT_MODEL = DEFAULT_CHAT_MODEL;

function requireApiKey(): string {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_GATEWAY_API_KEY is not set on the Convex deployment. Run: npx convex env set AI_GATEWAY_API_KEY <key>"
    );
  }
  return apiKey;
}

// ---------------------------------------------------------------------------
// Draft a whole agent configuration from a one-paragraph brief
// ---------------------------------------------------------------------------

const agentDraftSchema = z.object({
  name: z.string().describe("Short internal name for this agent, 2-4 words"),
  botName: z
    .string()
    .describe("The human first name the customer sees, e.g. 'Priya' or 'John'"),
  gender: z
    .enum(["male", "female"])
    .describe(
      "Which the botName reads as. Presentation only — clients use it to pick an avatar, and nothing in the prompt or routing reads it. Pick whichever fits the name you chose."
    ),
  role: z
    .string()
    .describe("Job title, e.g. 'AI Sales Consultant' or 'Support Assistant'"),
  objective: z
    .string()
    .describe("One or two sentences on what a successful conversation achieves"),
  jobDescription: z
    .string()
    .describe(
      "The step-by-step job: how the agent opens, what it qualifies, what it collects, how it closes. 4-8 sentences."
    ),
  greeting: z
    .string()
    .describe("The agent's opening line on a brand new conversation"),
  tone: z.object({
    traits: z.array(z.string()).min(2).max(6),
    avoid: z.array(z.string()).min(2).max(6),
    formality: z.enum(["casual", "neutral", "formal"]),
    emoji: z.enum(["none", "sparing", "expressive"]),
    responseLength: z.enum(["short", "medium", "detailed"]),
    languages: z.array(z.string()).min(1).max(4),
    mirrorUserLanguage: z.boolean(),
    humanVoice: z
      .boolean()
      .describe(
        "True where a short, unpolished texting register suits the business — retail, food, salons, trades. False for regulated, professional or high-formality work."
      ),
  }),
  rules: z
    .array(z.string())
    .min(3)
    .max(10)
    .describe("Concrete 'always do this' instructions specific to this business"),
  guardrails: z
    .array(z.string())
    .min(3)
    .max(10)
    .describe("Concrete 'never do this' instructions specific to this business"),
  escalationPolicy: z
    .string()
    .describe("When and how to hand the conversation to a human"),
  suggestedTools: z
    .array(z.string())
    .describe("Which of the listed builtin tool keys this agent needs"),
});

export const draftAgent = action({
  args: {
    workspaceId: v.id("workspaces"),
    brief: v.string(),
    createIt: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    draft: z.infer<typeof agentDraftSchema>;
    agentId: Id<"agents"> | null;
  }> => {
    // Only an administrator, or this workspace's own users, may spend model
    // credits against it.
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    requireApiKey();
    const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
      internal.workspaces.getInternal,
      { workspaceId: args.workspaceId }
    );
    if (!workspace) throw new Error("Workspace not found");

    const products: Array<{ name: string }> = await ctx.runQuery(
      internal.products.searchForTool,
      { workspaceId: args.workspaceId, limit: 20 }
    );

    const { output, usage } = await generateText({
      model: aiGateway()(DRAFT_MODEL),
      output: Output.object({ schema: agentDraftSchema }),
      instructions: [
        "You design production chat agents for real businesses.",
        "Write instructions that are specific to the business described — never generic filler.",
        "Assume the agent talks to customers on WhatsApp and web chat, so replies must be short.",
        "The agent must never quote prices unless the catalogue carries them, and must never invent lead times or stock.",
        `Available builtin tool keys: ${BUILTIN_TOOLS.map((t) => `${t.key} (${t.summary})`).join("; ")}.`,
      ].join("\n"),
      prompt: [
        `Company: ${workspace.name}`,
        workspace.tagline ? `Tagline: ${workspace.tagline}` : "",
        workspace.industry ? `Industry: ${workspace.industry}` : "",
        workspace.description ? `About: ${workspace.description}` : "",
        `Locale: ${workspace.locale}, currency ${workspace.currency}`,
        workspace.facts.length
          ? `Known facts: ${workspace.facts.map((f) => `${f.key}=${f.value}`).join("; ")}`
          : "",
        products.length
          ? `Catalogue sample: ${products.map((p) => p.name).join(", ")}`
          : "The catalogue is currently empty.",
        "",
        `What this agent should do: ${args.brief}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    await ctx.runMutation(internal.usage.record, {
      workspaceId: args.workspaceId,
      source: "draft_agent",
      model: DRAFT_MODEL,
      kind: "chat",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });

    const validKeys = new Set(BUILTIN_TOOLS.map((t) => t.key));
    const builtinTools = output.suggestedTools.filter((key) =>
      validKeys.has(key as never)
    );

    let agentId: Id<"agents"> | null = null;
    if (args.createIt !== false) {
      agentId = await ctx.runMutation(api.agents.create, {
        workspaceId: args.workspaceId,
        name: output.name,
        botName: output.botName,
        gender: output.gender,
        role: output.role,
        objective: output.objective,
        jobDescription: output.jobDescription,
        greeting: output.greeting,
        tone: output.tone,
        rules: output.rules,
        guardrails: output.guardrails,
        escalationPolicy: output.escalationPolicy,
        builtinTools: builtinTools.length
          ? builtinTools
          : [...DEFAULT_BUILTIN_TOOLS],
      });
    }

    return { draft: output, agentId };
  },
});

// ---------------------------------------------------------------------------
// Draft a custom tool from a plain-language task description
// ---------------------------------------------------------------------------

const toolDraftSchema = z.object({
  name: z
    .string()
    .describe(
      "snake_case identifier the model will call, e.g. check_delivery_slot"
    ),
  displayName: z.string().describe("Human label for the dashboard"),
  description: z
    .string()
    .describe(
      "What the tool does, written for the model that will decide whether to call it"
    ),
  whenToUse: z
    .string()
    .describe("One sentence on exactly when to call it and when not to"),
  kind: z
    .enum(["http", "db_query"])
    .describe(
      "Use db_query when the answer already lives in this workspace's products, orders or contacts tables. Use http when an external API must be called."
    ),
  parameters: z
    .array(
      z.object({
        name: z.string().describe("snake_case parameter name"),
        type: z.enum(["string", "number", "boolean"]),
        description: z.string(),
        required: z.boolean(),
        enumValues: z
          .array(z.string())
          .nullable()
          .describe(
            "Only for string parameters with a fixed set of values, otherwise null"
          ),
      })
    )
    .max(8),
  http: z
    .object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      urlTemplate: z
        .string()
        .describe(
          "Full URL. Reference parameters as {{param_name}}. Use the endpoint the user supplied if there is one, otherwise https://example.com/REPLACE_ME"
        ),
      headers: z.array(z.object({ key: z.string(), value: z.string() })),
      bodyTemplate: z
        .string()
        .nullable()
        .describe(
          "JSON body with {{param_name}} placeholders. Null for GET and DELETE."
        ),
    })
    .nullable()
    .describe("Populated when kind is http, otherwise null"),
  dbQuery: z
    .object({
      table: z.enum(["products", "orders", "contacts"]),
      searchParam: z
        .string()
        .nullable()
        .describe("Which parameter holds the free-text search term"),
      limit: z.number().int().min(1).max(25),
    })
    .nullable()
    .describe("Populated when kind is db_query, otherwise null"),
  notesForHuman: z
    .string()
    .describe("Anything the operator must fill in before enabling this tool"),
});

export const draftTool = action({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    task: v.string(),
    // Endpoint docs, a curl command, or a base URL — anything that helps
    apiHint: v.optional(v.string()),
    autoEnable: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    toolId: Id<"tools">;
    name: string;
    kind: "http" | "db_query";
    notesForHuman: string;
    status: "draft" | "enabled";
  }> => {
    // Only an administrator, or this workspace's own users, may spend model
    // credits against it.
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    requireApiKey();
    const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
      internal.workspaces.getInternal,
      { workspaceId: args.workspaceId }
    );
    if (!workspace) throw new Error("Workspace not found");

    const { output, usage } = await generateText({
      model: aiGateway()(DRAFT_MODEL),
      output: Output.object({ schema: toolDraftSchema }),
      instructions: [
        "You design tools for an LLM chat agent. Output a single tool definition.",
        "Keep the parameter list minimal — only what the agent genuinely has to supply.",
        "Parameter descriptions are read by the model, so make them unambiguous.",
        "If the task can be answered from the workspace's own products, orders or contacts data, choose db_query over http.",
        "For http tools, only invent a URL if the user gave you no endpoint; in that case say so in notesForHuman.",
        "If the operator supplied a credential (API key, bearer token) in the API details, put it in the header value verbatim — they gave it to you deliberately.",
        "Only when no credential was supplied, use the placeholder {{REPLACE_WITH_TOKEN}} and say so in notesForHuman.",
      ].join("\n"),
      prompt: [
        `Workspace: ${workspace.name}${workspace.industry ? ` (${workspace.industry})` : ""}`,
        workspace.description ? `About: ${workspace.description}` : "",
        "",
        `Task the tool must accomplish: ${args.task}`,
        args.apiHint ? `\nAPI details supplied by the operator:\n${args.apiHint}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    await ctx.runMutation(internal.usage.record, {
      workspaceId: args.workspaceId,
      source: "draft_tool",
      model: DRAFT_MODEL,
      kind: "chat",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });

    // Make sure the config matches the kind the model chose.
    const kind = output.kind;
    const http =
      kind === "http"
        ? {
            method: output.http?.method ?? "GET",
            urlTemplate:
              output.http?.urlTemplate ?? "https://example.com/REPLACE_ME",
            headers: output.http?.headers ?? [],
            bodyTemplate: output.http?.bodyTemplate ?? undefined,
            timeoutMs: 12_000,
          }
        : undefined;

    const dbQuery =
      kind === "db_query"
        ? {
            table: output.dbQuery?.table ?? ("products" as const),
            searchParam:
              output.dbQuery?.searchParam ??
              output.parameters.find((p) => p.type === "string")?.name ??
              undefined,
            limit: output.dbQuery?.limit ?? 8,
          }
        : undefined;

    // An HTTP tool with a placeholder endpoint must never go live unreviewed.
    const needsReview =
      kind === "http" &&
      (http!.urlTemplate.includes("REPLACE_ME") ||
        http!.headers.some((h) => h.value.includes("REPLACE_WITH")));

    const autoEnable = (args.autoEnable ?? false) && !needsReview;

    const { toolId, name } = await ctx.runMutation(
      internal.tools.insertDrafted,
      {
        workspaceId: args.workspaceId,
        agentId: args.agentId,
        name: output.name,
        displayName: output.displayName,
        description: output.description,
        whenToUse: output.whenToUse,
        kind,
        parameters: output.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          description: p.description,
          required: p.required,
          enumValues:
            p.type === "string" ? (p.enumValues ?? undefined) : undefined,
        })),
        http,
        dbQuery,
        sourceTask: args.task,
        autoEnable,
      }
    );

    return {
      toolId,
      name,
      kind,
      notesForHuman: needsReview
        ? `${output.notesForHuman} (Left as a draft because the endpoint or credentials still contain placeholders.)`
        : output.notesForHuman,
      status: autoEnable ? "enabled" : "draft",
    };
  },
});

// ---------------------------------------------------------------------------
// Draft a starter catalogue so a new workspace is testable immediately
// ---------------------------------------------------------------------------

const catalogueSchema = z.object({
  products: z
    .array(
      z.object({
        name: z.string(),
        category: z.string(),
        description: z.string(),
        unit: z.string().nullable().describe("e.g. 'per 1000', or null"),
        exampleSpec: z.string().nullable(),
        tags: z.array(z.string()).max(6),
        requirementFields: z
          .array(
            z.object({
              key: z.string().describe("snake_case field key"),
              label: z.string(),
              type: z.enum(["text", "number", "select", "boolean", "date"]),
              required: z.boolean(),
              options: z
                .array(z.string())
                .nullable()
                .describe("Only for type 'select', otherwise null"),
              example: z.string().nullable(),
            })
          )
          .min(2)
          .max(10),
      })
    )
    .min(3)
    .max(12),
});

export const draftCatalogue = action({
  args: {
    workspaceId: v.id("workspaces"),
    brief: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ created: number; updated: number }> => {
    // Only an administrator, or this workspace's own users, may spend model
    // credits against it.
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    requireApiKey();
    const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
      internal.workspaces.getInternal,
      { workspaceId: args.workspaceId }
    );
    if (!workspace) throw new Error("Workspace not found");

    const { output, usage } = await generateText({
      model: aiGateway()(DRAFT_MODEL),
      output: Output.object({ schema: catalogueSchema }),
      instructions: [
        "You build product catalogues for quoting bots.",
        "For each product, requirementFields are the questions a sales agent MUST ask before the team can price it.",
        "Do not include price fields — pricing is done by humans.",
        "Use the locale's spelling conventions.",
      ].join("\n"),
      prompt: [
        `Company: ${workspace.name}`,
        workspace.industry ? `Industry: ${workspace.industry}` : "",
        workspace.description ? `About: ${workspace.description}` : "",
        `Locale: ${workspace.locale}`,
        args.brief ? `\nOperator notes: ${args.brief}` : "",
        "\nProduce the products this company most likely sells.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    await ctx.runMutation(internal.usage.record, {
      workspaceId: args.workspaceId,
      source: "draft_catalogue",
      model: DRAFT_MODEL,
      kind: "chat",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });

    // `null` is how strict structured outputs express "absent"; the Convex
    // validators want the key omitted instead.
    return await ctx.runMutation(api.products.bulkImport, {
      workspaceId: args.workspaceId,
      products: output.products.map((product) => ({
        name: product.name,
        category: product.category,
        description: product.description,
        unit: product.unit ?? undefined,
        exampleSpec: product.exampleSpec ?? undefined,
        tags: product.tags,
        requirementFields: product.requirementFields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          options: field.type === "select" ? (field.options ?? undefined) : undefined,
          example: field.example ?? undefined,
        })),
      })),
    });
  },
});
