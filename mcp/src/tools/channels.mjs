/**
 * Channels — the surfaces a customer reaches an agent through.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { APP_URL, CONVEX_URL } from "../config.mjs";
import { api, call } from "../convex.mjs";
import { findAgent, findChannel } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_channels",
    {
      title: "List channels",
      description:
        "Where the workspace is reachable. Web channels come with the embed snippet to paste into a site; WhatsApp channels come with the callback URL to configure in Meta. Access tokens are never returned.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const channels = await call.query(api.channels.listByWorkspace, {
        workspaceId: found._id,
      });
      const convexSite = CONVEX_URL.replace(".convex.cloud", ".convex.site");

      return ok(
        channels.map((channel) => ({
          id: channel._id,
          name: channel.name,
          type: channel.type,
          status: channel.status,
          answeredBy: channel.agentName,
          lastInboundAt: channel.lastInboundAt
            ? new Date(channel.lastInboundAt).toISOString()
            : null,
          lastError: channel.lastError ?? null,
          ...(channel.type === "web"
            ? {
                embedSnippet: `<script src="${APP_URL}/widget/${channel.channelKey}/embed.js" async></script>`,
                directLink: `${APP_URL}/widget/${channel.channelKey}`,
              }
            : {
                callbackUrl: `${convexSite}/whatsapp/${channel.channelKey}`,
                displayPhoneNumber: channel.whatsapp?.displayPhoneNumber ?? null,
                phoneNumberId: channel.whatsapp?.phoneNumberId ?? null,
                hasAccessToken: channel.hasAccessToken,
              }),
        }))
      );
    })
  );

  server.registerTool(
    "create_channel",
    {
      title: "Create channel",
      description:
        "Add a website widget or connect a WhatsApp number. Point it at the front desk unless you specifically want one agent to answer everything on it without routing. A web channel is live immediately; a WhatsApp one starts paused until its callback URL is configured in Meta.",
      inputSchema: {
        ...workspaceArg,
        type: z.enum(["web", "whatsapp"]),
        name: z.string().describe("e.g. 'Homepage chat' or 'Sales line'"),
        agent: z
          .string()
          .optional()
          .describe("Who answers here. Defaults to the front desk."),
        phoneNumberId: z.string().optional().describe("WhatsApp only, required"),
        accessToken: z.string().optional().describe("WhatsApp only, required"),
        wabaId: z.string().optional(),
        businessId: z.string().optional(),
        displayPhoneNumber: z.string().optional(),
        apiBaseUrl: z
          .string()
          .optional()
          .describe("Change only when sending through a BSP proxy"),
        apiVersion: z.string().optional(),
      },
    },
    handler(async ({ workspace, type, name, agent, ...wa }) => {
      const found = await resolveWorkspace(workspace);

      let agentId;
      if (agent) {
        agentId = (await findAgent(found._id, agent))._id;
      } else {
        const router = await call.query(api.agents.findRouter, {
          workspaceId: found._id,
        });
        if (!router) {
          throw new Error(
            "This workspace has no front desk yet, and no agent was named. Call ensure_front_desk, or pass `agent`."
          );
        }
        agentId = router._id;
      }

      const channelId = await call.mutation(api.channels.create, {
        workspaceId: found._id,
        agentId,
        type,
        name,
        whatsapp:
          type === "whatsapp"
            ? {
                phoneNumberId: wa.phoneNumberId ?? "",
                accessToken: wa.accessToken,
                wabaId: wa.wabaId,
                businessId: wa.businessId,
                displayPhoneNumber: wa.displayPhoneNumber,
                apiBaseUrl: wa.apiBaseUrl,
                apiVersion: wa.apiVersion,
              }
            : undefined,
      });

      return ok({
        channelId,
        next:
          type === "web"
            ? "Call list_channels for the embed snippet."
            : "Call list_channels for the callback URL to paste into Meta, then set status active with update_channel.",
      });
    })
  );

  server.registerTool(
    "update_channel",
    {
      title: "Update channel",
      description:
        "Rename a channel, repoint it at a different agent, or take it live / pause it. A paused channel silently ignores inbound messages.",
      inputSchema: {
        ...workspaceArg,
        channel: z.string().describe("Channel name or id"),
        name: z.string().optional(),
        agent: z.string().optional().describe("Who answers here"),
        status: z.enum(["active", "paused"]).optional(),
      },
    },
    handler(async ({ workspace, channel, name, agent, status }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findChannel(found._id, channel);
      const agentId = agent ? (await findAgent(found._id, agent))._id : undefined;

      await call.mutation(api.channels.update, {
        channelId: target._id,
        name,
        agentId,
        status,
      });
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_channel",
    {
      title: "Delete channel",
      description:
        "Permanently delete a channel. A website widget stops loading and a WhatsApp number stops being answered.",
      inputSchema: {
        ...workspaceArg,
        channel: z.string().describe("Channel name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, channel }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findChannel(found._id, channel);
      await call.mutation(api.channels.remove, { channelId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );
}
