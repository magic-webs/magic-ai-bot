// Magic apps — connecting Magic Forms and Magic Reward, and taking their
// results back in. The catalogue and the round trip are described at the top
// of convex/lib/apps.ts; this file is the storage and the operator's buttons.
//
// Connecting is an action, not a mutation, for two reasons: it has to call the
// app (to read the account and register the webhook), and the inbound key has
// to be really random — a mutation's randomness is seeded, and this key is the
// whole credential on a public route.

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { randomKey } from "./lib/shared";
import { requireWorkspace } from "./lib/auth";
import {
  APP_TOOL_NAMES,
  findApp,
  readAccount,
  readItems,
  type AppId,
  type AppItem,
} from "./lib/apps";
import { callApp } from "./lib/appClient";
import { storeSubmission, submissionShape } from "./formSubmissions";

const appId = v.union(v.literal("magic_forms"), v.literal("magic_reward"));

const appItem = v.object({
  id: v.string(),
  key: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  url: v.optional(v.string()),
  kind: v.optional(v.string()),
  prefill: v.optional(
    v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        type: v.string(),
        required: v.boolean(),
        multiple: v.boolean(),
        options: v.optional(
          v.array(v.object({ label: v.string(), value: v.string() }))
        ),
      })
    )
  ),
  prizes: v.optional(v.array(v.object({ label: v.string(), isWin: v.boolean() }))),
});

/** A retried delivery only has to be recognised for as long as the retries run. */
const DELIVERY_MEMORY_MS = 3 * 24 * 60 * 60 * 1000;

function catalogueUrl(app: AppId): string {
  return app === "magic_forms" ? "/api/v1/forms" : "/api/v1/offers";
}

