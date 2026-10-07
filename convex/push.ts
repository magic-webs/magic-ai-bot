import { ConvexError, v } from "convex/values";
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

  if (event.startsWith("record_")) {
    const book = (row.book as { name?: string } | undefined)?.name;
    const record = (row.record ?? {}) as Record<string, unknown>;
    const person = (record.person as { name?: string } | undefined)?.name;
    const reference =
      typeof record.reference === "string" ? record.reference : undefined;
    const stage = typeof record.stage === "string" ? record.stage : undefined;

    // A filed record is the one worth a sound: it is new work arriving. An
    // update is the team's own edit coming back to them, so it lands quietly.
    const filed = event === "record_filed";
    return {
      title: filed
        ? `New ${(book ?? "record").toLowerCase()}`
        : `${book ?? "Record"} updated`,
      body:
        [person, reference, stage].filter(Boolean).join(" · ") ||
        (filed ? "An agent filed a record." : "A record changed."),
      channelId: filed ? CHANNELS.orders : CHANNELS.default,
      sound: filed ? "order.wav" : "default",
      priority: filed ? "high" : "default",
    };
  }

  // A Magic app's result on a link an agent sent. A submitted form is new work
  // arriving, like a filed record; an offer played is worth knowing about but
  // rarely needs anyone to move.
  if (event === "form_submitted" || event === "offer_played") {
    const contact = (row.contact as { name?: string | null } | undefined)?.name;
    if (event === "form_submitted") {
      const form = (row.form as { title?: string } | undefined)?.title;
      return {
        title: "Form submitted",
        body: [form, contact].filter(Boolean).join(" · ") || "A customer sent a form back.",
        channelId: CHANNELS.orders,
        sound: "order.wav",
        priority: "high",
      };
    }
    const offer = (row.offer as { title?: string } | undefined)?.title;
    const prize = (row.prize as { label?: string } | null | undefined)?.label;
    return {
      title: row.won === true ? "Offer won" : "Offer played",
      body:
        [offer, contact, prize].filter(Boolean).join(" · ") ||
        "A customer played an offer.",
      channelId: CHANNELS.default,
      sound: "default",
      priority: "default",
    };
  }

  // Billing: the wallet running low, a recharge or a plan payment failing.
  // Quiet unless money has actually failed to move.
  if (
    event === "wallet_low" ||
    event === "wallet_recharge_failed" ||
    event === "subscription_payment_failed"
  ) {
    const failed = event !== "wallet_low";
    return {
      title:
        event === "wallet_low"
          ? "Wallet balance is low"
          : event === "wallet_recharge_failed"
            ? "Auto-recharge failed"
            : "Plan payment failed",
      body: text("message") ?? "Open Billing for the details.",
      channelId: CHANNELS.default,
      sound: "default",
      priority: failed ? "high" : "default",
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
    if (!token) throw new ConvexError("Empty push token");

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

/** The bell's list: the latest pushes, newest first. */
export const inbox = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("pushInbox")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 50, 1), 100));
    return rows.map((row) => ({
      _id: row._id,
      event: row.event,
      title: row.title,
      body: row.body,
      conversationId: row.conversationId ?? null,
      orderId: row.orderId ?? null,
      createdAt: row.createdAt,
    }));
  },
});

// ------------------------------------------------------------------ internals

const INBOX_DAYS = 30;

export const remember = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.string(),
    title: v.string(),
    body: v.string(),
    conversationId: v.optional(v.string()),
    orderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pushInbox", { ...args, createdAt: Date.now() });
  },
});

/* Batched and rescheduled rather than one sweep: a mutation that deletes a
   month of a busy workspace's orders in one go can hit the write limit. */
export const pruneInbox = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - INBOX_DAYS * 24 * 60 * 60 * 1000;
    const stale = await ctx.db
      .query("pushInbox")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(500);
    for (const row of stale) await ctx.db.delete(row._id);
    if (stale.length === 500) {
      await ctx.scheduler.runAfter(0, internal.push.pruneInbox, {});
    }
  },
});

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
    const shape = present(args.event, args.data);
    const row = (args.data ?? {}) as Record<string, unknown>;
    const ref = (value: unknown) =>
      typeof value === "string" && value ? value : undefined;

    // Above the device check, so the bell has it even when nothing is
    // registered to buzz.
    try {
      await ctx.runMutation(internal.push.remember, {
        workspaceId: args.workspaceId,
        event: args.event,
        title: shape.title,
        body: shape.body,
        conversationId: ref(row.conversationId),
        orderId: ref(row.orderId),
      });
    } catch {
      // The inbox is a convenience; the push still goes.
    }

    const devices = await ctx.runQuery(internal.push.tokensForWorkspace, {
      workspaceId: args.workspaceId,
    });
    if (devices.length === 0) {
      return { sent: 0, failed: 0, reason: "no_devices" };
    }

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
