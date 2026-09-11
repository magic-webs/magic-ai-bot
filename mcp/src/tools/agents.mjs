/**
 * Agents — the front desk and the specialists it hands over to.
 */

import { z } from "zod";
import { BUILTIN_TOOL_KEYS, toneArg, workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findAgent } from "../lookup.mjs";
import { agentBrief, handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_agents",
    {
      title: "List agents",
      description:
        "Every agent in the workspace. The front desk is the one with kind 'router'; the rest are specialists it routes to.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const agents = await call.query(api.agents.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(agents.map(agentBrief));
    })
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get agent",
      description:
        "One agent's full configuration, plus the system prompt exactly as the model will receive it and the colleagues it can hand over to. Read this before changing an agent — the compiled prompt shows what is actually reaching the model.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().describe("Agent name, customer-facing name, or id"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, agent }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);
      const preview = await call.query(api.agents.previewPrompt, {
        agentId: target._id,
      });
      return ok({
        ...agentBrief(target),
        objective: target.objective,
        jobDescription: target.jobDescription,
        greeting: target.greeting ?? null,
        tone: target.tone,
        rules: target.rules,
        guardrails: target.guardrails,
        escalationPolicy: target.escalationPolicy ?? null,
        promptOverride: target.promptOverride ?? null,
        temperature: target.temperature,
        maxSteps: target.maxSteps,
        historyLimit: target.historyLimit,
        knowledgeTopK: target.knowledgeTopK,
        canHandOverTo: preview?.team ?? [],
        toolsGivenToTheModel: preview?.toolNames ?? [],
        compiledSystemPrompt: preview?.prompt ?? null,
      });
    })
  );

  server.registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Create a specialist agent. It starts as a draft and receives no traffic until its status is active — set routingDescription so the front desk knows when to hand over, then activate it with update_agent. Creating the first agent also provisions the workspace's front desk.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().describe("Internal name, e.g. 'Sales qualifier'"),
        botName: z
          .string()
          .optional()
          .describe("The name customers see, e.g. 'Priya'"),
        gender: z
          .enum(["male", "female"])
          .optional()
          .describe(
            "Which the botName reads as. Presentation only — clients use it to pick an avatar; nothing in the prompt or routing reads it."
          ),
        role: z.string().optional().describe("e.g. 'AI Sales Consultant'"),
        routingDescription: z
          .string()
          .optional()
          .describe(
            "'Hand over to me when…' — the one line the front desk reads when choosing who deals with a conversation. Write a condition, not a job description."
          ),
        objective: z.string().optional(),
        jobDescription: z
          .string()
          .optional()
          .describe("Step by step: how it opens, what it collects, how it closes"),
        greeting: z.string().optional(),
        rules: z.array(z.string()).optional().describe("Hard 'always' instructions"),
        guardrails: z
          .array(z.string())
          .optional()
          .describe("Hard 'never' instructions"),
        escalationPolicy: z.string().optional(),
        model: z.string().optional().describe("Default gpt-4.1-mini"),
        builtinTools: z
          .array(z.enum(BUILTIN_TOOL_KEYS))
          .optional()
          .describe("Defaults to a sensible set including transfer_to_agent"),
      },
    },
    handler(async ({ workspace, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const agentId = await call.mutation(api.agents.create, {
        workspaceId: found._id,
        ...fields,
      });
      return ok({
        agentId,
        status: "draft",
        next: "Set status to 'active' with update_agent so the front desk can hand conversations to it.",
      });
    })
  );

  server.registerTool(
    "update_agent",
    {
      title: "Update agent",
      description:
        "Change any part of an agent. Omitted fields are left alone. Set status to 'active' to put it into the front desk's roster. The front desk itself cannot be paused into a draft and always keeps transfer_to_agent.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().describe("Agent name, customer-facing name, or id"),
        name: z.string().optional(),
        botName: z.string().optional(),
        gender: z
          .enum(["male", "female"])
          .optional()
          .describe("Which the botName reads as. Picks the client's avatar."),
        role: z.string().optional(),
        routingDescription: z.string().optional(),
        acceptsHandoff: z
          .boolean()
          .optional()
          .describe("False takes the agent out of every routing roster"),
        objective: z.string().optional(),
        jobDescription: z.string().optional(),
        greeting: z.string().optional(),
        tone: toneArg,
        rules: z.array(z.string()).optional().describe("Replaces the whole list"),
        guardrails: z.array(z.string()).optional().describe("Replaces the whole list"),
        escalationPolicy: z.string().optional(),
        promptOverride: z
          .string()
          .optional()
          .describe("Appended to the system prompt verbatim"),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxSteps: z.number().int().min(1).max(12).optional().describe("Tool-loop budget"),
        historyLimit: z.number().int().min(1).max(50).optional(),
        knowledgeEnabled: z.boolean().optional(),
        knowledgeTopK: z.number().int().min(1).max(20).optional(),
        builtinTools: z
          .array(z.enum(BUILTIN_TOOL_KEYS))
          .optional()
          .describe("Replaces the whole list"),
        status: z.enum(["draft", "active", "paused"]).optional(),
      },
    },
    handler(async ({ workspace, agent, tone, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);

      // The stored tone is a complete object, so a partial one has to be merged
      // rather than sent through.
      const merged = tone ? { ...target.tone, ...tone } : undefined;

      await call.mutation(api.agents.update, {
        agentId: target._id,
        ...fields,
        ...(merged ? { tone: merged } : {}),
      });
      return ok(`Updated ${target.botName} (${target.name}).`);
    })
  );

  server.registerTool(
    "delete_agent",
    {
      title: "Delete agent",
      description:
        "Permanently delete an agent, with its conversations, channels, agent-scoped knowledge and agent-scoped tools. The front desk cannot be deleted while a channel still points at it.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().describe("Agent name, customer-facing name, or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, agent }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);
      await call.mutation(api.agents.remove, { agentId: target._id });
      return ok(`Deleted ${target.botName} (${target.name}) and everything scoped to it.`);
    })
  );

  server.registerTool(
    "draft_agent",
    {
      title: "Draft an agent from a brief",
      description:
        "Have the platform's own model write a whole agent configuration — persona, tone, rules, guardrails, tools — from a paragraph describing the job. Uses the workspace's description, facts and catalogue as context, and costs tokens against the workspace. Review with get_agent, then activate.",
      inputSchema: {
        ...workspaceArg,
        brief: z
          .string()
          .min(20)
          .describe(
            "What this agent should do, in a sentence or two. Be specific about what it must collect and what it must never say."
          ),
      },
    },
    handler(async ({ workspace, brief }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.ai.draftAgent, {
        workspaceId: found._id,
        brief,
      });
      return ok({
        agentId: result.agentId,
        draft: result.draft,
        next: "Set routingDescription and status:'active' with update_agent.",
      });
    })
  );

  server.registerTool(
    "ensure_front_desk",
    {
      title: "Ensure the front desk exists",
      description:
        "Provision the workspace's default bot — the front desk that answers first on every channel and routes each conversation to the right agent. Idempotent. With repointChannels it also sends the existing channels through it, which changes how live WhatsApp numbers behave.",
      inputSchema: {
        ...workspaceArg,
        repointChannels: z
          .boolean()
          .optional()
          .describe(
            "Point every existing channel at the front desk. Default false."
          ),
      },
    },
    handler(async ({ workspace, repointChannels }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.mutation(api.agents.ensureDefaultRouter, {
        workspaceId: found._id,
        repointChannels: repointChannels ?? false,
      });
      return ok({
        agentId: result.agentId,
        created: result.created,
        channelsRepointed: result.repointed ?? 0,
      });
    })
  );

  server.registerTool(
    "chat_with_agent",
    {
      title: "Talk to an agent",
      description:
        "Send a message as a test customer and get the agent's real reply — the same engine WhatsApp and the website widget use, so knowledge retrieval, catalogue lookups, tools and routing all run. Point it at the front desk to test routing: handoffPath shows which agents the message passed through. Costs model tokens against the workspace.",
      inputSchema: {
        ...workspaceArg,
        agent: z
          .string()
          .describe(
            "Which agent receives the message. Use the front desk to test routing."
          ),
        message: z.string().describe("What the customer says"),
        session: z
          .string()
          .optional()
          .describe(
            "Conversation to continue. Defaults to one per agent, so repeated calls carry on the same thread."
          ),
        restart: z
          .boolean()
          .optional()
          .describe("Wipe the thread first and start from a clean conversation"),
      },
    },
    handler(async ({ workspace, agent, message, session: sessionId, restart }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);
      const externalId = sessionId?.trim() || `mcp-${target._id}`;

      if (restart) {
        const existing = await call.query(api.conversations.findWebConversation, {
          agentId: target._id,
          sessionId: externalId,
        });
        if (existing) {
          await call.mutation(api.conversations.reset, {
            conversationId: existing._id,
          });
        }
      }

      const result = await call.action(api.engine.respondAsUser, {
        agentId: target._id,
        channelType: "web",
        externalId,
        contactName: "MCP test",
        text: message,
      });

      return ok({
        reply: result.text,
        answeredBy: result.agentBotName ?? null,
        handoffPath: result.handoffPath ?? [],
        toolsCalled: result.toolCalls,
        session: externalId,
        ok: result.ok,
        error: result.error ?? null,
      });
    })
  );
}
