import { buildServer } from "../build-server.mjs";
import { setting } from "../config.mjs";

/**
 * Streamable HTTP: for claude.ai, which calls a URL rather than launching a
 * process, so the server has to be reachable over the public internet.
 *
 * ── The token ────────────────────────────────────────────────────────────────
 * claude.ai's custom-connector form takes a URL and (optionally) OAuth
 * credentials — there is nowhere to put a custom header. So the shared secret
 * lives in the path: /mcp/<token>. An Authorization: Bearer header is accepted
 * too, for clients that can send one.
 *
 * Treat that URL as the credential it is. Anyone holding it has whatever the
 * account in MAGIC_AI_BOT_USERNAME has, which is why the README tells you to
 * point a public deployment at a single workspace rather than at an admin.
 */
export async function serveHttp() {
  const { createServer } = await import("node:http");
  const { randomUUID, timingSafeEqual } = await import("node:crypto");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { isInitializeRequest } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );

  const port = Number(setting("MAGIC_AI_BOT_MCP_PORT") ?? 8787);
  // Loopback by default: going public should be a deliberate act (a tunnel, or
  // HOST=0.0.0.0 behind a reverse proxy), never the result of running a script.
  const host = setting("MAGIC_AI_BOT_MCP_HOST") ?? "127.0.0.1";
  const token = setting("MAGIC_AI_BOT_MCP_TOKEN");

  if (!token || token.length < 24) {
    console.error(
      [
        "[magic-agent mcp] MAGIC_AI_BOT_MCP_TOKEN must be set to at least 24 characters",
        "before serving over HTTP — the URL is the only thing standing between the",
        "internet and this workspace. Generate one with:",
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
      ].join("\n")
    );
    process.exit(1);
  }

  const expected = Buffer.from(token);
  const tokenMatches = (candidate) => {
    if (typeof candidate !== "string") return false;
    const given = Buffer.from(candidate);
    // Length is compared first because timingSafeEqual throws on a mismatch;
    // the length of a rejected token is not a useful secret.
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  /** sessionId -> transport, so follow-up requests reach the right session. */
  const sessions = new Map();

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        // A body this large is not a legitimate MCP message.
        if (raw.length > 4_000_000) reject(new Error("Request body too large"));
      });
      req.on("end", () => {
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Body is not valid JSON"));
        }
      });
      req.on("error", reject);
    });

  const send = (res, status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  const httpServer = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    } catch {
      return send(res, 400, { error: "Bad request" });
    }

    // A cheap liveness check that reveals nothing and needs no token.
    if (url.pathname === "/health") {
      return send(res, 200, { ok: true, server: "magic-agent" });
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const authorized =
      (segments[0] === "mcp" && segments.length === 2 && tokenMatches(segments[1])) ||
      (segments[0] === "mcp" && segments.length === 1 && tokenMatches(bearer));

    if (!authorized) {
      // Deliberately identical for a wrong path and a wrong token, so the URL
      // shape cannot be probed.
      return send(res, 404, { error: "Not found" });
    }

    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        const body = req.method === "POST" ? await readBody(req) : undefined;

        if (req.method !== "POST" || !isInitializeRequest(body)) {
          return send(res, 400, {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: sessionId
                ? "Unknown or expired session. Reconnect."
                : "Expected an initialize request.",
            },
            id: null,
          });
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => sessions.set(id, transport),
          onsessionclosed: (id) => sessions.delete(id),
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };

        await buildServer().connect(transport);
        return await transport.handleRequest(req, res, body);
      }

      const body = req.method === "POST" ? await readBody(req) : undefined;
      return await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error("[magic-agent mcp] request failed:", error?.message ?? error);
      if (!res.headersSent) send(res, 500, { error: "Internal error" });
    }
  });

  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  console.error(
    [
      `[magic-agent mcp] http://${host}:${port}/mcp/<token>`,
      host === "127.0.0.1"
        ? "  bound to loopback — put a tunnel or reverse proxy in front to reach it from claude.ai"
        : "  bound to a public interface — make sure it is behind HTTPS",
    ].join("\n")
  );
}
