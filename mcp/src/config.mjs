/**
 * Configuration.
 *
 * Read from the environment, falling back to .env.local so a local checkout
 * needs no extra setup:
 *
 *   MAGIC_AI_BOT_CONVEX_URL   the deployment, e.g. https://xxx.convex.cloud
 *                             (falls back to NEXT_PUBLIC_CONVEX_URL)
 *   MAGIC_AI_BOT_USERNAME     an admin email, or a workspace slug
 *   MAGIC_AI_BOT_PASSWORD     that account's password
 *                             (falls back to ADMIN_EMAIL / ADMIN_PASSWORD,
 *                              which signs in as platform admin)
 *   MAGIC_AI_BOT_WORKSPACE    optional default workspace slug, so tools can
 *                             omit `workspace`
 *   MAGIC_AI_BOT_APP_URL      optional, only used to build widget embed
 *                             snippets (default http://localhost:3000)
 *
 * See mcp/README.md for client configuration.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/** Reads .env.local without pulling in a dotenv dependency. */
function readEnvFile() {
  const out = {};
  try {
    const text = readFileSync(join(REPO, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* not a local checkout, or no .env.local — env vars alone then */
  }
  return out;
}

const fileEnv = readEnvFile();
export const setting = (name, ...fallbacks) => {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key] ?? fileEnv[key];
    if (value) return value;
  }
  return undefined;
};

export const CONVEX_URL = setting(
  "MAGIC_AI_BOT_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL"
);
export const USERNAME = setting("MAGIC_AI_BOT_USERNAME", "ADMIN_EMAIL");
export const PASSWORD = setting("MAGIC_AI_BOT_PASSWORD", "ADMIN_PASSWORD");
export const DEFAULT_WORKSPACE = setting("MAGIC_AI_BOT_WORKSPACE");
// Only used to print widget embed snippets. On Vercel the deployment already
// knows its own hostname, so a correct snippet needs no extra configuration.
const vercelHost = setting(
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "VERCEL_URL"
);
export const APP_URL = (
  setting("MAGIC_AI_BOT_APP_URL") ??
  (vercelHost ? `https://${vercelHost.replace(/^https?:\/\//, "")}` : null) ??
  "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Checked on first use rather than at import, because this module is also
 * imported by app/api/mcp/[token]/route.ts — a serverless bundle must not be
 * able to kill the process just by loading a file.
 */
export function assertConfigured(identity) {
  // A connector token carries its own credential, so it needs the deployment
  // and nothing else. Only the env-configured identity needs a username and
  // password to be present.
  if (CONVEX_URL && identity?.kind === "token") return;
  if (CONVEX_URL && USERNAME && PASSWORD) return;
  throw new Error(
    [
      "Magic Agent MCP is not configured.",
      `  Convex URL: ${CONVEX_URL ? "ok" : "MISSING (MAGIC_AI_BOT_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL)"}`,
      `  Username:   ${USERNAME ? "ok" : "MISSING (MAGIC_AI_BOT_USERNAME or ADMIN_EMAIL)"}`,
      `  Password:   ${PASSWORD ? "ok" : "MISSING (MAGIC_AI_BOT_PASSWORD or ADMIN_PASSWORD)"}`,
      "See mcp/README.md.",
    ].join("\n")
  );
}
