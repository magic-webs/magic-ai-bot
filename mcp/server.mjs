#!/usr/bin/env node
/**
 * Magic Agent — MCP server.
 *
 * Exposes the platform's own Convex functions as MCP tools, so an assistant can
 * build and configure a workspace end to end: agents, the front desk that
 * routes between them, the catalogue, the knowledge base, channels, custom
 * tools — and then talk to an agent to see whether the configuration works.
 *
 * This file is only the entry point. It exists to be two things at once:
 *
 *   - a process, run as `node mcp/server.mjs` (add `--http` for claude.ai), and
 *   - a module, imported by app/api/mcp/[token]/route.ts to serve the same
 *     tools from the deployed app.
 *
 * Imported, it must define tools and nothing else — hence the `invokedDirectly`
 * guard at the bottom. Everything real lives in src/:
 *
 *   src/config.mjs          environment and .env.local
 *   src/convex.mjs          signing in, and the authenticated `call` helpers
 *   src/workspaces.mjs      turning an optional slug into a workspace
 *   src/lookup.mjs          turning a name into a Convex document
 *   src/results.mjs         tool results, and the shapes documents are cut to
 *   src/args.mjs            zod fragments shared between tools
 *   src/build-server.mjs    the factory that registers everything
 *   src/tools/              one module per tool group
 *   src/transports/         stdio and streamable HTTP
 *
 * Authentication is described in src/convex.mjs; configuration in
 * src/config.mjs. See mcp/README.md for client setup.
 */

import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./src/cli.mjs";

// The module surface the Next route handler imports.
export { buildServer } from "./src/build-server.mjs";
export {
  authorize,
  describeSession,
  runWithIdentity,
  verifyConnectorToken,
} from "./src/convex.mjs";

// Only when this file is the process entry point. Imported — by the Next route
// handler — it must define the tools and nothing else.
const invokedDirectly =
  Boolean(process.argv[1]) &&
  resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error("[magic-agent mcp] failed to start:", error?.message ?? error);
    process.exit(1);
  });
}
