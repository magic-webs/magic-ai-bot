#!/usr/bin/env node
/**
 * Magic Agent — MCP server.
 *
 * Exposes the platform's own Convex functions as MCP tools, so an assistant can
 * build and configure a workspace end to end: agents, the front desk that
 * routes between them, the catalogue, the knowledge base, channels, custom
 * tools — and then talk to an agent to see whether the configuration works.
 *
 * ── Authentication ────────────────────────────────────────────────────────────
 * It signs in exactly the way the dashboard does: `auth.login` for a session
 * token, `auth.mintAccessToken` for a short-lived JWT, then that JWT on every
 * call. So it has precisely the permissions of the account it signs in as, and
 * every `requireWorkspace` / `requireAdmin` guard applies unchanged. There is no
 * admin key here and no back door — deleting this file removes an operator, not
 * a security boundary.
 *
 * It talks to Convex directly, so the Next app does not need to be running.
 *
 * ── Configuration ────────────────────────────────────────────────────────────
 *   MAGIC_AI_BOT_CONVEX_URL   the deployment, e.g. https://xxx.convex.cloud
 *                             (falls back to NEXT_PUBLIC_CONVEX_URL in .env.local)
 *   MAGIC_AI_BOT_USERNAME     an admin email, or a workspace slug
 *   MAGIC_AI_BOT_PASSWORD     that account's password
 *                             (falls back to ADMIN_EMAIL / ADMIN_PASSWORD in
 *                              .env.local, which signs in as platform admin)
 *   MAGIC_AI_BOT_WORKSPACE    optional default workspace slug, so tools can
 *                             omit `workspace`
 *   MAGIC_AI_BOT_APP_URL      optional, only used to build widget embed
 *                             snippets (default http://localhost:3000)
 *
 * See mcp/README.md for client configuration.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { z } from "zod";

// convex/_generated/api.js exports exactly this. Building it here instead of
// importing that file keeps this server independent of codegen output and
// avoids Node reparsing a type-less .js as ESM on every start.
const api = anyApi;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

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
const setting = (name, ...fallbacks) => {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key] ?? fileEnv[key];
    if (value) return value;
  }
  return undefined;
};

const CONVEX_URL = setting(
  "MAGIC_AI_BOT_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL"
);
const USERNAME = setting("MAGIC_AI_BOT_USERNAME", "ADMIN_EMAIL");
const PASSWORD = setting("MAGIC_AI_BOT_PASSWORD", "ADMIN_PASSWORD");
const DEFAULT_WORKSPACE = setting("MAGIC_AI_BOT_WORKSPACE");
// Only used to print widget embed snippets. On Vercel the deployment already
// knows its own hostname, so a correct snippet needs no extra configuration.
const vercelHost = setting(
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "VERCEL_URL"
);
const APP_URL = (
  setting("MAGIC_AI_BOT_APP_URL") ??
  (vercelHost ? `https://${vercelHost.replace(/^https?:\/\//, "")}` : null) ??
  "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Checked on first use rather than at import, because this module is also
 * imported by app/api/mcp/[token]/route.ts — a serverless bundle must not be
 * able to kill the process just by loading a file.
 */
