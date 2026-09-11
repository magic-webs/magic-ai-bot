/**
 * Custom tools — the HTTP calls a workspace lets its agents make.
 */

import { z } from "zod";
import { kvArg, workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findAgent, findCustomTool } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_custom_tools",
    {
      title: "List custom tools",
      description:
        "Tools defined for this workspace, beyond the builtin ones. Only 'enabled' tools are given to the model. A tool scoped to an agent is private to it.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const tools = await call.query(api.tools.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        tools.map((tool) => ({
          id: tool._id,
          name: tool.name,
          displayName: tool.displayName,
          description: tool.description,
          whenToUse: tool.whenToUse ?? null,
          kind: tool.kind,
          status: tool.status,
          scope: tool.agentId ? "one agent" : "whole workspace",
          parameters: tool.parameters,
          http: tool.http ?? null,
          dbQuery: tool.dbQuery ?? null,
          callCount: tool.callCount,
        }))
      );
    })
  );

  const toolParameterArg = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean"]),
    description: z.string().describe("The model reads this to fill the value in"),
    required: z.boolean(),
    enumValues: z.array(z.string()).optional(),
  });

  server.registerTool(
    "create_custom_tool",
    {
      title: "Create custom tool",
      description:
        "Give agents a new capability: an HTTP request to your own system, or a lookup against this workspace's own products / orders / contacts. The description is what drives the model's decision to call it, so write it as 'what this does and when to use it'. Starts as a draft — set status 'enabled' to hand it to the model.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().describe("snake_case identifier the model calls"),
        description: z
          .string()
          .describe("Model-facing. This is what drives tool selection."),
        whenToUse: z.string().optional(),
        displayName: z.string().optional(),
        kind: z.enum(["http", "db_query"]),
        parameters: z.array(toolParameterArg).optional(),
        agent: z
          .string()
          .optional()
          .describe("Scope to one agent. Omit for the whole workspace."),
        status: z.enum(["draft", "enabled", "disabled"]).optional(),
        http: z
          .object({
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            urlTemplate: z
              .string()
              .describe("Supports {{paramName}} placeholders"),
            headers: z.array(kvArg).optional(),
            bodyTemplate: z
              .string()
              .optional()
              .describe("Also supports {{paramName}}. Defaults to the raw input as JSON."),
            timeoutMs: z.number().optional(),
          })
          .optional(),
        dbQuery: z
          .object({
            table: z.enum(["products", "orders", "contacts"]),
            searchParam: z
              .string()
              .optional()
              .describe("Which parameter holds the free-text search term"),
            limit: z.number().int().min(1).max(100),
          })
          .optional(),
      },
    },
    handler(async ({ workspace, agent, http, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const scoped = agent ? await findAgent(found._id, agent) : null;

      const toolId = await call.mutation(api.tools.create, {
        workspaceId: found._id,
        agentId: scoped?._id,
        ...fields,
        http: http ? { ...http, headers: http.headers ?? [] } : undefined,
      });
      return ok({ toolId, next: "Set status 'enabled' to give it to the model." });
    })
  );

  server.registerTool(
    "update_custom_tool",
    {
      title: "Update custom tool",
      description:
        "Change a custom tool. Set status 'enabled' to give it to the model, 'disabled' to take it away without deleting it.",
      inputSchema: {
        ...workspaceArg,
        tool: z.string().describe("Tool name or id"),
        description: z.string().optional(),
        whenToUse: z.string().optional(),
        displayName: z.string().optional(),
        parameters: z.array(toolParameterArg).optional(),
        status: z.enum(["draft", "enabled", "disabled"]).optional(),
      },
    },
    handler(async ({ workspace, tool, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findCustomTool(found._id, tool);
      await call.mutation(api.tools.update, { toolId: target._id, ...fields });
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_custom_tool",
    {
      title: "Delete custom tool",
      description: "Permanently delete a custom tool.",
      inputSchema: {
        ...workspaceArg,
        tool: z.string().describe("Tool name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, tool }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findCustomTool(found._id, tool);
      await call.mutation(api.tools.remove, { toolId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );
}
