// Events of the business's own, and the reminders each one lays on the
// marketing calendar.
//
//   owner saves "Store launch, 8 Nov, 6pm, MG Road" with three reminders
//     -> save puts one calendar entry per reminder at the event's send hour —
//        three days before, the day before, the morning of — each scheduled
//        once the event has a template
//     -> the marketing desk writes every reminder's own line straight away
//        (marketingAi.writeTouches), and again at send time if that failed
//     -> the ordinary sweep sends each on its day, the line going out as the
//        template's {{message}}
//
// A reminder is an ordinary `marketingEvents` row, so the calendar, the
// sender and the send log need nothing new to handle it.

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { ensureMarketingDesk } from "./agents";
import { clampHour, templateInWorkspace } from "./marketing";
import { audienceSelection, guestSegment } from "./schema/marketing";
import {
  EVENT_TOUCH_OFFSETS,
  addDays,
  defaultSegment,
  asParameter,
  isLocalDate,
  isLocalTime,
  touchLabel,
  zonedToInstant,
} from "./lib/marketing";

/** How many events the Events tab lists. */
const MAX_EVENTS = 200;
/** More than one event could ever have: one per offset, plus history. */
const MAX_TOUCHES = 20;
/** The longest reminder line: well inside Meta's 1,024 for the whole body. */
const MAX_MESSAGE = 400;

const isPending = (row: Doc<"marketingEvents">) =>
  row.status === "draft" || row.status === "scheduled";

async function requireCampaign(
  ctx: QueryCtx,
  campaignId: Id<"marketingCampaigns">
): Promise<Doc<"marketingCampaigns">> {
  const campaign = await ctx.db.get("marketingCampaigns", campaignId);
  if (!campaign) throw new Error("Event not found");
  await requireWorkspace(ctx, campaign.workspaceId);
  return campaign;
}

async function touchesOf(
  ctx: QueryCtx,
  campaignId: Id<"marketingCampaigns">
): Promise<Doc<"marketingEvents">[]> {
  const rows = await ctx.db
    .query("marketingEvents")
    .withIndex("by_campaignId", (q) => q.eq("campaignId", campaignId))
    .take(MAX_TOUCHES);
  return rows.sort((a, b) => (a.offsetDays ?? 0) - (b.offsetDays ?? 0));
}

// ------------------------------------------------------------------ queries

