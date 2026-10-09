/**
 * Every tool group, in the order they are registered.
 *
 * Order is the order a client lists them in, so it reads as a tour of the
 * platform: what you can see, then agents, what they sell, what they collect,
 * what they know,
 * where customers reach them, what they can call, what they did, where each
 * lead has got to, who gets told when something happens, what the marketing
 * desk sends — and last the admin tools most callers will never be allowed to
 * use.
 */

import { register as context } from "./context.mjs";
import { register as agents } from "./agents.mjs";
import { register as catalogue } from "./catalogue.mjs";
import { register as records } from "./records.mjs";
import { register as knowledge } from "./knowledge.mjs";
import { register as channels } from "./channels.mjs";
import { register as customTools } from "./custom-tools.mjs";
import { register as operations } from "./operations.mjs";
import { register as leads } from "./leads.mjs";
import { register as notifications } from "./notifications.mjs";
import { register as marketing } from "./marketing.mjs";
import { register as admin } from "./admin.mjs";

const GROUPS = [
  { title: "Context", register: context },
  { title: "Agents", register: agents },
  { title: "Catalogue", register: catalogue },
  { title: "Records", register: records },
  { title: "Knowledge", register: knowledge },
  { title: "Channels", register: channels },
  { title: "Custom tools", register: customTools },
  { title: "Operations", register: operations },
  { title: "Leads", register: leads },
  { title: "Notifications", register: notifications },
  { title: "Marketing", register: marketing },
  { title: "Platform administration", register: admin, admin: true },
];

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerAll(server) {
  for (const group of GROUPS) group.register(server);
}

/** Every tool's name and description, grouped, without building a server. */
export function toolCatalogue() {
  return GROUPS.map((group) => {
    const tools = [];
    group.register({
      registerTool(name, config) {
        tools.push({
          name,
          title: config.title ?? name,
          description: config.description ?? "",
          readOnly: config.annotations?.readOnlyHint === true,
          destructive: config.annotations?.destructiveHint === true,
        });
      },
    });
    return { title: group.title, admin: group.admin === true, tools };
  });
}
