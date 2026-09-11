/**
 * The knowledge base agents search before answering.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findAgent, findKnowledge } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_knowledge",
    {
      title: "List knowledge sources",
      description:
        "What agents can retrieve from. A source scoped to an agent is private to it; an unscoped one is available to every agent in the workspace. Status must reach 'ready' before it is searchable.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const sources = await call.query(api.knowledge.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        sources.map((source) => ({
          id: source._id,
          title: source.title,
          kind: source.kind,
          status: source.status,
          scope: source.agentId ? "one agent" : "whole workspace",
          agentName: source.agentName ?? null,
          chunks: source.chunkCount,
          characters: source.charCount,
          tags: source.tags,
          url: source.url ?? null,
          failureReason: source.failureReason ?? null,
        }))
      );
    })
  );

  server.registerTool(
    "add_knowledge",
    {
      title: "Add knowledge",
      description:
        "Add a policy, FAQ, spec sheet or web page to the knowledge base. It is chunked and embedded in the background, so it becomes searchable a few seconds later — check list_knowledge for status 'ready'. Uploading files is the dashboard's job; this takes text or a URL.",
      inputSchema: {
        ...workspaceArg,
        title: z.string().describe("How this source is labelled in citations"),
        kind: z
          .enum(["text", "faq", "url"])
          .describe(
            "text for prose, faq for question/answer pairs, url to fetch a page"
          ),
        content: z
          .string()
          .optional()
          .describe("The text itself, for kind text or faq"),
        url: z.string().optional().describe("The page to fetch, for kind url"),
        agent: z
          .string()
          .optional()
          .describe(
            "Scope this source to one agent. Omit to make it available to every agent."
          ),
        tags: z.array(z.string()).optional(),
      },
    },
    handler(async ({ workspace, title, kind, content, url, agent, tags }) => {
      const found = await resolveWorkspace(workspace);
      const scoped = agent ? await findAgent(found._id, agent) : null;

      const sourceId = await call.mutation(api.knowledge.addSource, {
        workspaceId: found._id,
        agentId: scoped?._id,
        title,
        kind,
        rawText: kind === "url" ? undefined : content,
        url: kind === "url" ? url : undefined,
        tags,
      });
      return ok({
        sourceId,
        note: "Embedding runs in the background. Check list_knowledge for status 'ready'.",
      });
    })
  );

  server.registerTool(
    "delete_knowledge",
    {
      title: "Delete a knowledge source",
      description:
        "Permanently delete a source and everything embedded from it. Agents stop being able to retrieve it immediately.",
      inputSchema: {
        ...workspaceArg,
        source: z.string().describe("Source title or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, source }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findKnowledge(found._id, source);
      await call.mutation(api.knowledge.remove, { sourceId: target._id });
      return ok(`Deleted "${target.title}".`);
    })
  );
}
