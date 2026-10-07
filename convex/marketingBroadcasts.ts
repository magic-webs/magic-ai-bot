import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { homeMarket, quote } from "./lib/billing";
import { walletFor } from "./lib/wallet";
import { isEveryone, measureAudience, type AudienceSelection } from "./lib/audience";
import { isLocalDate, templateBlocker, zonedToInstant } from "./lib/marketing";
import { eventKey, statsFor } from "./lib/marketingStats";
import { failureCode } from "./lib/metaErrors";
import { audienceSelection } from "./schema/marketing";
import { clampHour, startEvent, templateInWorkspace } from "./marketing";

const REPORT_SCAN = 3000;
const RETARGET_BATCH = 200;
const MIN_RATE = 10;
const MAX_RATE = 1000;

async function requireBroadcast(ctx: QueryCtx, eventId: Id<"marketingEvents">) {
  const event = await ctx.db.get("marketingEvents", eventId);
  if (!event) throw new ConvexError("Campaign not found");
  await requireWorkspace(ctx, event.workspaceId);
  if (event.campaignId) throw new ConvexError("This is an event reminder. Open it from Events.");
  return event;
}

async function checkAudience(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  selection: AudienceSelection
) {
  for (const id of [...selection.audienceIds, ...selection.excludeAudienceIds]) {
    const audience = await ctx.db.get("audiences", id);
    if (!audience || audience.workspaceId !== workspaceId) throw new ConvexError("A list was not found.");
  }
}

export const list = query({
  args: { workspaceId: v.id("workspaces"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const page = await ctx.db
      .query("marketingEvents")
      .withIndex("by_workspace_and_date", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .paginate(args.paginationOpts);
    const rows = [];
    for (const event of page.page) {
      if (event.campaignId) continue;
      const template = event.templateId ? await ctx.db.get("marketingTemplates", event.templateId) : null;
      rows.push({
        ...event,
        templateName: template?.name ?? null,
        stats: await statsFor(ctx, eventKey(event._id)),
      });
    }
    return { ...page, page: rows };
  },
});

export const get = query({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await requireBroadcast(ctx, args.eventId);
    const template = event.templateId ? await ctx.db.get("marketingTemplates", event.templateId) : null;
    const audiences = [];
    for (const id of [...(event.audience?.audienceIds ?? []), ...(event.audience?.excludeAudienceIds ?? [])]) {
      const audience = await ctx.db.get("audiences", id);
      if (audience) audiences.push({ _id: audience._id, name: audience.name });
    }
    return { ...event, template, audiences, stats: await statsFor(ctx, eventKey(event._id)) };
  },
});

export const estimate = query({
  args: {
    workspaceId: v.id("workspaces"),
    templateId: v.optional(v.id("marketingTemplates")),
    audience: audienceSelection,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const size = await measureAudience(ctx, args.workspaceId, args.audience, args.now);
    const template = args.templateId
      ? await templateInWorkspace(ctx, args.workspaceId, args.templateId)
      : null;
    let currency: string | null = null;
    let costMicros = 0;
    if (template) {
      for (const [market, count] of Object.entries(size.byMarket)) {
        const priced = await quote(ctx, {
          workspaceId: args.workspaceId,
          market,
          category: template.category ?? "marketing",
        });
        currency ??= priced.currency;
        costMicros += priced.amountMicros * count;
      }
    }
    const wallet = await walletFor(ctx, args.workspaceId);
    return {
      ...size,
      currency,
      costMicros,
      balanceMicros: wallet?.balanceMicros ?? null,
    };
  },
});

export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventId: v.optional(v.id("marketingEvents")),
    title: v.string(),
    templateId: v.id("marketingTemplates"),
    message: v.optional(v.string()),
    audience: audienceSelection,
    date: v.string(),
    sendHour: v.number(),
    ratePerMinute: v.optional(v.number()),
    trackLinks: v.optional(v.boolean()),
    sendNow: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new ConvexError("Workspace not found");
    const title = args.title.trim().slice(0, 80);
    if (!title) throw new ConvexError("Give the campaign a name.");
    const template = await templateInWorkspace(ctx, args.workspaceId, args.templateId);
    await checkAudience(ctx, args.workspaceId, args.audience);

    const now = Date.now();
    const sendHour = clampHour(args.sendHour);
    let date = args.date;
    let sendAt: number;
    if (args.sendNow) {
      const blocked = templateBlocker(template);
      if (blocked) throw new ConvexError(blocked);
      sendAt = now;
      date = isLocalDate(date) ? date : new Date(now).toISOString().slice(0, 10);
    } else {
      if (!isLocalDate(date)) throw new ConvexError("Pick a day.");
      sendAt = zonedToInstant(date, sendHour, workspace.timezone);
      if (sendAt <= now) throw new ConvexError("That time has already passed. Pick a later one, or send now.");
    }

    const fields = {
      title,
      date,
      sendHour,
      sendAt,
      templateId: template._id,
      note: args.message?.trim().slice(0, 400) || undefined,
      audience: isEveryone(args.audience) && args.audience.excludeAudienceIds.length === 0
        ? undefined
        : args.audience,
      ratePerMinute: args.ratePerMinute
        ? Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(args.ratePerMinute)))
        : undefined,
      trackLinks: args.trackLinks ?? true,
      status: "scheduled" as const,
      lastError: undefined,
      updatedAt: now,
    };

    let eventId: Id<"marketingEvents">;
    if (args.eventId) {
      const event = await requireBroadcast(ctx, args.eventId);
      if (event.workspaceId !== args.workspaceId) throw new ConvexError("Campaign not found");
      if (event.startedAt) throw new ConvexError("This campaign has started, so it can no longer be changed.");
      await ctx.db.patch("marketingEvents", event._id, fields);
      eventId = event._id;
    } else {
      eventId = await ctx.db.insert("marketingEvents", {
        workspaceId: args.workspaceId,
        sentCount: 0,
        failedCount: 0,
        createdAt: now,
        ...fields,
      });
    }

    if (args.sendNow) {
      const event = (await ctx.db.get("marketingEvents", eventId))!;
      await startEvent(ctx, event, 0);
    }
    return eventId;
  },
});

