import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";

/**
 * Push notifications, through Expo's push service.
 *
 * Sent from `webhooks.deliver`, which every platform event already funnels
 * through — so an event that fires a webhook also reaches the phone, and a new
 * event type gets both without being wired up twice.
 *
 * Deliberately not FCM directly. The app ships one Expo token per install and
 * Expo fans out to FCM and APNs, which keeps one credential here instead of a
 * service account plus an APNs key.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo rejects more than 100 messages in one request. */
const BATCH = 100;

const platformValidator = v.union(
  v.literal("ios"),
  v.literal("android"),
  v.literal("web")
);

/**
 * How each event reads on the lock screen.
 *
 * `channelId` has to match a channel the app created. On Android the sound
 * belongs to the channel rather than to the message, and a channel's sound
 * cannot be changed once it exists — which is why the ids carry a version.
 * Bump the suffix to change a sound, and the app creates the new channel on
 * its next launch.
 */
const CHANNELS = {
  orders: "orders-v1",
  escalations: "escalations-v1",
  default: "default",
} as const;

type Presentation = {
  title: string;
  body: string;
  channelId: string;
  /** iOS takes the sound per message; Android takes it from the channel. */
  sound: string;
  priority: "default" | "high";
};

function present(event: string, data: unknown): Presentation {
  const row = (data ?? {}) as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const value = row[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  if (event === "order_created") {
    const customer = (row.customer as { name?: string } | undefined)?.name;
    const total =
      typeof row.total === "number"
        ? [row.currency, row.total].filter(Boolean).join(" ")
        : undefined;
    const body = [text("orderNumber"), customer, total]
      .filter(Boolean)
      .join(" · ");
    return {
      title: "New order",
      body: body || "An agent recorded an order.",
      channelId: CHANNELS.orders,
      sound: "order.wav",
      priority: "high",
    };
  }

  if (event === "escalation") {
    const contact = (row.contact as { name?: string } | undefined)?.name;
    const body = [contact, text("department"), text("reason")]
      .filter(Boolean)
      .join(" · ");
    return {
      title: "Escalated to a human",
      body: body || "A conversation needs a person.",
      channelId: CHANNELS.escalations,
      sound: "escalation.wav",
      priority: "high",
    };
  }

  // Anything else still arrives rather than being silently dropped, so a new
  // event type is visible before it has been given its own copy.
  return {
    title: event === "test" ? "Test notification" : "Magic Agent",
    body: text("message") ?? `Event: ${event}`,
    channelId: CHANNELS.default,
    sound: "default",
    priority: "default",
  };
}

// --------------------------------------------------------------- registration

export const register = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    platform: platformValidator,
    deviceName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const token = args.token.trim();
    if (!token) throw new Error("Empty push token");

    const now = Date.now();
    /* Keyed on the token, not on the workspace: the same install signing into
       a different workspace has to move, not accumulate a second row that
       would deliver every notification twice. */
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: args.workspaceId,
        platform: args.platform,
        deviceName: args.deviceName,
        // Re-registering is how a device Expo reported as gone comes back.
        disabledAt: undefined,
        lastError: undefined,
        updatedAt: now,
      });
      return { success: true as const };
    }

    await ctx.db.insert("pushTokens", {
      workspaceId: args.workspaceId,
      token,
      platform: args.platform,
      deviceName: args.deviceName,
      createdAt: now,
      updatedAt: now,
    });
    return { success: true as const };
  },
});

export const unregister = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token.trim()))
      .unique();
    if (!row) return { success: true as const };
    // The caller has to own the workspace the token belongs to, or signing out
    // of one workspace could silence another's devices.
    await requireWorkspace(ctx, row.workspaceId);
    await ctx.db.delete(row._id);
    return { success: true as const };
  },
});

/** The registered devices, for a settings screen. */
export const listDevices = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("pushTokens")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return rows.map((row) => ({
      _id: row._id,
      platform: row.platform,
      deviceName: row.deviceName ?? null,
      active: row.disabledAt === undefined,
      createdAt: row.createdAt,
    }));
  },
});

// ------------------------------------------------------------------ internals

export const tokensForWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<Doc<"pushTokens">[]> => {
    const rows = await ctx.db
      .query("pushTokens")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return rows.filter((row) => row.disabledAt === undefined);
  },
});

export const markDead = internalMutation({
  args: { tokens: v.array(v.string()), error: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const token of args.tokens) {
      const row = await ctx.db
        .query("pushTokens")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      if (!row) continue;
      await ctx.db.patch(row._id, {
        disabledAt: now,
        lastError: args.error.slice(0, 300),
        updatedAt: now,
      });
    }
  },
});

/**
 * Send one event to every device registered to a workspace.
 *
 * Never throws. This runs inside the tool call that recorded the order, and a
 * push service having a bad minute must not fail the order or the reply the
 * customer is waiting on.
 */
export const notify = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.string(),
    data: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: number; failed: number; reason?: string }> => {
    const devices = await ctx.runQuery(internal.push.tokensForWorkspace, {
      workspaceId: args.workspaceId,
    });
    if (devices.length === 0) {
      return { sent: 0, failed: 0, reason: "no_devices" };
    }

    const shape = present(args.event, args.data);
    const row = (args.data ?? {}) as Record<string, unknown>;

    let sent = 0;
    let failed = 0;
    const dead: string[] = [];

    for (let at = 0; at < devices.length; at += BATCH) {
      const slice = devices.slice(at, at + BATCH);
      const messages = slice.map((device) => ({
        to: device.token,
        title: shape.title,
        body: shape.body,
        sound: shape.sound,
        channelId: shape.channelId,
        priority: shape.priority,
        // What the app routes on when the notification is tapped.
        data: {
          event: args.event,
          conversationId: row.conversationId ?? null,
          orderId: row.orderId ?? null,
        },
      }));

      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            // Optional, and only needed once push security is enabled on the
            // Expo account. Absent is the normal case.
            ...(process.env.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify(messages),
        });

        if (!response.ok) {
          failed += slice.length;
          continue;
        }

        const payload = (await response.json()) as {
          data?: {
            status: string;
            message?: string;
            details?: { error?: string };
          }[];
        };

        payload.data?.forEach((ticket, index) => {
          if (ticket.status === "ok") {
            sent += 1;
            return;
          }
          failed += 1;
          // The install is gone — uninstalled, or the token rotated. Expo will
          // keep rejecting it, so stop sending to it.
          if (ticket.details?.error === "DeviceNotRegistered") {
            const device = slice[index];
            if (device) dead.push(device.token);
          }
        });
      } catch {
        failed += slice.length;
      }
    }

    if (dead.length > 0) {
      await ctx.runMutation(internal.push.markDead, {
        tokens: dead,
        error: "DeviceNotRegistered",
      });
    }

    return { sent, failed };
  },
});
