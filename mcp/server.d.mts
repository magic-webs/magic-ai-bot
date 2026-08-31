// Types for the plain-JS MCP server, so the Next route handler can import it.
// server.mjs is JavaScript on purpose: it also runs as a standalone stdio
// process for Claude Code and Claude Desktop, with no build step.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * A server instance with every tool registered. One instance binds to exactly
 * one transport, so ask for a new one per client session.
 */
export function buildServer(): McpServer;

/** Signs in to Convex and refreshes the access token. Throws if unconfigured. */
export function authorize(): Promise<void>;

/** Who the server is signed in as — for a log line. */
export function describeSession(): string;
