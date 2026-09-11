/**
 * stdio: one client, launched as a child process. Claude Code and Claude
 * Desktop work this way.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../build-server.mjs";

export async function serveStdio() {
  await buildServer().connect(new StdioServerTransport());
  console.error("[magic-agent mcp] listening on stdio");
}
