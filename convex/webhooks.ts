import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  requireWorkspace,
} from "./lib/auth";

const MAX_PAYLOAD_LOG = 8000;

// HMAC-SHA256 via Web Crypto so this stays in Convex's default runtime.
async function signPayload(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const logEvent = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.string(),
    payload: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("webhookEvents", {
      workspaceId: args.workspaceId,
      event: args.event,
      payload: args.payload.slice(0, MAX_PAYLOAD_LOG),
      status: args.status,
      responseStatus: args.responseStatus,
      error: args.error?.slice(0, 500),
      createdAt: Date.now(),
    });
  },
});

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// Fire-and-log an outbound event to the workspace's configured endpoint.
export const deliver = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.string(),
    data: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    responseStatus?: number;
    error?: string;
    reason?: string;
  }> => {
    const workspace = await ctx.runQuery(internal.workspaces.getInternal, {
      workspaceId: args.workspaceId,
    });
    if (!workspace) return { success: false, reason: "workspace_missing" };

    /* Push first, and above the webhook-URL check on purpose: this is the one
       place every platform event passes through, and a workspace with no
       webhook configured still has an operator holding a phone. `notify`
       swallows its own failures, so a push outage cannot fail the tool call
       that got here. */
    await ctx.runAction(internal.push.notify, {
      workspaceId: args.workspaceId,
      event: args.event,
      data: args.data,
    });

    const body = JSON.stringify({
      event: args.event,
      workspace: {
        id: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
      },
      timestamp: new Date().toISOString(),
      data: args.data,
    });

    if (!workspace.webhookUrl?.trim()) {
      await ctx.runMutation(internal.webhooks.logEvent, {
        workspaceId: args.workspaceId,
        event: args.event,
        payload: body,
        status: "skipped",
        error: "No webhook URL configured for this workspace.",
      });
      return { success: false, reason: "no_url" };
    }

    const signature = workspace.webhookSecret
      ? await signPayload(workspace.webhookSecret, body)
      : undefined;

    let responseStatus: number | undefined;
    let error: string | undefined;
    let ok = false;

    try {
      const response = await fetch(workspace.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Magic-Event": args.event,
          "X-Magic-Workspace": workspace.slug,
          ...(signature ? { "X-Magic-Signature": `sha256=${signature}` } : {}),
        },
        body,
      });
      responseStatus = response.status;
      ok = response.ok;
      if (!ok) {
        const text = await response.text().catch(() => "");
        error = `HTTP ${response.status}: ${text.slice(0, 300)}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await ctx.runMutation(internal.webhooks.logEvent, {
      workspaceId: args.workspaceId,
      event: args.event,
      payload: body,
      status: ok ? "sent" : "failed",
      responseStatus,
      error,
    });

    return { success: ok, responseStatus, error };
  },
});

// "Send test event" button in the dashboard.
export const sendTest = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    responseStatus?: number;
    error?: string;
    reason?: string;
  }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    return await ctx.runAction(internal.webhooks.deliver, {
      workspaceId: args.workspaceId,
      event: "test",
      data: {
        message: "This is a test event from your Magic Agent workspace.",
      },
    });
  },
});