/** Every event, latest date first, with its reminders in the order they go. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const campaigns = await ctx.db
      .query("marketingCampaigns")
      .withIndex("by_workspace_and_date", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .order("desc")
      .take(MAX_EVENTS);

    const out = [];
    for (const campaign of campaigns) {
      const template = campaign.templateId
        ? await ctx.db.get("marketingTemplates", campaign.templateId)
        : null;
      out.push({
        ...campaign,
        templateName: template?.name ?? null,
        touches: await touchesOf(ctx, campaign._id),
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------- mutations

export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.optional(v.id("marketingCampaigns")),
    title: v.string(),
    date: v.string(),
    startTime: v.optional(v.string()),
    venue: v.optional(v.string()),
    details: v.string(),
    offer: v.optional(v.string()),
    link: v.optional(v.string()),
    templateId: v.optional(v.id("marketingTemplates")),
    sendHour: v.number(),
    /** Days before (negative) or after (positive), from EVENT_TOUCHES. */
    touches: v.array(v.number()),
    segments: v.optional(v.array(v.object({ offset: v.number(), segment: guestSegment }))),
    audience: v.optional(audienceSelection),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const title = args.title.trim();
    const details = args.details.trim();
    const startTime = args.startTime?.trim() || undefined;
    if (!title) throw new Error("Give the event a name.");
    if (title.length > 80) throw new Error("Keep the name under 80 characters.");
    if (!isLocalDate(args.date)) throw new Error("Pick the day of the event.");
    if (startTime && !isLocalTime(startTime)) {
      throw new Error("Pick a start time, or leave it empty.");
    }
    if (!details) {
      throw new Error("Say what the event is — the desk writes every reminder from it.");
    }
    if (details.length > 2000) throw new Error("Keep the details under 2,000 characters.");
    if (args.templateId) {
      await templateInWorkspace(ctx, args.workspaceId, args.templateId);
    }

    const offsets = [...new Set(args.touches)]
      .filter((offset) => EVENT_TOUCH_OFFSETS.includes(offset))
      .sort((a, b) => a - b);
    if (offsets.length === 0) throw new Error("Pick at least one message to send.");

    const now = Date.now();
    const sendHour = clampHour(args.sendHour);
    const segmentOf = (offset: number) =>
      args.segments?.find((row) => row.offset === offset)?.segment ?? defaultSegment(offset);
    for (const id of [...(args.audience?.audienceIds ?? []), ...(args.audience?.excludeAudienceIds ?? [])]) {
      const list = await ctx.db.get("audiences", id);
      if (!list || list.workspaceId !== args.workspaceId) throw new Error("A list was not found.");
    }
    const fields = {
      audience: args.audience,
      title,
      date: args.date,
      startTime,
      venue: args.venue?.trim() || undefined,
      details,
      offer: args.offer?.trim() || undefined,
      link: args.link?.trim() || undefined,
      templateId: args.templateId,
      sendHour,
      updatedAt: now,
    };

    // A change to what the event is makes every line written about it stale;
    // a change only to when the reminders go, or which, does not.
    let campaignId: Id<"marketingCampaigns">;
    let briefChanged = true;
    if (args.campaignId) {
      const existing = await requireCampaign(ctx, args.campaignId);
      if (existing.workspaceId !== args.workspaceId) throw new Error("Event not found");
      briefChanged =
        existing.title !== fields.title ||
        existing.date !== fields.date ||
        existing.startTime !== fields.startTime ||
        existing.venue !== fields.venue ||
        existing.details !== fields.details ||
        existing.offer !== fields.offer ||
        existing.link !== fields.link;
      await ctx.db.patch("marketingCampaigns", args.campaignId, fields);
      campaignId = args.campaignId;
    } else {
      campaignId = await ctx.db.insert("marketingCampaigns", {
        workspaceId: args.workspaceId,
        createdAt: now,
        ...fields,
      });
    }

    const existing = await touchesOf(ctx, campaignId);
    // Reminders no longer picked go, unless they have already gone out —
    // those stay on the calendar as the record of what was sent.
    for (const row of existing) {
      if (isPending(row) && !offsets.includes(row.offsetDays ?? Number.NaN)) {
        await ctx.db.delete("marketingEvents", row._id);
      }
    }

    let scheduled = 0;
    let passed = 0;
    let needsWriting = false;
    for (const offset of offsets) {
      const row = existing.find((touch) => touch.offsetDays === offset);
      if (row && !isPending(row)) continue;

      const date = addDays(args.date, offset);
      const sendAt = zonedToInstant(date, sendHour, workspace.timezone);
      if (sendAt <= now) {
        // Its moment is behind us: a reminder that would go out late reads
        // wrong ("see you tomorrow" on the day), so it is not sent at all.
        if (row) await ctx.db.delete("marketingEvents", row._id);
        passed++;
        continue;
      }

      const segment = segmentOf(offset);
      const touch = {
        guestSegment: segment,
        title: `${title} · ${touchLabel(offset)}`,
        date,
        sendHour,
        sendAt,
        templateId: args.templateId,
        status: args.templateId ? ("scheduled" as const) : ("draft" as const),
        updatedAt: now,
      };
      if (row) {
        const rewrite = briefChanged || row.guestSegment !== segment;
        await ctx.db.patch("marketingEvents", row._id, {
          ...touch,
          lastError: undefined,
          ...(rewrite ? { message: undefined } : {}),
        });
        if (rewrite || !row.message) needsWriting = true;
      } else {
        await ctx.db.insert("marketingEvents", {
          workspaceId: args.workspaceId,
          campaignId,
          offsetDays: offset,
          sentCount: 0,
          failedCount: 0,
          createdAt: now,
          ...touch,
        });
        needsWriting = true;
      }
      scheduled++;
    }

    const sentBefore = existing.some((row) => !isPending(row));
    if (scheduled === 0 && !sentBefore) {
      // Thrown, so nothing above is kept: an event with nothing left to send
      // is not worth saving, and the owner should hear why.
      throw new Error(
        "Every message you picked falls in the past. Pick a later day or a later reminder."
      );
    }

    if (needsWriting) {
      await ctx.scheduler.runAfter(0, internal.marketingAi.writeTouches, {
        campaignId,
        overwrite: false,
      });
    }
    return { campaignId, scheduled, passed };
  },
});

