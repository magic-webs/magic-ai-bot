/**
 * Context tools — what this server can see and which workspace it is on.
 */

import { z } from "zod";
import { kvArg, workspaceArg } from "../args.mjs";
import { CONVEX_URL, DEFAULT_WORKSPACE } from "../config.mjs";
import { api, authorize, call, currentSession, state } from "../convex.mjs";
import { handler, ok } from "../results.mjs";
import { reachableWorkspaces, resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "The account this server is signed in as, and the workspaces it can reach. Start here when unsure of scope.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      await authorize();
      const all = await reachableWorkspaces();
      const session = currentSession();
      return ok({
        signedInAs: session.label,
        role: session.role,
        convexUrl: CONVEX_URL,
        defaultWorkspace: DEFAULT_WORKSPACE ?? session.workspaceSlug ?? null,
        workspaces: all.map((w) => ({ slug: w.slug, name: w.name, status: w.status })),
      });
    })
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Every workspace this account can reach, with counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      const all = await reachableWorkspaces();
      const out = [];
      for (const workspace of all) {
        const summary = await call.query(api.workspaces.summary, {
          workspaceId: workspace._id,
        });
        out.push({
          slug: workspace.slug,
          name: workspace.name,
          industry: workspace.industry ?? null,
          currency: workspace.currency,
          status: workspace.status,
          counts: summary,
        });
      }
      return ok(out);
    })
  );

  server.registerTool(
    "get_workspace",
    {
      title: "Get workspace",
      description:
        "The workspace profile: company details, locale, currency, webhook, and the facts injected into every agent prompt.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const summary = await call.query(api.workspaces.summary, {
        workspaceId: found._id,
      });
      return ok({
        slug: found.slug,
        name: found.name,
        ownerName: found.ownerName ?? null,
        tagline: found.tagline ?? null,
        description: found.description ?? null,
        industry: found.industry ?? null,
        website: found.website ?? null,
        supportEmail: found.supportEmail ?? null,
        supportPhone: found.supportPhone ?? null,
        address: found.address ?? null,
        locale: found.locale,
        timezone: found.timezone,
        currency: found.currency,
        theme: found.theme ?? "default (green)",
        webhookUrl: found.webhookUrl ?? null,
        facts: found.facts,
        status: found.status,
        counts: summary,
      });
    })
  );

  server.registerTool(
    "update_workspace",
    {
      title: "Update workspace",
      description:
        "Change the company profile. Everything here reaches every agent's system prompt, so it is the cheapest way to make all of them more accurate at once. Omitted fields are left alone.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().optional(),
        ownerName: z
          .string()
          .optional()
          .describe(
            "Who runs the workspace, as they want to be addressed. Used when an agent speaks to the operator rather than a customer — the spoken introduction greets this name. Send an empty string to clear it."
          ),
        tagline: z.string().optional(),
        description: z.string().optional(),
        industry: z.string().optional(),
        website: z.string().optional(),
        supportEmail: z.string().optional(),
        supportPhone: z.string().optional(),
        address: z.string().optional(),
        locale: z.string().optional().describe("e.g. en-GB"),
        timezone: z.string().optional().describe("e.g. Europe/London"),
        currency: z.string().optional().describe("ISO code, e.g. GBP"),
        webhookUrl: z
          .string()
          .optional()
          .describe("Where order_created and escalation events are POSTed"),
        facts: z
          .array(kvArg)
          .optional()
          .describe(
            "Replaces the whole list. Arbitrary company facts every agent may state — opening hours, delivery areas, lead times."
          ),
      },
    },
    handler(async ({ workspace, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      await call.mutation(api.workspaces.update, {
        workspaceId: found._id,
        ...fields,
      });
      state().workspaces.delete(found.slug);
      return ok(`Updated ${found.name}.`);
    })
  );
}
