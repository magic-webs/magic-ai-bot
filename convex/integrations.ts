// Integrations — connecting, disconnecting, and what the tool endpoints read.
//
// The OAuth handshake is deliberately lopsided. Starting it is an action the
// signed-in console calls, because only the console knows who is asking;
// finishing it is an HTTP route on the Convex deployment, because that is
// where Google can reach and where the client secret lives. The `state` row
// written by the first and consumed by the second is the only thing joining
// them — see `integrationOAuthStates` in the schema.
//
// Connecting writes the `tools` rows itself rather than leaving the browser to
// do it. A half-connected integration — consent granted, tools missing
// because a tab was closed — would look connected to Google and broken here.

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { randomKey } from "./lib/shared";
import {
  BOOKABLE_FROM_HOUR,
  BOOKABLE_TO_HOUR,
  ENQUIRY_SHEET_HEADERS,
  findIntegration,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_IDENTITY_SCOPES,
  googleRedirectUri,
  integrationToolUrl,
  SLOT_MINUTES,
} from "./lib/integrations";
import {
  addMinutesLocal,
  appendRow,
  createEvent,
  createFolder,
  createSpreadsheet,
  exchangeCode,
  freeSlots,
  GoogleError,
  isFree,
  parseLocalDateTime,
  refreshAccessToken,
  searchFolder,
  zonedToInstant,
} from "./lib/google";
import { requireWorkspace } from "./lib/auth";

/** An OAuth handshake nobody finished is rubbish after this long. */
const STATE_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every connection in a workspace, without the credentials.
 *
 * The refresh token and the call token are both live credentials — the call
 * token is the whole authorisation on a public endpoint — so neither leaves
 * the server. The page needs the account, the state and what was provisioned,
 * which is all that comes back.
 */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("integrationConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return rows.map((row) => ({
      integration: row.integration,
      accountEmail: row.accountEmail,
      status: row.status,
      resource: row.resource,
      lastError: row.lastError,
      lastUsedAt: row.lastUsedAt,
      connectedAt: row.createdAt,
    }));
  },
});

/** Whether this deployment can do OAuth at all, so the UI can say so. */
export const configured = query({
  args: {},
  handler: async () => ({
    google: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
  }),
});

// ---------------------------------------------------------------------------
// Starting the handshake
// ---------------------------------------------------------------------------

/**
 * The Google consent URL for one integration.
 *
 * An action rather than a mutation because the state needs real randomness:
 * mutations run on a deterministic seed, and a guessable state is a CSRF hole
 * on a route that stores a refresh token.
 */