/** The owner's own words for one reminder, in place of the desk's. */
export const updateMessage = mutation({
  args: { eventId: v.id("marketingEvents"), message: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event?.campaignId) throw new Error("Reminder not found");
    await requireWorkspace(ctx, event.workspaceId);
    if (!isPending(event)) throw new Error("This one has already gone out.");

    const message = asParameter(args.message);
    if (!message) throw new Error("Write the message, or let the desk write it.");
    if (message.length > MAX_MESSAGE) {
      throw new Error(`Keep it under ${MAX_MESSAGE} characters.`);
    }
    await ctx.db.patch("marketingEvents", event._id, {
      message,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: { campaignId: v.id("marketingCampaigns") },
  handler: async (ctx, args) => {
    const campaign = await requireCampaign(ctx, args.campaignId);
    const touches = await touchesOf(ctx, campaign._id);
    if (touches.some((row) => row.status === "sending")) {
      throw new Error("A reminder for this event is sending right now. Wait for it to finish.");
    }
    for (const row of touches) {
      if (isPending(row)) {
        await ctx.db.delete("marketingEvents", row._id);
      } else {
        // What went out stays on the calendar, as a plain entry now.
        await ctx.db.patch("marketingEvents", row._id, {
          campaignId: undefined,
          offsetDays: undefined,
        });
      }
    }
    await ctx.db.delete("marketingCampaigns", campaign._id);
    return { success: true };
  },
});

// ---------------------------------------------------------- the desk's side

/** Throws unless the caller may work on this event. For the public rewrite. */
export const access = internalQuery({
  args: { campaignId: v.id("marketingCampaigns") },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId);
    return null;
  },
});

/**
 * Everything the desk needs to write an event's reminders, and which of them
 * to write. A mutation only because the desk is created here if the workspace
 * does not have one yet.
 *
 * `eventIds` names reminders explicitly — the one about to send — whatever
 * their status; without it, every reminder still to go out is a candidate.
 * `overwrite` false leaves any reminder that already has a line alone.
 */
export const writingContext = internalMutation({
  args: {
    campaignId: v.id("marketingCampaigns"),
    eventIds: v.optional(v.array(v.id("marketingEvents"))),
    overwrite: v.boolean(),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get("marketingCampaigns", args.campaignId);
    if (!campaign) return null;
    const workspace = await ctx.db.get("workspaces", campaign.workspaceId);
    if (!workspace) return null;
    const { agentId } = await ensureMarketingDesk(ctx, campaign.workspaceId);
    const agent = await ctx.db.get("agents", agentId);
    if (!agent) return null;

    const touches = (await touchesOf(ctx, campaign._id)).filter(
      (row) =>
        (args.eventIds ? args.eventIds.includes(row._id) : isPending(row)) &&
        (args.overwrite || !row.message)
    );

    return {
      agent: {
        _id: agent._id,
        jobDescription: agent.jobDescription,
        rules: agent.rules,
        guardrails: agent.guardrails,
        tone: agent.tone,
        model: agent.model,
        temperature: agent.temperature,
      },
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        locale: workspace.locale,
        industry: workspace.industry ?? null,
        description: workspace.description ?? null,
      },
      campaign: {
        title: campaign.title,
        date: campaign.date,
        startTime: campaign.startTime ?? null,
        venue: campaign.venue ?? null,
        details: campaign.details,
        offer: campaign.offer ?? null,
        link: campaign.link ?? null,
      },
      touches: touches.map((row) => ({
        eventId: row._id,
        offsetDays: row.offsetDays ?? 0,
        guestSegment: row.guestSegment,
        date: row.date,
      })),
    };
  },
});

/** Stores the lines the desk wrote. Never over a reminder that has gone out. */
export const saveMessages = internalMutation({
  args: {
    messages: v.array(
      v.object({ eventId: v.id("marketingEvents"), message: v.string() })
    ),
    overwrite: v.boolean(),
  },
  handler: async (ctx, args) => {
    let saved = 0;
    for (const row of args.messages) {
      const event = await ctx.db.get("marketingEvents", row.eventId);
      if (!event?.campaignId) continue;
      // "sending" too: the send-time rewrite is for a reminder already
      // claimed by the sweep and waiting on exactly this line.
      if (!isPending(event) && event.status !== "sending") continue;
      // The owner may have typed their own while the desk was writing.
      if (!args.overwrite && event.message) continue;
      const message = asParameter(row.message).slice(0, MAX_MESSAGE);
      if (!message) continue;
      await ctx.db.patch("marketingEvents", event._id, {
        message,
        updatedAt: Date.now(),
      });
      saved++;
    }
    return { saved };
  },
});