async function fetchItems(
  app: AppId,
  connection: { baseUrl: string; apiKey: string }
): Promise<{ ok: true; items: AppItem[] } | { ok: false; error: string }> {
  const response = await callApp(connection, "GET", catalogueUrl(app));
  if (!response.ok) return { ok: false, error: response.error ?? "Unknown error." };
  return { ok: true, items: readItems(app, response.body) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The workspace's connections, without the API key, the webhook secret or the
 * inbound key — any of the three is enough to act as one side or the other.
 */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("appConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(10);

    return rows.map((row) => ({
      app: row.app,
      account: row.account,
      items: row.items.map((item) => ({
        key: item.key,
        title: item.title,
        kind: item.kind ?? null,
        url: item.url ?? null,
      })),
      replyOnResult: row.replyOnResult,
      status: row.status,
      lastError: row.lastError ?? null,
      sentCount: row.sentCount,
      resultCount: row.resultCount,
      lastResultAt: row.lastResultAt ?? null,
      syncedAt: row.syncedAt,
      connectedAt: row.createdAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// Connecting and disconnecting
// ---------------------------------------------------------------------------

export const connect = action({
  args: {
    workspaceId: v.id("workspaces"),
    app: appId,
    apiKey: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ account: { name: string; slug: string }; count: number }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const spec = findApp(args.app);
    if (!spec) throw new Error("Unknown app");

    const apiKey = args.apiKey.trim();
    if (!apiKey.startsWith(spec.keyPrefix)) {
      throw new Error(
        `That is not a ${spec.name} API key — they start with ${spec.keyPrefix}.`
      );
    }

    const baseUrl = process.env[spec.envVar]?.trim() || spec.defaultBaseUrl;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not available.");

    const credentials = { baseUrl, apiKey };

    const me = await callApp(credentials, "GET", "/api/v1/me");
    // The one failure worth its own words: the app is reachable but has no
    // integration API, which means it is running a build from before it.
    if (me.status === 404) {
      throw new Error(
        `${baseUrl} does not have the Magic Agent API yet. Deploy the latest ${spec.name}, then connect again.`
      );
    }
    if (!me.ok) throw new Error(me.error);
    const account = readAccount(args.app, me.body);
    if (!account) {
      throw new Error(`${spec.name} answered, but not with an account.`);
    }

    const catalogue = await fetchItems(args.app, credentials);
    if (!catalogue.ok) throw new Error(catalogue.error);

    // Registered before anything is saved: a connection that cannot hear
    // back from the app would send links whose results vanish.
    const inboundKey = randomKey(32);
    const hook = await callApp(credentials, "POST", "/api/v1/webhooks", {
      url: `${siteUrl.replace(/\/+$/, "")}/apps/${inboundKey}`,
      events: spec.events,
      ...(args.app === "magic_forms" ? { name: "Magic Agent" } : {}),
    });
    if (!hook.ok) {
      throw new Error(`Could not subscribe to ${spec.name}: ${hook.error}`);
    }
    const webhook = (hook.body as { webhook?: { id?: unknown; secret?: unknown } })
      ?.webhook;
    if (typeof webhook?.secret !== "string" || !webhook.secret) {
      throw new Error(`${spec.name} registered the webhook but sent no secret.`);
    }

    const previous = await ctx.runMutation(internal.apps.saveConnection, {
      workspaceId: args.workspaceId,
      app: args.app,
      apiKey,
      baseUrl,
      account,
      inboundKey,
      webhookSecret: webhook.secret,
      remoteWebhookId: typeof webhook.id === "string" ? webhook.id : undefined,
      items: catalogue.items,
    });

    // A reconnect replaced an older subscription. Remove it on the far side,
    // or every result would arrive twice — once at a key that now 404s.
    if (previous?.remoteWebhookId) {
      await callApp(
        previous,
        "DELETE",
        `/api/v1/webhooks/${encodeURIComponent(previous.remoteWebhookId)}`
      );
    }

    return {
      account: { name: account.name, slug: account.slug },
      count: catalogue.items.length,
    };
  },
});

/** Re-read the forms or offers, for the Refresh button. */
export const refresh = action({
  args: { workspaceId: v.id("workspaces"), app: appId },
  handler: async (ctx, args): Promise<{ count: number }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    const connection = await ctx.runQuery(internal.apps.connectionFor, {
      workspaceId: args.workspaceId,
      app: args.app,
    });
    if (!connection) throw new Error("Not connected.");

    const catalogue = await fetchItems(args.app, connection);
    await ctx.runMutation(internal.apps.saveItems, {
      connectionId: connection._id,
      ...(catalogue.ok ? { items: catalogue.items } : { error: catalogue.error }),
    });
    if (!catalogue.ok) throw new Error(catalogue.error);
    return { count: catalogue.items.length };
  },
});

export const setReplyOnResult = mutation({
  args: { workspaceId: v.id("workspaces"), app: appId, value: v.boolean() },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const connection = await ctx.db
      .query("appConnections")
      .withIndex("by_workspace_app", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("app", args.app)
      )
      .unique();
    if (!connection) throw new Error("Not connected.");
    await ctx.db.patch(connection._id, {
      replyOnResult: args.value,
      updatedAt: Date.now(),
    });
  },
});

export const disconnect = action({
  args: { workspaceId: v.id("workspaces"), app: appId },
  handler: async (ctx, args): Promise<{ unsubscribed: boolean }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    const connection = await ctx.runQuery(internal.apps.connectionFor, {
      workspaceId: args.workspaceId,
      app: args.app,
    });
    if (!connection) return { unsubscribed: false };

    // Best effort. A revoked key cannot remove its own webhook, and that must
    // not trap the operator in a connection they are trying to leave — the
    // inbound key dies with the row, so anything still sent is refused.
    const removed = connection.remoteWebhookId
      ? await callApp(
          connection,
          "DELETE",
          `/api/v1/webhooks/${encodeURIComponent(connection.remoteWebhookId)}`
        )
      : null;

    await ctx.runMutation(internal.apps.removeConnection, {
      workspaceId: args.workspaceId,
      app: args.app,
    });
    return { unsubscribed: Boolean(removed?.ok) };
  },
});

// ---------------------------------------------------------------------------
// Internals — storage
// ---------------------------------------------------------------------------

/** One connection, secrets included. */
export const connectionFor = internalQuery({
  args: { workspaceId: v.id("workspaces"), app: appId },
  handler: async (ctx, args): Promise<Doc<"appConnections"> | null> => {
    return await ctx.db
      .query("appConnections")
      .withIndex("by_workspace_app", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("app", args.app)
      )
      .unique();
  },
});

export const connectionById = internalQuery({
  args: { connectionId: v.id("appConnections") },
  handler: async (ctx, args) => ctx.db.get("appConnections", args.connectionId),
});

/**
 * Creates or replaces the workspace's connection to one app, and returns what
 * the replaced one needs to unsubscribe itself.
 */
export const saveConnection = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    app: appId,
    apiKey: v.string(),
    baseUrl: v.string(),
    account: v.object({ id: v.string(), name: v.string(), slug: v.string() }),
    inboundKey: v.string(),
    webhookSecret: v.string(),
    remoteWebhookId: v.optional(v.string()),
    items: v.array(appItem),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    baseUrl: string;
    apiKey: string;
    remoteWebhookId?: string;
  } | null> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("appConnections")
      .withIndex("by_workspace_app", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("app", args.app)
      )
      .unique();

    const fields = {
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      account: args.account,
      inboundKey: args.inboundKey,
      webhookSecret: args.webhookSecret,
      remoteWebhookId: args.remoteWebhookId,
      items: args.items,
      status: "connected" as const,
      lastError: undefined,
      syncedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return {
        baseUrl: existing.baseUrl,
        apiKey: existing.apiKey,
        remoteWebhookId: existing.remoteWebhookId,
      };
    }

    await ctx.db.insert("appConnections", {
      workspaceId: args.workspaceId,
      app: args.app,
      ...fields,
      // On by default: a customer who has just filled in the form is still
      // looking at the chat, and silence reads as the form having gone nowhere.
      replyOnResult: true,
      sentCount: 0,
      resultCount: 0,
      createdAt: now,
    });
    return null;
  },
});