export const startGoogleConnect = action({
  args: {
    workspaceId: v.id("workspaces"),
    integration: v.string(),
    /** The console's own origin, so the callback can send the browser home. */
    returnTo: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const spec = findIntegration(args.integration);
    if (!spec) throw new Error("Unknown integration");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error(
        "Google is not configured on this deployment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
      );
    }

    const siteUrl = process.env.CONVEX_SITE_URL ?? "";
    const state = `${randomKey(16)}${randomKey(16)}`;

    await ctx.runMutation(internal.integrations.putState, {
      state,
      workspaceId: args.workspaceId,
      integration: args.integration,
      returnTo: args.returnTo,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: googleRedirectUri(siteUrl),
      response_type: "code",
      scope: [...spec.scopes, ...GOOGLE_IDENTITY_SCOPES].join(" "),
      // Offline plus an explicit consent screen: Google withholds the refresh
      // token when it thinks the app already has one, and a connection with no
      // refresh token works until the first hour is up and then never again.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });

    return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` };
  },
});

export const putState = internalMutation({
  args: {
    state: v.string(),
    workspaceId: v.id("workspaces"),
    integration: v.string(),
    returnTo: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("integrationOAuthStates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Reads a state and deletes it, so a callback cannot be replayed. */
export const takeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("integrationOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) return null;

    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > STATE_TTL_MS) return null;

    return {
      workspaceId: row.workspaceId,
      integration: row.integration,
      returnTo: row.returnTo,
    };
  },
});

export const sweepStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STATE_TTL_MS;
    const stale = await ctx.db.query("integrationOAuthStates").collect();
    let removed = 0;
    for (const row of stale) {
      if (row.createdAt >= cutoff) continue;
      await ctx.db.delete(row._id);
      removed++;
    }
    return { removed };
  },
});

// ---------------------------------------------------------------------------
// Finishing the handshake
// ---------------------------------------------------------------------------

/**
 * What the callback needs to know before it calls Google.
 *
 * `resource` comes back so a reconnect reuses the spreadsheet or folder it
 * already made. Without it, every reconnect would leave another "— Enquiries"
 * sheet in their Drive and start writing to the newest one.
 */
export const connectContext = internalQuery({
  args: { workspaceId: v.id("workspaces"), integration: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;

    const existing = await ctx.db
      .query("integrationConnections")
      .withIndex("by_workspace_integration", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("integration", args.integration)
      )
      .unique();

    // Only what the callback uses: the name it puts on the sheet or folder,
    // and whether there is already one to reuse.
    return { workspaceName: workspace.name, resource: existing?.resource };
  },
});

/**
 * Store the grant and write the tools.
 *
 * One mutation so the two cannot come apart: a workspace either has a
 * connection with its tools, or neither.
 */
export const completeConnect = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    integration: v.string(),
    accountEmail: v.optional(v.string()),
    scopes: v.array(v.string()),
    refreshToken: v.string(),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    resource: v.optional(
      v.object({
        id: v.string(),
        name: v.string(),
        url: v.optional(v.string()),
      })
    ),
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const spec = findIntegration(args.integration);
    if (!spec) throw new Error("Unknown integration");

    const now = Date.now();
    const existing = await ctx.db
      .query("integrationConnections")
      .withIndex("by_workspace_integration", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("integration", args.integration)
      )
      .unique();

    // Reconnecting keeps the call token, so tool rows that are about to be
    // rewritten with the same URL stay byte-identical and nothing that has
    // cached one is left pointing at a dead endpoint.
    const callToken = existing?.callToken ?? `${randomKey(16)}${randomKey(16)}`;

    const connection = {
      workspaceId: args.workspaceId,
      integration: args.integration,
      provider: "google" as const,
      accountEmail: args.accountEmail,
      scopes: args.scopes,
      refreshToken: args.refreshToken,
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      resource: args.resource ?? existing?.resource,
      callToken,
      status: "connected" as const,
      lastError: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, connection);
    } else {
      await ctx.db.insert("integrationConnections", {
        ...connection,
        createdAt: now,
      });
    }

    // Replace rather than upsert the tools: a tool somebody renamed or edited
    // would otherwise survive alongside its replacement, enabled, pointing at
    // whatever it was last pointed at.
    await removeIntegrationTools(ctx, args.workspaceId, args.integration);

    // The name is the model's handle for a tool and the key the per-agent
    // switches use, so it cannot be uniquified the way tools.create does —
    // `book_meeting_2` would never match the catalogue again. A hand-written
    // tool already holding the name would instead be silently shadowed in the
    // registry the engine builds, so refuse the whole connection and say which
    // name is in the way. The mutation is transactional, so nothing is left
    // half-connected.
    const names = spec.tools.map((tool) => tool.name);
    for (const name of names) {
      const clash = await ctx.db
        .query("tools")
        .withIndex("by_workspace_name", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("name", name)
        )
        .unique();
      if (clash) {
        throw new Error(
          `This workspace already has a tool called "${name}". Rename it on the Custom tools page, then connect ${spec.name} again.`
        );
      }
    }

    for (const tool of spec.tools) {
      await ctx.db.insert("tools", {
        workspaceId: args.workspaceId,
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        whenToUse: tool.whenToUse,
        kind: "http",
        parameters: tool.parameters,
        http: {
          method: "POST",
          urlTemplate: integrationToolUrl(
            args.siteUrl,
            tool.action,
            callToken
          ),
          headers: [],
          timeoutMs: 15000,
        },
        // Enabled means "this tool works", not "every agent has it". Which
        // agents may call it is `agents.integrationTools`, set under Knowledge
        // & tools — so connecting never silently widens what a live agent can
        // do.
        status: "enabled",
        origin: "manual",
        integration: args.integration,
        callCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { tools: spec.tools.length };
  },
});

// ---------------------------------------------------------------------------
// Disconnecting
// ---------------------------------------------------------------------------

async function removeIntegrationTools(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  integration: string
): Promise<number> {
  const tools = await ctx.db
    .query("tools")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  let removed = 0;
  for (const tool of tools) {
    if (tool.integration !== integration) continue;
    await ctx.db.delete(tool._id);
    removed++;
  }
  return removed;
}

export const disconnect = mutation({
  args: { workspaceId: v.id("workspaces"), integration: v.string() },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const spec = findIntegration(args.integration);

    const connection = await ctx.db
      .query("integrationConnections")
      .withIndex("by_workspace_integration", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("integration", args.integration)
      )
      .unique();
    if (connection) await ctx.db.delete(connection._id);

    const removed = await removeIntegrationTools(
      ctx,
      args.workspaceId,
      args.integration
    );

    // Take the tools off the agents too. Leaving the names behind would mean a
    // later reconnect silently re-arming whichever agents happened to have it
    // switched on months ago.
    const names = new Set((spec?.tools ?? []).map((tool) => tool.name));
    if (names.size > 0) {
      const agents = await ctx.db
        .query("agents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const agent of agents) {
        const enabled = agent.integrationTools ?? [];
        const kept = enabled.filter((name) => !names.has(name));
        if (kept.length === enabled.length) continue;
        await ctx.db.patch(agent._id, {
          integrationTools: kept,
          updatedAt: Date.now(),
        });
      }
    }

    return { removed };
  },
});

// ---------------------------------------------------------------------------
// Serving a tool call
// ---------------------------------------------------------------------------

/** Resolve a call token to the connection behind it. Secrets included. */
export const byCallToken = internalQuery({
  args: { callToken: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("integrationConnections")
      .withIndex("by_call_token", (q) => q.eq("callToken", args.callToken))
      .unique();
    if (!connection) return null;

    const workspace = await ctx.db.get("workspaces", connection.workspaceId);
    return {
      id: connection._id,
      workspaceId: connection.workspaceId,
      integration: connection.integration,
      refreshToken: connection.refreshToken,
      accessToken: connection.accessToken,
      accessTokenExpiresAt: connection.accessTokenExpiresAt,
      resource: connection.resource,
      status: connection.status,
      // Every local time an agent says or hears is in the company's zone, not
      // the server's and not the calendar's.
      timezone: workspace?.timezone ?? "UTC",
      workspaceName: workspace?.name ?? "",
    };
  },
});

export const cacheAccessToken = internalMutation({
  args: {
    connectionId: v.id("integrationConnections"),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      status: "connected",
      lastError: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const recordUse = internalMutation({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, { lastUsedAt: Date.now() });
  },
});

/**
 * Mark a connection as needing a human.
 *
 * Only for a grant that is actually gone — a revoked token, a removed scope.
 * A timeout or a 500 from Google is not a reason to tell somebody to
 * reconnect, so the callers pass `needsReauth` from the error rather than
 * calling this on every failure.
 */
export const markNeedsReauth = internalMutation({
  args: {
    connectionId: v.id("integrationConnections"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      status: "needs_reauth",
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      lastError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

export const recordError = internalMutation({
  args: { connectionId: v.id("integrationConnections"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      lastError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// The two actions behind the HTTP routes.
//
// They live here rather than in http.ts so the routes stay thin adapters —
// parse, call, answer — and everything that can fail has its reason written
// next to it.
// ---------------------------------------------------------------------------

type Connection = {
  id: Id<"integrationConnections">;
  workspaceId: Id<"workspaces">;
  integration: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  resource?: { id: string; name: string; url?: string };
  timezone: string;
  workspaceName: string;
};

/**
 * A usable access token, refreshing only when the cached one has run out.
 *
 * Google rate-limits token requests, and a conversation can call three tools
 * in one turn — so the token is cached on the connection and reused until a
 * minute before it expires.
 */
async function freshAccessToken(
  ctx: ActionCtx,
  connection: Connection
): Promise<string> {
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt > Date.now()
  ) {
    return connection.accessToken;
  }

  const grant = await refreshAccessToken(connection.refreshToken);
  await ctx.runMutation(internal.integrations.cacheAccessToken, {
    connectionId: connection.id,
    accessToken: grant.accessToken,
    accessTokenExpiresAt: grant.expiresAt,
  });
  return grant.accessToken;
}

const str = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value).trim();

/** "2026-09-18 14:30" in the company's zone — sortable, and readable. */
function stampFor(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(",", "");
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

async function dispatch(
  connection: Connection,
  accessToken: string,
  action: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const timeZone = connection.timezone;

  if (action === "sheets/append") {
    const spreadsheetId = connection.resource?.id;
    if (!spreadsheetId) {
      throw new GoogleError(
        "No spreadsheet is linked to this workspace. Reconnect Google Sheets.",
        true
      );
    }
    const name = str(input.name);
    const summary = str(input.summary);
    if (!name || !summary) {
      return { ok: false, error: "Send at least a name and a summary." };
    }

    const value = input.value;
    const result = await appendRow(accessToken, spreadsheetId, [
      stampFor(timeZone),
      name,
      str(input.phone),
      str(input.email),
      summary,
      value === undefined || value === null || value === "" ? "" : Number(value),
    ]);
    return { ok: true, row: result.row, sheet: connection.resource?.name };
  }

  if (action === "calendar/availability") {
    const date = str(input.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "Send date as YYYY-MM-DD." };
    }
    const free = await freeSlots(
      accessToken,
      date,
      timeZone,
      BOOKABLE_FROM_HOUR,
      BOOKABLE_TO_HOUR
    );
    return {
      ok: true,
      date,
      timezone: timeZone,
      slotMinutes: SLOT_MINUTES,
      free,
      ...(free.length === 0
        ? { note: "Nothing free that day. Offer another date." }
        : {}),
    };
  }

  if (action === "calendar/book") {
    const parsed = parseLocalDateTime(str(input.startsAt));
    if (!parsed) {
      return {
        ok: false,
        error:
          "Send startsAt as YYYY-MM-DDTHH:MM in the company's timezone, e.g. 2026-09-24T14:30.",
      };
    }

    const requested = Number(input.minutes);
    const minutes = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(Math.round(requested), 15), 480)
      : SLOT_MINUTES;

    const startsAt = zonedToInstant(
      parsed.date,
      parsed.hour,
      parsed.minute,
      timeZone
    );
    if (startsAt.getTime() < Date.now()) {
      return { ok: false, error: "That time is in the past. Offer another." };
    }

    // Last check before writing: the slot may have gone between the offer and
    // the agreement, and a double booking is worse than a re-ask.
    if (!(await isFree(accessToken, startsAt, minutes))) {
      return {
        ok: false,
        error: "That time has just been taken. Offer another.",
      };
    }

    const event = await createEvent(accessToken, {
      title: str(input.title) || "Meeting",
      notes: str(input.notes) || undefined,
      startLocal: parsed.local,
      endLocal: addMinutesLocal(
        parsed.date,
        parsed.hour,
        parsed.minute,
        timeZone,
        minutes
      ),
      timeZone,
      attendeeEmail: str(input.attendeeEmail) || undefined,
    });

    return {
      ok: true,
      eventId: event.id,
      startsAt: parsed.local,
      minutes,
      timezone: timeZone,
      invited: str(input.attendeeEmail) || null,
    };
  }

  if (action === "drive/search") {
    const folderId = connection.resource?.id;
    if (!folderId) {
      throw new GoogleError(
        "No folder is linked to this workspace. Reconnect Google Drive.",
        true
      );
    }
    const query = str(input.query);
    if (!query) return { ok: false, error: "Send a query." };

    const files = await searchFolder(accessToken, folderId, query);
    return {
      ok: true,
      count: files.length,
      files,
      ...(files.length === 0
        ? { note: `Nothing in ${connection.resource?.name} matches that.` }
        : {}),
    };
  }

  throw new GoogleError("Unknown action");
}

/**
 * Serve one tool call.
 *
 * Failures come back as HTTP 200 with `ok: false` rather than as an error
 * status. The engine hands the body to the model either way, and "that time
 * has just been taken, offer another" is something the model can act on — an
 * HTTP 409 is not.
 */
export const runToolCall = internalAction({
  args: {
    callToken: v.string(),
    action: v.string(),
    input: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ status: number; body: unknown }> => {
    const connection = await ctx.runQuery(internal.integrations.byCallToken, {
      callToken: args.callToken,
    });
    if (!connection) {
      return {
        status: 401,
        body: { ok: false, error: "Unknown or revoked integration token." },
      };
    }

    // The token authorises one integration, not all of them: a Drive token
    // must not be able to write to the diary.
    const spec = findIntegration(connection.integration);
    const known = spec?.tools.some((tool) => tool.action === args.action);
    if (!known) {
      return {
        status: 404,
        body: { ok: false, error: "That endpoint is not part of this integration." },
      };
    }

    const input =
      args.input && typeof args.input === "object"
        ? (args.input as Record<string, unknown>)
        : {};

    try {
      const accessToken = await freshAccessToken(ctx, connection);
      const body = await dispatch(
        connection,
        accessToken,
        args.action,
        input
      );
      await ctx.runMutation(internal.integrations.recordUse, {
        connectionId: connection.id,
      });
      return { status: 200, body };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";

      if (error instanceof GoogleError && error.needsReauth) {
        await ctx.runMutation(internal.integrations.markNeedsReauth, {
          connectionId: connection.id,
          error: message,
        });
        return {
          status: 200,
          body: {
            ok: false,
            error:
              "The company's Google connection needs renewing. Tell them to reconnect it, and do not promise this will happen.",
          },
        };
      }

      await ctx.runMutation(internal.integrations.recordError, {
        connectionId: connection.id,
        error: message,
      });
      return { status: 200, body: { ok: false, error: message } };
    }
  },
});

/**
 * Finish the handshake: take the code, provision what is missing, write the
 * tools.
 *
 * Provisioning happens here rather than on the first tool call because an
 * agent mid-conversation is the wrong moment to discover that a spreadsheet
 * could not be created.
 */
export const finishGoogleConnect = internalAction({
  args: { code: v.string(), state: v.string(), siteUrl: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    returnTo: string | null;
    integration: string | null;
    error?: string;
  }> => {
    const pending = await ctx.runMutation(internal.integrations.takeState, {
      state: args.state,
    });
    if (!pending) {
      return {
        ok: false,
        returnTo: null,
        integration: null,
        error:
          "That sign-in has expired or was already used. Start again from the Integrations page.",
      };
    }

    const spec = findIntegration(pending.integration);
    if (!spec) {
      return {
        ok: false,
        returnTo: pending.returnTo,
        integration: pending.integration,
        error: "Unknown integration.",
      };
    }

    try {
      const grant = await exchangeCode(
        args.code,
        googleRedirectUri(args.siteUrl)
      );
      if (!grant.refreshToken) {
        // Only happens if the consent screen was skipped, which is why the
        // authorize URL always asks for one.
        throw new GoogleError(
          "Google did not return a long-lived token. Remove Magic Agent under your Google account's third-party access and connect again."
        );
      }

      const missing = spec.scopes.filter(
        (scope) => !grant.scopes.includes(scope)
      );
      if (missing.length > 0) {
        throw new GoogleError(
          `The consent screen was not given every permission this needs (${missing.join(", ")}). Connect again and accept all of them.`
        );
      }

      const context = await ctx.runQuery(internal.integrations.connectContext, {
        workspaceId: pending.workspaceId,
        integration: pending.integration,
      });
      if (!context) throw new GoogleError("Workspace not found.");

      // Reconnecting keeps whatever was provisioned the first time, so their
      // Drive does not fill up with near-identical sheets and folders.
      let resource = context.resource;
      if (!resource && pending.integration === "google_sheets") {
        resource = await createSpreadsheet(
          grant.accessToken,
          `${context.workspaceName} — Enquiries`,
          ENQUIRY_SHEET_HEADERS
        );
      }
      if (!resource && pending.integration === "google_drive") {
        resource = await createFolder(
          grant.accessToken,
          `${context.workspaceName} — Agent documents`
        );
      }

      await ctx.runMutation(internal.integrations.completeConnect, {
        workspaceId: pending.workspaceId,
        integration: pending.integration,
        accountEmail: grant.email,
        scopes: grant.scopes,
        refreshToken: grant.refreshToken,
        accessToken: grant.accessToken,
        accessTokenExpiresAt: grant.expiresAt,
        resource,
        siteUrl: args.siteUrl,
      });

      return {
        ok: true,
        returnTo: pending.returnTo,
        integration: pending.integration,
      };
    } catch (error) {
      return {
        ok: false,
        returnTo: pending.returnTo,
        integration: pending.integration,
        error:
          error instanceof Error ? error.message : "Could not finish connecting.",
      };
    }
  },
});