export const pause = mutation({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await requireBroadcast(ctx, args.eventId);
    if (event.status !== "sending" && event.status !== "scheduled") {
      throw new ConvexError("Only a campaign that is scheduled or sending can be paused.");
    }
    await ctx.db.patch("marketingEvents", event._id, { status: "paused", updatedAt: Date.now() });
    return { success: true };
  },
});

export const resume = mutation({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await requireBroadcast(ctx, args.eventId);
    if (event.status !== "paused") throw new ConvexError("This campaign is not paused.");
    const now = Date.now();
    if (!event.startedAt) {
      await ctx.db.patch("marketingEvents", event._id, {
        status: "scheduled",
        sendAt: Math.max(event.sendAt, now),
        updatedAt: now,
      });
      return { success: true };
    }
    await ctx.db.patch("marketingEvents", event._id, { status: "sending", updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.marketingSend.runEvent, {
      eventId: event._id,
      cursor: event.cursor ?? null,
    });
    return { success: true };
  },
});

export const cancel = mutation({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await requireBroadcast(ctx, args.eventId);
    if (event.status === "sent" || event.status === "failed" || event.status === "cancelled") {
      throw new ConvexError("This campaign has already finished.");
    }
    if (!event.startedAt) {
      await ctx.db.delete("marketingEvents", event._id);
      return { deleted: true };
    }
    const now = Date.now();
    await ctx.db.patch("marketingEvents", event._id, {
      status: "cancelled",
      finishedAt: now,
      updatedAt: now,
    });
    return { deleted: false };
  },
});

export const report = query({
  args: { eventId: v.id("marketingEvents"), now: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event) throw new ConvexError("Campaign not found");
    await requireWorkspace(ctx, event.workspaceId);
    const key = eventKey(event._id);
    const sends = await ctx.db
      .query("marketingSends")
      .withIndex("by_key_and_createdAt", (q) => q.eq("key", key))
      .take(REPORT_SCAN);

    const reasons = new Map<string, number>();
    const readHours = new Array(25).fill(0) as number[];
    let first: number | null = null;
    let last: number | null = null;
    for (const send of sends) {
      first = first === null ? send.createdAt : Math.min(first, send.createdAt);
      last = last === null ? send.createdAt : Math.max(last, send.createdAt);
      if (send.status === "failed" || send.delivery === "failed") {
        const code = failureCode(send.error);
        reasons.set(code, (reasons.get(code) ?? 0) + 1);
      }
      if (send.readAt) {
        const hours = Math.floor((send.readAt - send.createdAt) / 3_600_000);
        readHours[Math.min(24, Math.max(0, hours))]++;
      }
    }

    const template = event.templateId ? await ctx.db.get("marketingTemplates", event.templateId) : null;
    const stats = await statsFor(ctx, key);
    const priced = await quote(ctx, {
      workspaceId: event.workspaceId,
      market: await homeMarket(ctx, event.workspaceId),
      category: template?.category ?? "marketing",
    });

    return {
      stats,
      skipped: event.skippedCount ?? 0,
      reasons: [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({ code, count })),
      readHours,
      firstSentAt: first,
      lastSentAt: last,
      partial: sends.length >= REPORT_SCAN,
      currency: priced.currency,
      costMicros: priced.amountMicros * stats.sent,
    };
  },
});

