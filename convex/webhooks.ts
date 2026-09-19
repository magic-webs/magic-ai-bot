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
import { postWebhook } from "./lib/webhookDelivery";

const MAX_PAYLOAD_LOG = 8000;

/** What the log calls the endpoint on the settings page. */
export const WORKSPACE_DESTINATION = "Workspace webhook";

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
    recordBookId: v.optional(v.id("recordBooks")),
    destination: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("webhookEvents", {
      workspaceId: args.workspaceId,
      event: args.event,
      payload: args.payload.slice(0, MAX_PAYLOAD_LOG),
      status: args.status,
      responseStatus: args.responseStatus,
      error: args.error?.slice(0, 500),
      recordBookId: args.recordBookId,
      destination: args.destination,
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
    // Only set by record events, so the book's own delivery log can be read
    // without grepping the payload for a handle.
    recordBookId: v.optional(v.id("recordBooks")),
    /**
     * False for an event the team caused themselves from the dashboard.
     *
     * Every other event here is something that happened while nobody was
     * looking, which is what a push is for. Buzzing someone's phone about the
     * edit they just made in another tab is how an operator learns to turn
     * notifications off. Absent means push, so nothing that predates this
     * argument goes quiet.
     */
    push: v.optional(v.boolean()),
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
    if (args.push !== false) {
      await ctx.runAction(internal.push.notify, {
        workspaceId: args.workspaceId,
        event: args.event,
        data: args.data,
      });
    }

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
        recordBookId: args.recordBookId,
        destination: WORKSPACE_DESTINATION,
      });
      return { success: false, reason: "no_url" };
    }

    const result = await postWebhook({
      url: workspace.webhookUrl,
      body,
      event: args.event,
      workspaceSlug: workspace.slug,
      secret: workspace.webhookSecret,
    });

    await ctx.runMutation(internal.webhooks.logEvent, {
      workspaceId: args.workspaceId,
      event: args.event,
      payload: body,
      status: result.ok ? "sent" : "failed",
      responseStatus: result.responseStatus,
      error: result.error,
      recordBookId: args.recordBookId,
      destination: WORKSPACE_DESTINATION,
    });

    return {
      success: result.ok,
      responseStatus: result.responseStatus,
      error: result.error,
    };
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