export const saveItems = internalMutation({
  args: {
    connectionId: v.id("appConnections"),
    items: v.optional(v.array(appItem)),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get("appConnections", args.connectionId);
    if (!connection) return;
    const now = Date.now();
    await ctx.db.patch(connection._id, {
      ...(args.items ? { items: args.items } : {}),
      status: args.error ? ("error" as const) : ("connected" as const),
      lastError: args.error,
      // Moved on failure too, so a broken app is retried on the next stale
      // turn rather than on every turn in between.
      syncedAt: now,
      updatedAt: now,
    });
  },
});

export const removeConnection = internalMutation({
  args: { workspaceId: v.id("workspaces"), app: appId },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("appConnections")
      .withIndex("by_workspace_app", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("app", args.app)
      )
      .unique();
    if (connection) await ctx.db.delete(connection._id);

    // Off every agent as well, for the same reason Google's disconnect does
    // it: a reconnect months later must not quietly re-arm whoever happened
    // to have it on.
    const toolName = findApp(args.app)?.toolName;
    if (!toolName) return;
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const agent of agents) {
      const enabled = agent.integrationTools ?? [];
      if (!enabled.includes(toolName)) continue;
      await ctx.db.patch(agent._id, {
        integrationTools: enabled.filter((name) => name !== toolName),
        updatedAt: Date.now(),
      });
    }
  },
});

/** Re-read an app's forms or offers — after a form changed, or when stale. */
export const refreshItems = internalAction({
  args: { connectionId: v.id("appConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.apps.connectionById, {
      connectionId: args.connectionId,
    });
    if (!connection) return;
    const catalogue = await fetchItems(connection.app, connection);
    await ctx.runMutation(internal.apps.saveItems, {
      connectionId: connection._id,
      ...(catalogue.ok ? { items: catalogue.items } : { error: catalogue.error }),
    });
  },
});

// ---------------------------------------------------------------------------
// Internals — the engine's side
// ---------------------------------------------------------------------------

/** The connections whose tool is switched on for this agent. Secrets included. */
export const forAgent = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args): Promise<Doc<"appConnections">[]> => {
    const agent = await ctx.db.get("agents", args.agentId);
    const enabled = (agent?.integrationTools ?? []).filter((name) =>
      APP_TOOL_NAMES.includes(name)
    );
    if (!agent || enabled.length === 0) return [];

    const rows = await ctx.db
      .query("appConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", agent.workspaceId))
      .take(10);
    return rows.filter((row) => {
      const toolName = findApp(row.app)?.toolName;
      return toolName !== undefined && enabled.includes(toolName);
    });
  },
});

/** Files the ref of a link an agent is about to send. */
export const recordLink = internalMutation({
  args: {
    connectionId: v.id("appConnections"),
    ref: v.string(),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    agentId: v.optional(v.id("agents")),
    itemKey: v.string(),
    itemTitle: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get("appConnections", args.connectionId);
    if (!connection) throw new Error("This app is no longer connected.");
    await ctx.db.insert("appLinks", {
      workspaceId: connection.workspaceId,
      connectionId: connection._id,
      app: connection.app,
      ref: args.ref,
      conversationId: args.conversationId,
      contactId: args.contactId,
      agentId: args.agentId,
      itemKey: args.itemKey,
      itemTitle: args.itemTitle,
      url: args.url,
      resultCount: 0,
      createdAt: Date.now(),
    });
    await ctx.db.patch(connection._id, { sentCount: connection.sentCount + 1 });
  },
});