function assertConfigured() {
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

// ---------------------------------------------------------------------------
// Authenticated Convex access
//
// The JWT lasts 30 minutes; it is re-minted a minute early so a long session
// never fails mid-call. The durable session token is exchanged for a fresh JWT
// rather than being sent as a credential itself.
// ---------------------------------------------------------------------------

const REFRESH_MARGIN_MS = 60_000;

let client = null;
let session = null; // { sessionToken, role, label, workspaceSlug }
let access = null; // { token, expiresAt }

function convex() {
  if (!client) {
    assertConfigured();
    client = new ConvexHttpClient(CONVEX_URL);
  }
  return client;
}

async function signIn() {
  session = await convex().action(api.auth.login, {
    username: USERNAME,
    password: PASSWORD,
  });
  access = null;
}

export async function authorize() {
  assertConfigured();
  if (!session) await signIn();
  if (access && access.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    convex().setAuth(access.token);
    return;
  }

  // Drop the dead token before asking for a new one. Convex validates the
  // Authorization header on every request before the function runs, so an
  // expired JWT fails the very call that would replace it — the refresh path
  // blocked itself, and a server left running past the 30-minute token life
  // could never recover. mintAccessToken needs no identity anyway: the session
  // token in the argument is the credential.
  convex().clearAuth();

  let minted = await convex().action(api.auth.mintAccessToken, {
    sessionToken: session.sessionToken,
  });
  if (!minted) {
    // The session was revoked or expired — sign in again before giving up.
    await signIn();
    minted = await convex().action(api.auth.mintAccessToken, {
      sessionToken: session.sessionToken,
    });
  }
  if (!minted) throw new Error("Could not authenticate with Magic Agent.");

  access = { token: minted.token, expiresAt: minted.expiresAt };
  convex().setAuth(access.token);
}

/** Who this server is signed in as, for a startup log line. */
export function describeSession() {
  return session ? `${session.label} (${session.role})` : "not signed in";
}

const call = {
  query: async (ref, args) => {
    await authorize();
    return convex().query(ref, args);
  },
  mutation: async (ref, args) => {
    await authorize();
    return convex().mutation(ref, args);
  },
  action: async (ref, args) => {
    await authorize();
    return convex().action(ref, args);
  },
};

// ---------------------------------------------------------------------------
// Workspace resolution
//
// Every tool takes an optional `workspace` slug. A company account has exactly
// one workspace and never needs it; an admin can reach them all, so it either
// names one, sets MAGIC_AI_BOT_WORKSPACE, or is told which are available.
// ---------------------------------------------------------------------------

const workspaceCache = new Map(); // slug -> workspace document

async function reachableWorkspaces() {
  await authorize();
  if (session.role === "admin") return await call.query(api.workspaces.list, {});
  const own = await call.query(api.workspaces.getBySlug, {
    slug: session.workspaceSlug,
  });
  return own ? [own] : [];
}

async function resolveWorkspace(slug) {
  await authorize();
  const wanted = slug?.trim() || DEFAULT_WORKSPACE || session.workspaceSlug;

  if (wanted) {
    const cached = workspaceCache.get(wanted);
    if (cached) return cached;
    const found = await call.query(api.workspaces.getBySlug, { slug: wanted });
    if (!found) {
      throw new Error(
        `No workspace with the slug "${wanted}". Call list_workspaces to see what is available.`
      );
    }
    workspaceCache.set(found.slug, found);
    return found;
  }

  // An admin with no default: pick for them only when the choice is obvious.
  const all = await reachableWorkspaces();
  if (all.length === 1) {
    workspaceCache.set(all[0].slug, all[0]);
    return all[0];
  }
  throw new Error(
    `Which workspace? Pass "workspace" with one of: ${all
      .map((w) => w.slug)
      .join(", ")} — or set MAGIC_AI_BOT_WORKSPACE.`
  );
}

/**
 * Like resolveWorkspace, but the slug is mandatory.
 *
 * The admin tools archive, delete and re-credential whole tenants. Letting
 * those inherit MAGIC_AI_BOT_WORKSPACE, or "the only workspace", would turn a
 * forgotten argument into the wrong company.
 */
async function requireNamedWorkspace(slug) {
  if (!slug?.trim()) {
    const all = await reachableWorkspaces();
    throw new Error(
      `This tool needs an explicit workspace slug — it will not guess. One of: ${all
        .map((w) => w.slug)
        .join(", ")}`
    );
  }
  return await resolveWorkspace(slug);
}

// ---------------------------------------------------------------------------
// Resolving named things to ids
//
// Tools take names, not Convex ids: an assistant should be able to say
// "the Sales agent" without having looked up `j57e17...` first. An id is still
// accepted, so anything echoed back by a previous call can be passed straight
// in.
// ---------------------------------------------------------------------------

const norm = (value) => value.trim().toLowerCase();

function pickByName(rows, wanted, label, fields) {
  const target = norm(wanted);
  const exact = rows.filter((row) =>
    fields.some((field) => row[field] && norm(String(row[field])) === target)
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `"${wanted}" matches ${exact.length} ${label}s. Use its id instead: ${exact
        .map((row) => row._id)
        .join(", ")}`
    );
  }

  const partial = rows.filter((row) =>
    fields.some((field) => row[field] && norm(String(row[field])).includes(target))
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${wanted}" is ambiguous. Did you mean: ${partial
        .map((row) => row.name ?? row.title ?? row._id)
        .join(", ")}?`
    );
  }

  throw new Error(
    `No ${label} called "${wanted}". Available: ${
      rows.map((row) => row.name ?? row.title ?? row._id).join(", ") || "none"
    }`
  );
}

async function findAgent(workspaceId, wanted) {
  const agents = await call.query(api.agents.listByWorkspace, { workspaceId });
  if (agents.some((agent) => agent._id === wanted)) {
    return agents.find((agent) => agent._id === wanted);
  }
  return pickByName(agents, wanted, "agent", ["name", "botName", "role"]);
}

async function findProduct(workspaceId, wanted) {
  const products = await call.query(api.products.listByWorkspace, {
    workspaceId,
  });
  if (products.some((p) => p._id === wanted)) {
    return products.find((p) => p._id === wanted);
  }
  return pickByName(products, wanted, "product", ["name", "sku", "slug"]);
}

async function findChannel(workspaceId, wanted) {
  const channels = await call.query(api.channels.listByWorkspace, {
    workspaceId,
  });
  if (channels.some((c) => c._id === wanted)) {
    return channels.find((c) => c._id === wanted);
  }
  return pickByName(channels, wanted, "channel", ["name", "channelKey"]);
}

async function findKnowledge(workspaceId, wanted) {
  const sources = await call.query(api.knowledge.listByWorkspace, {
    workspaceId,
  });
  if (sources.some((s) => s._id === wanted)) {
    return sources.find((s) => s._id === wanted);
  }
  return pickByName(sources, wanted, "knowledge source", ["title"]);
}

async function findCustomTool(workspaceId, wanted) {
  const tools = await call.query(api.tools.listByWorkspace, { workspaceId });
  if (tools.some((t) => t._id === wanted)) {
    return tools.find((t) => t._id === wanted);
  }
  return pickByName(tools, wanted, "custom tool", ["name", "displayName"]);
}

// ---------------------------------------------------------------------------
// Result shaping
//
// A raw Convex document carries _creationTime, searchBlob, embeddings and other
// noise. Trimming it keeps a tool result readable and cheap.
// ---------------------------------------------------------------------------

const MAX_RESULT_CHARS = 60_000;

function ok(payload) {
  let text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated (${
      text.length - MAX_RESULT_CHARS
    } more characters). Narrow the request.`;
  }
  return { content: [{ type: "text", text }] };
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/** Wraps a handler so a Convex error becomes a tool error, not a crash. */
function handler(run) {
  return async (args) => {
    try {
      return await run(args ?? {});
    } catch (error) {
      return fail(error);
    }
  };
}

const money = (nano) =>
  nano === undefined || nano === null
    ? null
    : `$${(nano / 1_000_000_000).toFixed(4)}`;