const outcome = v.union(
  v.literal("all"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("replied"),
  v.literal("clicked"),
  v.literal("failed"),
  v.literal("not_read"),
  v.literal("optedOut")
);

type Outcome =
  | "all"
  | "delivered"
  | "read"
  | "replied"
  | "clicked"
  | "failed"
  | "not_read"
  | "optedOut";

function matchesOutcome(send: Doc<"marketingSends">, filter: Outcome): boolean {
  const failed = send.status === "failed" || send.delivery === "failed";
  switch (filter) {
    case "all":
      return true;
    case "delivered":
      return !failed && Boolean(send.deliveredAt);
    case "read":
      return Boolean(send.readAt);
    case "replied":
      return Boolean(send.repliedAt);
    case "clicked":
      return Boolean(send.clickedAt);
    case "failed":
      return failed;
    case "not_read":
      return !failed && !send.readAt;
    case "optedOut":
      return Boolean(send.optedOutAt);
  }
}

export const recipients = query({
  args: {
    eventId: v.id("marketingEvents"),
    outcome,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event) throw new ConvexError("Campaign not found");
    await requireWorkspace(ctx, event.workspaceId);
    const page = await ctx.db
      .query("marketingSends")
      .withIndex("by_key_and_createdAt", (q) => q.eq("key", eventKey(event._id)))
      .order("desc")
      .paginate(args.paginationOpts);
    const rows = [];
    for (const send of page.page) {
      if (!matchesOutcome(send, args.outcome)) continue;
      const contact = await ctx.db.get("contacts", send.contactId);
      rows.push({
        _id: send._id,
        contactId: send.contactId,
        name: contact?.name ?? null,
        phone: contact?.externalId ?? "",
        status: send.status,
        delivery: send.delivery ?? null,
        error: send.error ?? null,
        sentAt: send.createdAt,
        deliveredAt: send.deliveredAt ?? null,
        readAt: send.readAt ?? null,
        repliedAt: send.repliedAt ?? null,
        clickedAt: send.clickedAt ?? null,
        optedOutAt: send.optedOutAt ?? null,
      });
    }
    return { ...page, page: rows };
  },
});

export const retarget = mutation({
  args: { eventId: v.id("marketingEvents"), outcome, name: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event) throw new ConvexError("Campaign not found");
    await requireWorkspace(ctx, event.workspaceId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("Give the list a name.");
    const now = Date.now();
    const audienceId = await ctx.db.insert("audiences", {
      workspaceId: event.workspaceId,
      name,
      description: `From “${event.title}”`,
      source: "retarget",
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.marketingBroadcasts.retargetBatch, {
      eventId: event._id,
      audienceId,
      outcome: args.outcome,
      cursor: null,
    });
    return audienceId;
  },
});

export const retargetBatch = internalMutation({
  args: {
    eventId: v.id("marketingEvents"),
    audienceId: v.id("audiences"),
    outcome,
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const audience = await ctx.db.get("audiences", args.audienceId);
    if (!audience) return;
    const page = await ctx.db
      .query("marketingSends")
      .withIndex("by_key_and_createdAt", (q) => q.eq("key", eventKey(args.eventId)))
      .paginate({ numItems: RETARGET_BATCH, cursor: args.cursor });
    const now = Date.now();
    let added = 0;
    for (const send of page.page) {
      if (!matchesOutcome(send, args.outcome)) continue;
      const existing = await ctx.db
        .query("audienceMembers")
        .withIndex("by_audienceId_and_contactId", (q) =>
          q.eq("audienceId", audience._id).eq("contactId", send.contactId)
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("audienceMembers", {
        workspaceId: audience.workspaceId,
        audienceId: audience._id,
        contactId: send.contactId,
        addedAt: now,
      });
      added++;
    }
    if (added > 0) {
      await ctx.db.patch("audiences", audience._id, {
        memberCount: audience.memberCount + added,
        updatedAt: now,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.marketingBroadcasts.retargetBatch, {
        ...args,
        cursor: page.continueCursor,
      });
    }
  },
});
