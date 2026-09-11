/**
 * Platform administration.
 *
 * Every tool here needs the server signed in as an admin; as a workspace they
 * fail with "Administrator access required" from the Convex guard, which is the
 * correct answer rather than something to pre-empt here.
 *
 * The workspace-naming tools take a mandatory slug — see requireNamedWorkspace.
 */

import { z } from "zod";
import { kvArg, workspaceArg } from "../args.mjs";
import { api, call, state } from "../convex.mjs";
import { handler, money, ok } from "../results.mjs";
import {
  reachableWorkspaces,
  requireNamedWorkspace,
  resolveWorkspace,
} from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "create_workspace",
    {
      title: "Create workspace",
      description:
        "Onboard a new company. This is the first step for a new customer: the workspace holds its own agents, catalogue, knowledge and channels, and nothing is shared with any other workspace. Fill in description, industry and facts properly — they reach every agent's system prompt, so a well-described workspace produces better agents before any of them is configured. Follow with issue_workspace_password to give the company its own login.",
      inputSchema: {
        name: z.string().describe("The company name. The slug is derived from it."),
        ownerName: z
          .string()
          .optional()
          .describe(
            "Who runs the company, as they want to be addressed. Agents greet this name when they speak to the operator."
          ),
        tagline: z.string().optional(),
        description: z
          .string()
          .optional()
          .describe("What the company does, in the words an agent should use"),
        industry: z.string().optional(),
        website: z.string().optional(),
        supportEmail: z.string().optional(),
        supportPhone: z.string().optional(),
        address: z.string().optional(),
        locale: z.string().optional().describe("Default en-GB"),
        timezone: z.string().optional().describe("Default Europe/London"),
        currency: z.string().optional().describe("Default GBP"),
        webhookUrl: z.string().optional(),
        facts: z
          .array(kvArg)
          .optional()
          .describe("Company facts every agent may state — hours, delivery areas"),
      },
    },
    handler(async (fields) => {
      const result = await call.mutation(api.workspaces.create, fields);
      return ok({
        workspaceId: result.workspaceId,
        slug: result.slug,
        next: [
          "issue_workspace_password — so the company can sign in",
          "create_agent — the front desk is provisioned with the first agent",
        ],
      });
    })
  );

  server.registerTool(
    "issue_workspace_password",
    {
      title: "Issue a workspace password",
      description:
        "Generate the company's own login for a workspace and return it. The password is shown exactly once and only ever stored hashed, so pass it on immediately — there is no way to read it again, only to issue a new one. Doing this revokes every live session for that workspace and requires the company to change the password on first sign-in. The username is the workspace slug.",
      inputSchema: {
        workspace: z.string().describe("Workspace slug. Required — no default."),
      },
    },
    handler(async ({ workspace }) => {
      const found = await requireNamedWorkspace(workspace);
      const result = await call.action(api.auth.generateWorkspacePassword, {
        workspaceId: found._id,
      });
      return ok({
        username: result.slug,
        password: result.password,
        warning:
          "Shown once. Only the hash is kept, and existing sessions for this workspace have been revoked.",
      });
    })
  );

  server.registerTool(
    "set_workspace_access",
    {
      title: "Suspend or restore a workspace login",
      description:
        "Revoke a company's ability to sign in, or restore it. Revoking drops its live sessions immediately and locks it out on the very next request, without touching any data — its agents keep answering customers. Use it to suspend an account rather than delete_workspace.",
      inputSchema: {
        workspace: z.string().describe("Workspace slug. Required — no default."),
        status: z.enum(["active", "revoked"]),
      },
    },
    handler(async ({ workspace, status }) => {
      const found = await requireNamedWorkspace(workspace);
      await call.action(api.auth.setWorkspaceAccess, {
        workspaceId: found._id,
        status,
      });
      return ok(
        status === "revoked"
          ? `${found.name} can no longer sign in. Its agents still answer customers — use set_workspace_status to take those offline.`
          : `${found.name} can sign in again.`
      );
    })
  );

  server.registerTool(
    "set_workspace_status",
    {
      title: "Archive or reactivate a workspace",
      description:
        "Archive a workspace or bring it back. Archiving blocks the company's sign-in and marks the workspace inactive, while keeping every record. Reversible, and the right move when a customer leaves — delete_workspace is not.",
      inputSchema: {
        workspace: z.string().describe("Workspace slug. Required — no default."),
        status: z.enum(["active", "archived"]),
      },
    },
    handler(async ({ workspace, status }) => {
      const found = await requireNamedWorkspace(workspace);
      await call.mutation(api.workspaces.setStatus, {
        workspaceId: found._id,
        status,
      });
      state().workspaces.delete(found.slug);
      return ok(`${found.name} is now ${status}.`);
    })
  );

  server.registerTool(
    "delete_workspace",
    {
      title: "Delete a workspace",
      description:
        "Permanently delete a workspace and everything in it: agents, catalogue, knowledge base and its embeddings, uploaded files, channels, custom tools, contacts, conversations and orders. There is no undo and no export. Prefer set_workspace_status 'archived', which keeps the records. Requires the workspace's exact name as confirmation.",
      inputSchema: {
        workspace: z.string().describe("Workspace slug. Required — no default."),
        confirmName: z
          .string()
          .describe(
            "The workspace's exact name, as a deliberate confirmation that this is the right one."
          ),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    handler(async ({ workspace, confirmName }) => {
      const found = await requireNamedWorkspace(workspace);
      if (confirmName.trim() !== found.name) {
        throw new Error(
          `confirmName does not match. "${found.slug}" is named "${found.name}" — pass that exactly to confirm the deletion.`
        );
      }
      const summary = await call.query(api.workspaces.summary, {
        workspaceId: found._id,
      });
      await call.mutation(api.workspaces.remove, { workspaceId: found._id });
      state().workspaces.delete(found.slug);
      return ok({
        deleted: found.name,
        slug: found.slug,
        alsoDeleted: summary,
      });
    })
  );

  server.registerTool(
    "workspace_access_report",
    {
      title: "Who has been given access",
      description:
        "Across every workspace: whether a password has been issued, whether it is active or revoked, whether the company has changed it yet, and when it last signed in. The quickest way to find a customer who was set up but never handed their login.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      const [rows, all] = await Promise.all([
        call.query(api.authDb.accessSummary, {}),
        reachableWorkspaces(),
      ]);
      const names = new Map(all.map((w) => [w._id, w]));
      const seen = new Set(rows.map((row) => row.workspaceId));

      return ok([
        ...rows.map((row) => {
          const workspace = names.get(row.workspaceId);
          return {
            slug: workspace?.slug ?? row.workspaceId,
            name: workspace?.name ?? null,
            hasPassword: true,
            access: row.status,
            stillOnIssuedPassword: row.mustChangePassword,
            issuedAt: new Date(row.issuedAt).toISOString(),
            lastLoginAt: row.lastLoginAt
              ? new Date(row.lastLoginAt).toISOString()
              : null,
          };
        }),
        // A workspace with no credential row has never been handed a login at all,
        // which is exactly the case worth surfacing.
        ...all
          .filter((workspace) => !seen.has(workspace._id))
          .map((workspace) => ({
            slug: workspace.slug,
            name: workspace.name,
            hasPassword: false,
            access: null,
            note: "No login issued yet — run issue_workspace_password.",
          })),
      ]);
    })
  );

  server.registerTool(
    "platform_usage",
    {
      title: "Token usage and cost across all workspaces",
      description:
        "Platform-wide model spend, broken down by workspace, with the previous period for comparison. Admin-only; use usage_summary for one workspace.",
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe("Default 30"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ days }) => {
      const summary = await call.query(api.usage.adminSummary, {
        days: days ?? 30,
        now: Date.now(),
      });
      return ok(summary);
    })
  );

  server.registerTool(
    "usage_summary",
    {
      title: "Token usage and cost",
      description:
        "What the workspace has spent on model calls, by day, agent and channel. Costs are exact where the model is in the price table and flagged when it is not.",
      inputSchema: {
        ...workspaceArg,
        days: z.number().int().min(1).max(90).optional().describe("Default 30"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, days }) => {
      const found = await resolveWorkspace(workspace);
      const summary = await call.query(api.usage.workspaceSummary, {
        workspaceId: found._id,
        days: days ?? 30,
        now: Date.now(),
      });
      return ok({ ...summary, totalCost: money(summary?.totalCostNanoUsd) });
    })
  );
}