// ---------------------------------------------------------------------------
// Internals — results coming back
// ---------------------------------------------------------------------------

/** What the webhook route needs to check a delivery. */
export const byInboundKey = internalQuery({
  args: { inboundKey: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("appConnections")
      .withIndex("by_inboundKey", (q) => q.eq("inboundKey", args.inboundKey))
      .unique();
    if (!connection) return null;
    return {
      connectionId: connection._id,
      app: connection.app,
      webhookSecret: connection.webhookSecret,
    };
  },
});

/**
 * Takes one result in: refuses a delivery already seen, matches the ref to the
 * conversation it was sent in, and schedules the rest.
 *
 * A result with no ref, or one this workspace never minted, is counted as
 * received and dropped. Only a link an agent sent may speak in a conversation.
 * A form submission is kept either way, for the integrations page and for a
 * record book the form is saved to.
 */
export const acceptResult = internalMutation({
  args: {
    connectionId: v.id("appConnections"),
    deliveryId: v.string(),
    ref: v.optional(v.string()),
    text: v.string(),
    data: v.any(),
    submission: v.optional(submissionShape),
  },
  handler: async (
    ctx,
    args
  ): Promise<"duplicate" | "unmatched" | "accepted"> => {
    const now = Date.now();

    const seen = await ctx.db
      .query("appDeliveries")
      .withIndex("by_connection_delivery", (q) =>
        q.eq("connectionId", args.connectionId).eq("deliveryId", args.deliveryId)
      )
      .unique();
    if (seen) return "duplicate";
    await ctx.db.insert("appDeliveries", {
      connectionId: args.connectionId,
      deliveryId: args.deliveryId,
      createdAt: now,
    });

    const connection = await ctx.db.get("appConnections", args.connectionId);
    if (!connection) return "unmatched";

    const found = args.ref
      ? await ctx.db
          .query("appLinks")
          .withIndex("by_ref", (q) => q.eq("ref", args.ref!))
          .unique()
      : null;
    const link = found?.connectionId === connection._id ? found : null;
    const conversation = link
      ? await ctx.db.get("conversations", link.conversationId)
      : null;

    if (args.submission) {
      await storeSubmission(ctx, {
        workspaceId: connection.workspaceId,
        accountId: connection.account.id,
        submission: args.submission,
        link:
          link && conversation
            ? {
                conversationId: conversation._id,
                contactId: link.contactId,
                agentId: link.agentId,
              }
            : null,
        fromWebhook: true,
      });
    }

    if (!link || !conversation) return "unmatched";
    const contact = await ctx.db.get("contacts", link.contactId);

    await ctx.db.patch(link._id, {
      resultCount: link.resultCount + 1,
      lastResultAt: now,
    });
    await ctx.db.patch(connection._id, {
      resultCount: connection.resultCount + 1,
      lastResultAt: now,
    });

    const spec = findApp(connection.app);
    await ctx.scheduler.runAfter(0, internal.apps.deliverResult, {
      workspaceId: connection.workspaceId,
      conversationId: conversation._id,
      text: args.text,
      event: spec?.resultEvent ?? "app_result",
      reply: connection.replyOnResult,
      data: {
        ...(args.data as Record<string, unknown>),
        conversationId: conversation._id,
        contactId: link.contactId,
        contact: contact
          ? { name: contact.name ?? null, phone: contact.phone ?? null }
          : null,
        agentId: link.agentId ?? null,
      },
    });
    return "accepted";
  },
});

/**
 * Puts the result in the thread and tells the team.
 *
 * The thread first, so a tap on the push lands on a conversation that already
 * shows what came in.
 */
export const deliverResult = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    text: v.string(),
    event: v.string(),
    reply: v.boolean(),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    if (args.reply) {
      await ctx.runAction(internal.whatsapp.respondToEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
    } else {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
    }

    await ctx.runAction(internal.webhooks.deliver, {
      workspaceId: args.workspaceId,
      event: args.event,
      data: args.data,
    });
  },
});

export const pruneDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DELIVERY_MEMORY_MS;
    const old = await ctx.db
      .query("appDeliveries")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === 500) {
      await ctx.scheduler.runAfter(0, internal.apps.pruneDeliveries, {});
    }
  },
});