const agentBrief = (agent) => ({
  id: agent._id,
  name: agent.name,
  botName: agent.botName,
  role: agent.role,
  kind: agent.kind ?? "specialist",
  status: agent.status,
  model: agent.model,
  routingDescription: agent.routingDescription ?? null,
  acceptsHandoff: agent.acceptsHandoff !== false,
  builtinTools: agent.builtinTools,
  knowledgeEnabled: agent.knowledgeEnabled,
});

const productBrief = (product) => ({
  id: product._id,
  name: product.name,
  sku: product.sku ?? null,
  slug: product.slug,
  category: product.category,
  description: product.description,
  price: product.price ?? null,
  currency: product.currency ?? null,
  unit: product.unit ?? null,
  status: product.status,
  tags: product.tags,
  images: (product.resolvedImages ?? []).map((image) => image.url),
  attributes: product.attributes,
  requirementFields: product.requirementFields,
  exampleSpec: product.exampleSpec ?? null,
  notes: product.notes ?? null,
});

// ---------------------------------------------------------------------------
// Shared argument fragments
// ---------------------------------------------------------------------------

const workspaceArg = {
  workspace: z
    .string()
    .optional()
    .describe(
      "Workspace slug. Omit when the account owns exactly one workspace, or when MAGIC_AI_BOT_WORKSPACE is set."
    ),
};

// Keys from convex/lib/shared.ts BUILTIN_TOOLS — the source of truth is there.
const BUILTIN_TOOL_KEYS = [
  "search_knowledge",
  "search_products",
  "get_product_requirements",
  "create_order",
  "lookup_orders",
  "save_contact_detail",
  "escalate_to_human",
  "transfer_to_agent",
  "rich_messages",
];

const toneArg = z
  .object({
    traits: z.array(z.string()).optional(),
    avoid: z.array(z.string()).optional(),
    formality: z.enum(["casual", "neutral", "formal"]).optional(),
    emoji: z.enum(["none", "sparing", "expressive"]).optional(),
    responseLength: z.enum(["short", "medium", "detailed"]).optional(),
    languages: z.array(z.string()).optional(),
    mirrorUserLanguage: z.boolean().optional(),
  })
  .optional()
  .describe(
    "Partial tone. Anything omitted keeps the agent's current setting — the stored value is a complete object, so it is merged here before saving."
  );

const requirementFieldArg = z.object({
  key: z.string().describe("snake_case machine name"),
  label: z.string().describe("The question as the customer sees it"),
  type: z.enum(["text", "number", "select", "boolean", "date"]),
  required: z.boolean(),
  options: z.array(z.string()).optional().describe("Choices, for a select"),
  example: z.string().optional(),
});

const kvArg = z.object({ key: z.string(), value: z.string() });

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

/**
 * Builds a server instance with every tool registered.
 *
 * A factory rather than a singleton: an McpServer binds to exactly one
 * transport, and the HTTP transport needs a fresh one per client session.
 * Authentication and the Convex client are module-level, so a new instance
 * costs nothing but the registrations.
 */
