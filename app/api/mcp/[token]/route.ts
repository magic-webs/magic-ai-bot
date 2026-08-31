/**
 * The MCP endpoint, served by the app itself.
 *
 * claude.ai custom connectors are *remote* MCP servers: Anthropic's servers make
 * the request, so the endpoint has to be on a public HTTPS URL. Serving it from
 * the deployed app means that URL is a permanent one on your own domain, with
 * no second process to host and no tunnel to keep alive:
 *
 *   https://bot.magicwebs.ai/api/mcp/<MAGIC_AI_BOT_MCP_TOKEN>
 *
 * The tools are the same ones the stdio server exposes — mcp/server.mjs is
 * imported, not duplicated.
 *
 * ── The token ────────────────────────────────────────────────────────────────
 * claude.ai's connector form has a URL field and OAuth fields, and nowhere to
 * put a custom header, so the shared secret lives in the path. That URL is
 * therefore a credential: whoever holds it gets whatever MAGIC_AI_BOT_USERNAME
 * can do. Point it at a single workspace account, never at a platform admin.
 *
 * Unset MAGIC_AI_BOT_MCP_TOKEN and this route 404s, so a deployment that has
 * not opted in has no MCP surface at all.
 */

import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/mcp/server.mjs";

// A tool call can wait on an OpenAI round trip through Convex — chat_with_agent
// and the draft_* tools especially.
export const maxDuration = 120;

// Node, not edge: the server uses node:crypto and the Convex Node client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_TOKEN_CHARS = 24;

function tokenMatches(candidate: string): boolean {
  const expected = process.env.MAGIC_AI_BOT_MCP_TOKEN;
  // Short-circuit rather than compare: an unset or trivially short token means
  // this deployment has not enabled MCP, and no value should unlock it.
  if (!expected || expected.length < MIN_TOKEN_CHARS) return false;

  const given = Buffer.from(candidate);
  const want = Buffer.from(expected);
  // Length first, because timingSafeEqual throws on a mismatch. The length of a
  // rejected guess is not a useful secret.
  return given.length === want.length && timingSafeEqual(given, want);
}

// Identical for a wrong token and for MCP being switched off, so neither the
// URL shape nor the feature's existence can be probed.
const notFound = () =>
  new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });

async function handle(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  if (!tokenMatches(token)) return notFound();

  try {
    // Stateless: a fresh server and transport per request, with no session id.
    // Serverless invocations do not share memory, so there is nowhere to keep a
    // session map — and every tool here is a self-contained request/response.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // JSON rather than SSE: with nothing to stream, a plain response is
      // simpler and survives platform buffering.
      enableJsonResponse: true,
    });

    const server = buildServer();
    await server.connect(transport);

    const response = await transport.handleRequest(request);
    // The instance is per-request, so it is closed once the response is built.
    // Left open, each invocation would leak one.
    void server.close();
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mcp] request failed:", message);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const POST = handle;

// Stateless mode has no stream to resume and no session to delete, but the spec
// expects these verbs to answer rather than 404 — the transport replies 405.
export const GET = handle;
export const DELETE = handle;
