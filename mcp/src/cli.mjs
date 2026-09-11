/**
 * The command line: sign in, then pick a transport.
 */

import { setting } from "./config.mjs";
import { authorize, describeSession } from "./convex.mjs";
import { serveHttp } from "./transports/http.mjs";
import { serveStdio } from "./transports/stdio.mjs";

export async function main() {
  // Fail loudly at startup rather than on the first tool call, so a broken
  // config shows up when the client connects.
  await authorize();
  console.error(`[magic-agent mcp] signed in as ${describeSession()}`);

  const wantsHttp =
    process.argv.includes("--http") ||
    ["1", "true", "yes"].includes(
      String(setting("MAGIC_AI_BOT_MCP_HTTP") ?? "").toLowerCase()
    );

  if (wantsHttp) await serveHttp();
  else await serveStdio();
}
