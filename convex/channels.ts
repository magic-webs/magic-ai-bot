import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { randomKey, maskSecret } from "./lib/shared";
import {
  requireChannel,
  requireWorkspace,
} from "./lib/auth";

const whatsappInput = v.object({
  apiBaseUrl: v.optional(v.string()),
  apiVersion: v.optional(v.string()),
  phoneNumberId: v.string(),
  wabaId: v.optional(v.string()),
  businessId: v.optional(v.string()),
  displayPhoneNumber: v.optional(v.string()),
  // Omit on update to keep the stored token
  accessToken: v.optional(v.string()),
});

// Never return a live access token to the browser.
function redact(channel: Doc<"channels">) {
  return {
    ...channel,
    whatsapp: channel.whatsapp
      ? {
          ...channel.whatsapp,
          accessToken: maskSecret(channel.whatsapp.accessToken) ?? "",
        }
      : undefined,
    hasAccessToken: Boolean(channel.whatsapp?.accessToken),
  };
}

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const agentNames = new Map(agents.map((a) => [a._id, a.name]));

    return channels.map((channel) => ({
      ...redact(channel),
      agentName: agentNames.get(channel.agentId) ?? "— deleted agent —",
    }));
  },
});

export const get = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const channel = await ctx.db.get("channels", args.channelId);
    return channel ? redact(channel) : null;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    type: v.union(v.literal("whatsapp"), v.literal("web")),
    name: v.string(),
    whatsapp: v.optional(whatsappInput),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.type === "whatsapp") {
      if (!args.whatsapp?.phoneNumberId?.trim()) {
        throw new Error("A WhatsApp phone number ID is required");
      }
      if (!args.whatsapp.accessToken?.trim()) {
        throw new Error("A WhatsApp access token is required");
      }
    }

    const now = Date.now();
    const channelId = await ctx.db.insert("channels", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      type: args.type,
      name: args.name.trim() || "WhatsApp",
      channelKey: randomKey(28),
      externalId: args.whatsapp?.phoneNumberId,
      whatsapp:
        args.type === "whatsapp" && args.whatsapp
          ? {
              apiBaseUrl:
                args.whatsapp.apiBaseUrl?.replace(/\/$/, "") ||
                "https://graph.facebook.com",
              apiVersion: args.whatsapp.apiVersion || "v23.0",
              phoneNumberId: args.whatsapp.phoneNumberId.trim(),
              wabaId: args.whatsapp.wabaId?.trim() || undefined,
              businessId: args.whatsapp.businessId?.trim() || undefined,
              displayPhoneNumber:
                args.whatsapp.displayPhoneNumber?.trim() || undefined,
              accessToken: args.whatsapp.accessToken!.trim(),
            }
          : undefined,
      status: args.type === "whatsapp" ? "paused" : "active",
      createdAt: now,
      updatedAt: now,
    });
    return channelId;
  },
});

export const update = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    whatsapp: v.optional(whatsappInput),
    status: v.optional(
      v.union(v.literal("active"), v.literal("paused"), v.literal("error"))
    ),
  },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const existing = await ctx.db.get("channels", args.channelId);
    if (!existing) throw new Error("Channel not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.agentId !== undefined) patch.agentId = args.agentId;
    if (args.status !== undefined) patch.status = args.status;

    if (args.whatsapp) {
      const incomingToken = args.whatsapp.accessToken?.trim();
      // A blank or masked token means "leave the stored one alone".
      const keepExisting =
        !incomingToken || incomingToken.startsWith("••");
      const accessToken = keepExisting
        ? existing.whatsapp?.accessToken
        : incomingToken;

      if (!accessToken) {
        throw new Error("A WhatsApp access token is required");
      }

      patch.whatsapp = {
        apiBaseUrl:
          args.whatsapp.apiBaseUrl?.replace(/\/$/, "") ||
          existing.whatsapp?.apiBaseUrl ||
          "https://graph.facebook.com",
        apiVersion:
          args.whatsapp.apiVersion ||
          existing.whatsapp?.apiVersion ||
          "v23.0",
        phoneNumberId:
          args.whatsapp.phoneNumberId.trim() ||
          existing.whatsapp?.phoneNumberId ||
          "",
        wabaId: args.whatsapp.wabaId?.trim() || undefined,
        businessId: args.whatsapp.businessId?.trim() || undefined,
        displayPhoneNumber:
          args.whatsapp.displayPhoneNumber?.trim() || undefined,
        accessToken,
      };
      patch.externalId = args.whatsapp.phoneNumberId.trim();
    }

    await ctx.db.patch(args.channelId, patch);
    return { success: true };
  },
});

export const rotateKeys = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const channelKey = randomKey(28);
    await ctx.db.patch(args.channelId, {
      channelKey,
      updatedAt: Date.now(),
    });
    return { channelKey };
  },
});

export const remove = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    await ctx.db.delete(args.channelId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Internal — used by the inbound WhatsApp webhook route
// ---------------------------------------------------------------------------

// Returns the FULL config including the access token. Internal only.
export const resolveByKey = internalQuery({
  args: { channelKey: v.string() },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_channelKey", (q) => q.eq("channelKey", args.channelKey))
      .unique();
    if (!channel) return null;

    const agent = await ctx.db.get("agents", channel.agentId);
    const workspace = await ctx.db.get("workspaces", channel.workspaceId);
    if (!agent || !workspace) return null;

    return { channel, agentId: agent._id, agentStatus: agent.status };
  },
});

export const touchInbound = internalMutation({
  args: {
    channelId: v.id("channels"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.channelId, {
      lastInboundAt: Date.now(),
      lastError: args.error?.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});