export function buildServer() {
  const server = new McpServer(
    { name: "magic-ai-bot", version: "1.0.0" },
    {
      instructions: [
        "Manage a Magic Agent workspace: agents, the front desk that routes between them, the product catalogue, the knowledge base, channels and custom tools.",
        "",
        "How the platform fits together, so configuration lands in the right place:",
        "- Every workspace has one front desk agent (kind: router). It answers first on every channel and hands each conversation to the specialist that should deal with it, silently. Specialists can hand on to each other.",
        "- Routing is driven entirely by each specialist's `routingDescription` — 'hand over to me when…'. An agent without one is nearly invisible to the front desk, so always set it.",
        "- Only *active* agents receive handoffs. A draft agent gets no traffic.",
        "- Agents refuse to discuss products that are not in the catalogue, and never quote a price that is not stored on the product.",
        "- After changing configuration, use chat_with_agent to see what the customer would actually get. It reports the handoff path, so you can tell whether routing worked.",
      ].join("\n"),
    }
  );

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "The account this server is signed in as, and the workspaces it can reach. Start here when unsure of scope.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      await authorize();
      const all = await reachableWorkspaces();
      return ok({
        signedInAs: session.label,
        role: session.role,
        convexUrl: CONVEX_URL,
        defaultWorkspace: DEFAULT_WORKSPACE ?? session.workspaceSlug ?? null,
        workspaces: all.map((w) => ({ slug: w.slug, name: w.name, status: w.status })),
      });
    })
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Every workspace this account can reach, with counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      const all = await reachableWorkspaces();
      const out = [];
      for (const workspace of all) {
        const summary = await call.query(api.workspaces.summary, {
          workspaceId: workspace._id,
        });
        out.push({
          slug: workspace.slug,
          name: workspace.name,
          industry: workspace.industry ?? null,
          currency: workspace.currency,
          status: workspace.status,
          counts: summary,
        });
      }
      return ok(out);
    })
  );

  server.registerTool(
    "get_workspace",
    {
      title: "Get workspace",
      description:
        "The workspace profile: company details, locale, currency, webhook, and the facts injected into every agent prompt.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const summary = await call.query(api.workspaces.summary, {
        workspaceId: found._id,
      });
      return ok({
        slug: found.slug,
        name: found.name,
        tagline: found.tagline ?? null,
        description: found.description ?? null,
        industry: found.industry ?? null,
        website: found.website ?? null,
        supportEmail: found.supportEmail ?? null,
        supportPhone: found.supportPhone ?? null,
        address: found.address ?? null,
        locale: found.locale,
        timezone: found.timezone,
        currency: found.currency,
        theme: found.theme ?? "default (green)",
        webhookUrl: found.webhookUrl ?? null,
        facts: found.facts,
        status: found.status,
        counts: summary,
      });
    })
  );

  server.registerTool(
    "update_workspace",
    {
      title: "Update workspace",
      description:
        "Change the company profile. Everything here reaches every agent's system prompt, so it is the cheapest way to make all of them more accurate at once. Omitted fields are left alone.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().optional(),
        tagline: z.string().optional(),
        description: z.string().optional(),
        industry: z.string().optional(),
        website: z.string().optional(),
        supportEmail: z.string().optional(),
        supportPhone: z.string().optional(),
        address: z.string().optional(),
        locale: z.string().optional().describe("e.g. en-GB"),
        timezone: z.string().optional().describe("e.g. Europe/London"),
        currency: z.string().optional().describe("ISO code, e.g. GBP"),
        webhookUrl: z
          .string()
          .optional()
          .describe("Where order_created and escalation events are POSTed"),
        facts: z
          .array(kvArg)
          .optional()
          .describe(
            "Replaces the whole list. Arbitrary company facts every agent may state — opening hours, delivery areas, lead times."
          ),
      },
    },
    handler(async ({ workspace, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      await call.mutation(api.workspaces.update, {
        workspaceId: found._id,
        ...fields,
      });
      workspaceCache.delete(found.slug);
      return ok(`Updated ${found.name}.`);
    })
  );

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_agents",
    {
      title: "List agents",
      description:
        "Every agent in the workspace. The front desk is the one with kind 'router'; the rest are specialists it routes to.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const agents = await call.query(api.agents.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(agents.map(agentBrief));
    })
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get agent",
      description:
        "One agent's full configuration, plus the system prompt exactly as the model will receive it and the colleagues it can hand over to. Read this before changing an agent — the compiled prompt shows what is actually reaching the model.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().describe("Agent name, customer-facing name, or id"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, agent }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);
      const preview = await call.query(api.agents.previewPrompt, {
        agentId: target._id,
      });
      return ok({
        ...agentBrief(target),
        objective: target.objective,
        jobDescription: target.jobDescription,
        greeting: target.greeting ?? null,
        tone: target.tone,
        rules: target.rules,
        guardrails: target.guardrails,
        escalationPolicy: target.escalationPolicy ?? null,
        promptOverride: target.promptOverride ?? null,
        temperature: target.temperature,
        maxSteps: target.maxSteps,
        historyLimit: target.historyLimit,
        knowledgeTopK: target.knowledgeTopK,
        canHandOverTo: preview?.team ?? [],
        toolsGivenToTheModel: preview?.toolNames ?? [],
        compiledSystemPrompt: preview?.prompt ?? null,
      });
    })
  );

  server.registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Create a specialist agent. It starts as a draft and receives no traffic until its status is active — set routingDescription so the front desk knows when to hand over, then activate it with update_agent. Creating the first agent also provisions the workspace's front desk.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().describe("Internal name, e.g. 'Sales qualifier'"),
        botName: z
          .string()
          .optional()
          .describe("The name customers see, e.g. 'Priya'"),
        role: z.string().optional().describe("e.g. 'AI Sales Consultant'"),
        routingDescription: z
          .string()
          .optional()
          .describe(
            "'Hand over to me when…' — the one line the front desk reads when choosing who deals with a conversation. Write a condition, not a job description."
          ),
        objective: z.string().optional(),
        jobDescription: z
          .string()
          .optional()
          .describe("Step by step: how it opens, what it collects, how it closes"),
        greeting: z.string().optional(),
        rules: z.array(z.string()).optional().describe("Hard 'always' instructions"),
        guardrails: z
          .array(z.string())
          .optional()
          .describe("Hard 'never' instructions"),
        escalationPolicy: z.string().optional(),
        model: z.string().optional().describe("Default gpt-4.1-mini"),
        builtinTools: z
          .array(z.enum(BUILTIN_TOOL_KEYS))
          .optional()
          .describe("Defaults to a sensible set including transfer_to_agent"),
      },
    },
    handler(async ({ workspace, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const agentId = await call.mutation(api.agents.create, {
        workspaceId: found._id,
        ...fields,
      });
      return ok({
        agentId,
        status: "draft",
        next: "Set status to 'active' with update_agent so the front desk can hand conversations to it.",
      });
    })
  );

  server.registerTool(
    "update_agent",
    {
      title: "Update agent",
      description:
        "Change any part of an agent. Omitted fields are left alone. Set status to 'active' to put it into the front desk's roster. The front desk itself cannot be paused into a draft and always keeps transfer_to_agent.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().describe("Agent name, customer-facing name, or id"),
        name: z.string().optional(),
        botName: z.string().optional(),
        role: z.string().optional(),
        routingDescription: z.string().optional(),
        acceptsHandoff: z
          .boolean()
          .optional()
          .describe("False takes the agent out of every routing roster"),
        objective: z.string().optional(),
        jobDescription: z.string().optional(),
        greeting: z.string().optional(),
        tone: toneArg,
        rules: z.array(z.string()).optional().describe("Replaces the whole list"),
        guardrails: z.array(z.string()).optional().describe("Replaces the whole list"),
        escalationPolicy: z.string().optional(),
        promptOverride: z
          .string()
          .optional()
          .describe("Appended to the system prompt verbatim"),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxSteps: z.number().int().min(1).max(12).optional().describe("Tool-loop budget"),
        historyLimit: z.number().int().min(1).max(50).optional(),
        knowledgeEnabled: z.boolean().optional(),
        knowledgeTopK: z.number().int().min(1).max(20).optional(),
        builtinTools: z
          .array(z.enum(BUILTIN_TOOL_KEYS))
          .optional()
          .describe("Replaces the whole list"),
        status: z.enum(["draft", "active", "paused"]).optional(),
      },
    },
    handler(async ({ workspace, agent, tone, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);

      // The stored tone is a complete object, so a partial one has to be merged
      // rather than sent through.
      const merged = tone ? { ...target.tone, ...tone } : undefined;

      await call.mutation(api.agents.update, {
        agentId: target._id,
        ...fields,
        ...(merged ? { tone: merged } : {}),
      });
      return ok(`Updated ${target.botName} (${target.name}).`);
    })
  );

  server.registerTool(
    "delete_agent",
    {
      title: "Delete agent",
      description:
        "Permanently delete an agent, with its conversations, channels, agent-scoped knowledge and agent-scoped tools. The front desk cannot be deleted while a channel still points at it.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().describe("Agent name, customer-facing name, or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, agent }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);
      await call.mutation(api.agents.remove, { agentId: target._id });
      return ok(`Deleted ${target.botName} (${target.name}) and everything scoped to it.`);
    })
  );

  server.registerTool(
    "draft_agent",
    {
      title: "Draft an agent from a brief",
      description:
        "Have the platform's own model write a whole agent configuration — persona, tone, rules, guardrails, tools — from a paragraph describing the job. Uses the workspace's description, facts and catalogue as context, and costs tokens against the workspace. Review with get_agent, then activate.",
      inputSchema: {
        ...workspaceArg,
        brief: z
          .string()
          .min(20)
          .describe(
            "What this agent should do, in a sentence or two. Be specific about what it must collect and what it must never say."
          ),
      },
    },
    handler(async ({ workspace, brief }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.ai.draftAgent, {
        workspaceId: found._id,
        brief,
      });
      return ok({
        agentId: result.agentId,
        draft: result.draft,
        next: "Set routingDescription and status:'active' with update_agent.",
      });
    })
  );

  server.registerTool(
    "ensure_front_desk",
    {
      title: "Ensure the front desk exists",
      description:
        "Provision the workspace's default bot — the front desk that answers first on every channel and routes each conversation to the right agent. Idempotent. With repointChannels it also sends the existing channels through it, which changes how live WhatsApp numbers behave.",
      inputSchema: {
        ...workspaceArg,
        repointChannels: z
          .boolean()
          .optional()
          .describe(
            "Point every existing channel at the front desk. Default false."
          ),
      },
    },
    handler(async ({ workspace, repointChannels }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.mutation(api.agents.ensureDefaultRouter, {
        workspaceId: found._id,
        repointChannels: repointChannels ?? false,
      });
      return ok({
        agentId: result.agentId,
        created: result.created,
        channelsRepointed: result.repointed ?? 0,
      });
    })
  );

  server.registerTool(
    "chat_with_agent",
    {
      title: "Talk to an agent",
      description:
        "Send a message as a test customer and get the agent's real reply — the same engine WhatsApp and the website widget use, so knowledge retrieval, catalogue lookups, tools and routing all run. Point it at the front desk to test routing: handoffPath shows which agents the message passed through. Costs model tokens against the workspace.",
      inputSchema: {
        ...workspaceArg,
        agent: z
          .string()
          .describe(
            "Which agent receives the message. Use the front desk to test routing."
          ),
        message: z.string().describe("What the customer says"),
        session: z
          .string()
          .optional()
          .describe(
            "Conversation to continue. Defaults to one per agent, so repeated calls carry on the same thread."
          ),
        restart: z
          .boolean()
          .optional()
          .describe("Wipe the thread first and start from a clean conversation"),
      },
    },
    handler(async ({ workspace, agent, message, session: sessionId, restart }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findAgent(found._id, agent);
      const externalId = sessionId?.trim() || `mcp-${target._id}`;

      if (restart) {
        const existing = await call.query(api.conversations.findWebConversation, {
          agentId: target._id,
          sessionId: externalId,
        });
        if (existing) {
          await call.mutation(api.conversations.reset, {
            conversationId: existing._id,
          });
        }
      }

      const result = await call.action(api.engine.respondAsUser, {
        agentId: target._id,
        channelType: "web",
        externalId,
        contactName: "MCP test",
        text: message,
      });

      return ok({
        reply: result.text,
        answeredBy: result.agentBotName ?? null,
        handoffPath: result.handoffPath ?? [],
        toolsCalled: result.toolCalls,
        session: externalId,
        ok: result.ok,
        error: result.error ?? null,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "The catalogue. Agents refuse to discuss anything not listed here, and never quote a price a product does not carry.",
      inputSchema: {
        ...workspaceArg,
        search: z.string().optional(),
        category: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, search, category }) => {
      const found = await resolveWorkspace(workspace);
      const products = await call.query(api.products.listByWorkspace, {
        workspaceId: found._id,
        search,
        category,
      });
      return ok(products.map(productBrief));
    })
  );

  const productFields = {
    sku: z.string().optional(),
    category: z.string().optional().describe("Defaults to 'General'"),
    description: z.string().optional(),
    price: z
      .number()
      .optional()
      .describe(
        "Leave unset and agents are told never to quote — the team quotes manually."
      ),
    unit: z.string().optional().describe("What the price is per, e.g. 'per 1000'"),
    requirementFields: z
      .array(requirementFieldArg)
      .optional()
      .describe(
        "The spec questions an agent must collect before it can record an order for this product."
      ),
    attributes: z
      .array(kvArg)
      .optional()
      .describe("Extra facts an agent may state — lead time, minimum order"),
    imageUrls: z
      .array(z.string())
      .optional()
      .describe(
        "Image URLs, first is the catalogue thumbnail. Uploading files is the dashboard's job; this takes addresses."
      ),
    exampleSpec: z.string().optional(),
    notes: z.string().optional().describe("Internal — never shown to customers"),
    tags: z.array(z.string()).optional(),
  };

  const toImages = (imageUrls) =>
    imageUrls === undefined
      ? undefined
      : imageUrls
          .map((url) => url.trim())
          .filter(Boolean)
          .map((url) => ({ externalUrl: url }));

  server.registerTool(
    "create_product",
    {
      title: "Create product",
      description:
        "Add a product to the catalogue. Set requirementFields to the questions an agent must ask before it can take an order for it — that is what turns a chat into a complete enquiry.",
      inputSchema: {
        ...workspaceArg,
        name: z.string(),
        currency: z
          .string()
          .optional()
          .describe("Defaults to the workspace currency when a price is given"),
        ...productFields,
      },
    },
    handler(async ({ workspace, imageUrls, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const productId = await call.mutation(api.products.create, {
        workspaceId: found._id,
        currency: fields.price !== undefined ? fields.currency ?? found.currency : undefined,
        ...fields,
        images: toImages(imageUrls),
      });
      return ok({ productId, name: fields.name });
    })
  );

  server.registerTool(
    "update_product",
    {
      title: "Update product",
      description:
        "Change a product. Omitted fields are left alone; arrays replace the whole list.",
      inputSchema: {
        ...workspaceArg,
        product: z.string().describe("Product name, SKU, slug or id"),
        name: z.string().optional(),
        currency: z.string().optional(),
        status: z.enum(["active", "archived"]).optional(),
        ...productFields,
      },
    },
    handler(async ({ workspace, product, imageUrls, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findProduct(found._id, product);
      await call.mutation(api.products.update, {
        productId: target._id,
        ...fields,
        images: toImages(imageUrls),
      });
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_product",
    {
      title: "Delete product",
      description:
        "Permanently delete a product and its uploaded images. Archiving with update_product status:'archived' is usually better — it keeps the record and stops agents offering it.",
      inputSchema: {
        ...workspaceArg,
        product: z.string().describe("Product name, SKU, slug or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, product }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findProduct(found._id, product);
      await call.mutation(api.products.remove, { productId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );

  server.registerTool(
    "import_products",
    {
      title: "Import products",
      description:
        "Create or update many products at once, matched by name. A product already in the catalogue is updated rather than duplicated. Omitting imageUrls on an existing product keeps the images it already has.",
      inputSchema: {
        ...workspaceArg,
        products: z
          .array(
            z.object({
              name: z.string(),
              currency: z.string().optional(),
              ...productFields,
            })
          )
          .min(1),
      },
    },
    handler(async ({ workspace, products }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.mutation(api.products.bulkImport, {
        workspaceId: found._id,
        products: products.map(({ imageUrls, ...rest }) => ({
          ...rest,
          imageUrls: imageUrls?.map((url) => url.trim()).filter(Boolean),
        })),
      });
      return ok(result);
    })
  );

  server.registerTool(
    "draft_catalogue",
    {
      title: "Draft a starter catalogue",
      description:
        "Have the platform's own model draft a starter catalogue from the workspace's industry and description, including the spec questions for each product. Costs tokens against the workspace. Review with list_products afterwards — it is a starting point, not a price list.",
      inputSchema: {
        ...workspaceArg,
        brief: z
          .string()
          .optional()
          .describe("Extra steer, e.g. 'focus on large-format print'"),
      },
    },
    handler(async ({ workspace, brief }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.ai.draftCatalogue, {
        workspaceId: found._id,
        brief,
      });
      return ok(result);
    })
  );

  // ---------------------------------------------------------------------------
  // Knowledge base
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_knowledge",
    {
      title: "List knowledge sources",
      description:
        "What agents can retrieve from. A source scoped to an agent is private to it; an unscoped one is available to every agent in the workspace. Status must reach 'ready' before it is searchable.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const sources = await call.query(api.knowledge.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        sources.map((source) => ({
          id: source._id,
          title: source.title,
          kind: source.kind,
          status: source.status,
          scope: source.agentId ? "one agent" : "whole workspace",
          agentName: source.agentName ?? null,
          chunks: source.chunkCount,
          characters: source.charCount,
          tags: source.tags,
          url: source.url ?? null,
          failureReason: source.failureReason ?? null,
        }))
      );
    })
  );

  server.registerTool(
    "add_knowledge",
    {
      title: "Add knowledge",
      description:
        "Add a policy, FAQ, spec sheet or web page to the knowledge base. It is chunked and embedded in the background, so it becomes searchable a few seconds later — check list_knowledge for status 'ready'. Uploading files is the dashboard's job; this takes text or a URL.",
      inputSchema: {
        ...workspaceArg,
        title: z.string().describe("How this source is labelled in citations"),
        kind: z
          .enum(["text", "faq", "url"])
          .describe(
            "text for prose, faq for question/answer pairs, url to fetch a page"
          ),
        content: z
          .string()
          .optional()
          .describe("The text itself, for kind text or faq"),
        url: z.string().optional().describe("The page to fetch, for kind url"),
        agent: z
          .string()
          .optional()
          .describe(
            "Scope this source to one agent. Omit to make it available to every agent."
          ),
        tags: z.array(z.string()).optional(),
      },
    },
    handler(async ({ workspace, title, kind, content, url, agent, tags }) => {
      const found = await resolveWorkspace(workspace);
      const scoped = agent ? await findAgent(found._id, agent) : null;

      const sourceId = await call.mutation(api.knowledge.addSource, {
        workspaceId: found._id,
        agentId: scoped?._id,
        title,
        kind,
        rawText: kind === "url" ? undefined : content,
        url: kind === "url" ? url : undefined,
        tags,
      });
      return ok({
        sourceId,
        note: "Embedding runs in the background. Check list_knowledge for status 'ready'.",
      });
    })
  );

  server.registerTool(
    "delete_knowledge",
    {
      title: "Delete a knowledge source",
      description:
        "Permanently delete a source and everything embedded from it. Agents stop being able to retrieve it immediately.",
      inputSchema: {
        ...workspaceArg,
        source: z.string().describe("Source title or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, source }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findKnowledge(found._id, source);
      await call.mutation(api.knowledge.remove, { sourceId: target._id });
      return ok(`Deleted "${target.title}".`);
    })
  );

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Custom tools
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_custom_tools",
    {
      title: "List custom tools",
      description:
        "Tools defined for this workspace, beyond the builtin ones. Only 'enabled' tools are given to the model. A tool scoped to an agent is private to it.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const tools = await call.query(api.tools.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        tools.map((tool) => ({
          id: tool._id,
          name: tool.name,
          displayName: tool.displayName,
          description: tool.description,
          whenToUse: tool.whenToUse ?? null,
          kind: tool.kind,
          status: tool.status,
          scope: tool.agentId ? "one agent" : "whole workspace",
          parameters: tool.parameters,
          http: tool.http ?? null,
          dbQuery: tool.dbQuery ?? null,
          callCount: tool.callCount,
        }))
      );
    })
  );

  const toolParameterArg = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean"]),
    description: z.string().describe("The model reads this to fill the value in"),
    required: z.boolean(),
    enumValues: z.array(z.string()).optional(),
  });

  server.registerTool(
    "create_custom_tool",
    {
      title: "Create custom tool",
      description:
        "Give agents a new capability: an HTTP request to your own system, or a lookup against this workspace's own products / orders / contacts. The description is what drives the model's decision to call it, so write it as 'what this does and when to use it'. Starts as a draft — set status 'enabled' to hand it to the model.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().describe("snake_case identifier the model calls"),
        description: z
          .string()
          .describe("Model-facing. This is what drives tool selection."),
        whenToUse: z.string().optional(),
        displayName: z.string().optional(),
        kind: z.enum(["http", "db_query"]),
        parameters: z.array(toolParameterArg).optional(),
        agent: z
          .string()
          .optional()
          .describe("Scope to one agent. Omit for the whole workspace."),
        status: z.enum(["draft", "enabled", "disabled"]).optional(),
        http: z
          .object({
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            urlTemplate: z
              .string()
              .describe("Supports {{paramName}} placeholders"),
            headers: z.array(kvArg).optional(),
            bodyTemplate: z
              .string()
              .optional()
              .describe("Also supports {{paramName}}. Defaults to the raw input as JSON."),
            timeoutMs: z.number().optional(),
          })
          .optional(),
        dbQuery: z
          .object({
            table: z.enum(["products", "orders", "contacts"]),
            searchParam: z
              .string()
              .optional()
              .describe("Which parameter holds the free-text search term"),
            limit: z.number().int().min(1).max(100),
          })
          .optional(),
      },
    },
    handler(async ({ workspace, agent, http, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const scoped = agent ? await findAgent(found._id, agent) : null;

      const toolId = await call.mutation(api.tools.create, {
        workspaceId: found._id,
        agentId: scoped?._id,
        ...fields,
        http: http ? { ...http, headers: http.headers ?? [] } : undefined,
      });
      return ok({ toolId, next: "Set status 'enabled' to give it to the model." });
    })
  );

  server.registerTool(
    "update_custom_tool",
    {
      title: "Update custom tool",
      description:
        "Change a custom tool. Set status 'enabled' to give it to the model, 'disabled' to take it away without deleting it.",
      inputSchema: {
        ...workspaceArg,
        tool: z.string().describe("Tool name or id"),
        description: z.string().optional(),
        whenToUse: z.string().optional(),
        displayName: z.string().optional(),
        parameters: z.array(toolParameterArg).optional(),
        status: z.enum(["draft", "enabled", "disabled"]).optional(),
      },
    },
    handler(async ({ workspace, tool, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findCustomTool(found._id, tool);
      await call.mutation(api.tools.update, { toolId: target._id, ...fields });
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_custom_tool",
    {
      title: "Delete custom tool",
      description: "Permanently delete a custom tool.",
      inputSchema: {
        ...workspaceArg,
        tool: z.string().describe("Tool name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, tool }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findCustomTool(found._id, tool);
      await call.mutation(api.tools.remove, { toolId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );

  // ---------------------------------------------------------------------------
  // Operations — reading what the agents actually did
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description:
        "Recent threads. 'handedOff' means the front desk routed it on, and activeAgentName is whoever holds it now — the fastest way to see whether routing is working in the real world.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().optional().describe("Only threads that arrived at this agent"),
        status: z.enum(["open", "escalated", "closed"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, agent, status, limit }) => {
      const found = await resolveWorkspace(workspace);
      const agentId = agent ? (await findAgent(found._id, agent))._id : undefined;

      const rows = await call.query(api.conversations.listByWorkspace, {
        workspaceId: found._id,
        agentId,
        limit: limit ?? 40,
      });

      return ok(
        rows
          .filter((row) => !status || row.status === status)
          .map((row) => ({
            id: row._id,
            contact: row.contactLabel,
            channel: row.channelType,
            arrivedAt: row.agentName,
            heldBy: row.activeAgentName,
            handedOff: row.handedOff,
            status: row.status,
            messages: row.messageCount,
            lastMessageAt: new Date(row.lastMessageAt).toISOString(),
            preview: row.lastMessagePreview ?? null,
          }))
      );
    })
  );

  server.registerTool(
    "read_conversation",
    {
      title: "Read a conversation",
      description:
        "The full transcript of one thread, including the tool calls the agent made and the internal handoffs between agents. Use it to work out why an agent answered the way it did.",
      inputSchema: {
        ...workspaceArg,
        conversationId: z.string().describe("From list_conversations"),
        includeToolCalls: z.boolean().optional().describe("Default true"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ conversationId, includeToolCalls }) => {
      const detail = await call.query(api.conversations.getWithContact, {
        conversationId,
      });
      if (!detail) throw new Error("No such conversation.");

      const messages = await call.query(api.conversations.listMessages, {
        conversationId,
      });
      const withTools = includeToolCalls !== false;

      return ok({
        contact: {
          name: detail.contact?.name ?? null,
          phone: detail.contact?.phone ?? null,
          email: detail.contact?.email ?? null,
          company: detail.contact?.company ?? null,
          remark: detail.contact?.remark ?? null,
          remark: detail.contact?.remark ?? null,
        },
        arrivedAt: detail.agent?.botName ?? null,
        status: detail.conversation.status,
        transcript: messages
          .filter((message) => withTools || message.kind === "text")
          .map((message) => {
            if (message.kind === "tool") {
              return {
                tool: message.toolName,
                ok: message.toolOk,
                input: message.toolInput,
                output: message.toolOutput,
              };
            }
            if (message.kind === "handoff") {
              return { handoff: message.text };
            }
            if (message.kind === "error") {
              return { error: message.text };
            }
            return {
              role: message.role,
              text: message.text,
              at: new Date(message.createdAt).toISOString(),
            };
          }),
      });
    })
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description:
        "Everyone who has talked to the agents, with who owns them and who is handling them.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const contacts = await call.query(api.contacts.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        contacts.map((contact) => ({
          id: contact._id,
          name: contact.name ?? null,
          phone: contact.phone ?? null,
          email: contact.email ?? null,
          company: contact.company ?? null,
          channel: contact.channelType,
          handledBy: contact.handledBy,
          remark: contact.remark ?? null,
          conversationId: contact.conversationId,
          lastSeenAt: new Date(contact.lastSeenAt).toISOString(),
        }))
      );
    })
  );

  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "Enquiries and orders the agents captured, with the specs they collected for each line.",
      inputSchema: {
        ...workspaceArg,
        status: z
          .enum([
            "new",
            "quoted",
            "confirmed",
            "in_progress",
            "completed",
            "cancelled",
          ])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, status, limit }) => {
      const found = await resolveWorkspace(workspace);
      const orders = await call.query(api.orders.listByWorkspace, {
        workspaceId: found._id,
        status,
        limit: limit ?? 40,
      });
      return ok(
        orders.map((order) => ({
          orderNumber: order.orderNumber,
          status: order.status,
          customer: order.customer,
          items: order.items,
          delivery: order.delivery ?? null,
          notes: order.notes ?? null,
          source: order.source,
          createdAt: new Date(order.createdAt).toISOString(),
        }))
      );
    })
  );

  // ---------------------------------------------------------------------------
  // Platform administration
  //
  // Every tool here needs the server signed in as an admin; as a workspace they
  // fail with "Administrator access required" from the Convex guard, which is the
  // correct answer rather than something to pre-empt here.
  //
  // The workspace-naming tools take a mandatory slug — see requireNamedWorkspace.
  // ---------------------------------------------------------------------------

  server.registerTool(
    "create_workspace",
    {
      title: "Create workspace",
      description:
        "Onboard a new company. This is the first step for a new customer: the workspace holds its own agents, catalogue, knowledge and channels, and nothing is shared with any other workspace. Fill in description, industry and facts properly — they reach every agent's system prompt, so a well-described workspace produces better agents before any of them is configured. Follow with issue_workspace_password to give the company its own login.",
      inputSchema: {
        name: z.string().describe("The company name. The slug is derived from it."),
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
      workspaceCache.delete(found.slug);
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
      workspaceCache.delete(found.slug);
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

  return server;
}

// ---------------------------------------------------------------------------

/**
 * stdio: one client, launched as a child process. Claude Code and Claude
 * Desktop work this way.
 */
async function serveStdio() {
  await buildServer().connect(new StdioServerTransport());
  console.error("[magic-ai-bot mcp] listening on stdio");
}

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
async function serveHttp() {
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
        "[magic-ai-bot mcp] MAGIC_AI_BOT_MCP_TOKEN must be set to at least 24 characters",
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
      return send(res, 200, { ok: true, server: "magic-ai-bot" });
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
      console.error("[magic-ai-bot mcp] request failed:", error?.message ?? error);
      if (!res.headersSent) send(res, 500, { error: "Internal error" });
    }
  });

  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  console.error(
    [
      `[magic-ai-bot mcp] http://${host}:${port}/mcp/<token>`,
      host === "127.0.0.1"
        ? "  bound to loopback — put a tunnel or reverse proxy in front to reach it from claude.ai"
        : "  bound to a public interface — make sure it is behind HTTPS",
    ].join("\n")
  );
}

async function main() {
  // Fail loudly at startup rather than on the first tool call, so a broken
  // config shows up when the client connects.
  await authorize();
  console.error(
    `[magic-ai-bot mcp] signed in as ${session.label} (${session.role})`
  );

  const wantsHttp =
    process.argv.includes("--http") ||
    ["1", "true", "yes"].includes(
      String(setting("MAGIC_AI_BOT_MCP_HTTP") ?? "").toLowerCase()
    );

  if (wantsHttp) await serveHttp();
  else await serveStdio();
}

// Only when this file is the process entry point. Imported — by the Next route
// handler — it must define the tools and nothing else.
const invokedDirectly =
  Boolean(process.argv[1]) &&
  resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      "[magic-ai-bot mcp] failed to start:",
      error?.message ?? error
    );
    process.exit(1);
  });
}
