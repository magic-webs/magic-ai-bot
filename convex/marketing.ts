// The marketing desk: templates, the calendar of greetings and the standing
// birthday wish.
//
// How a greeting gets out, end to end:
//
//   owner puts Diwali on the calendar with a template, 9am
//     -> saveEvent resolves 9am in the workspace's timezone to `sendAt`
//     -> the sweep (convex/crons.ts) claims it once `sendAt` has passed
//     -> marketingSend.runEvent pages through the WhatsApp contacts, sending
//        the approved template to each, forty at a time
//     -> recordBatch logs every send, and writes the greeting into the
//        contact's thread so the Chats screen shows what they were sent
//
// Birthdays are the same path with a different audience: every contact whose
// `birthday` is today's day and month, once a day, at the hour set. An event's
// reminders (convex/marketingCampaigns.ts) are calendar entries too, and go
// out the same way.

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { charge } from "./lib/charge";
import { normalisePhone } from "./lib/notifications";
import { templateBlock } from "./lib/wallet";
import { recordAgentReply } from "./lib/agentStats";
import { insertConversation, noteMessage } from "./lib/inbox";
import { ensureMarketingDesk } from "./agents";
import {
  festivalsBetween,
  isLocalDate,
  metaBody,
  zonedParts,
  zonedToInstant,
} from "./lib/marketing";
import { noteSent } from "./lib/delivery";
import {
  bumpStats,
  sentRecently,
  statsFor,
  type MarketingCounts,
} from "./lib/marketingStats";
import {
  audienceCategory as audienceCategoryValidator,
  audienceSelection as audienceSelectionValidator,
  guestSegment as guestSegmentValidator,
} from "./schema/marketing";
import { inSelection, isBuiltIn, reachable, withBuiltIns } from "./lib/audience";

/** How many contacts one send batch covers. */
export const SEND_BATCH = 40;
/** How far the audience count looks before it says "at least". */
const AUDIENCE_SCAN_CAP = 2000;
/** The longest window the calendar query answers for — a month and a bit. */
const MAX_CALENDAR_DAYS = 62;
const DEFAULT_BIRTHDAY_HOUR = 9;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const occasion = v.union(
  v.literal("birthday"),
  v.literal("festival"),
  v.literal("offer"),
  v.literal("event"),
  v.literal("general")
);

/** What Meta approved a template as — and so what each send is billed at. */
const templateCategory = v.union(
  v.literal("marketing"),
  v.literal("utility"),
  v.literal("authentication")
);

// ------------------------------------------------------------------ helpers

async function settingsFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"marketingSettings"> | null> {
  return await ctx.db
    .query("marketingSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

/** The number greetings go out from: the workspace's first live WhatsApp channel. */
export async function sendingChannel(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"channels"> | null> {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return (
    channels.find(
      (channel) =>
        channel.type === "whatsapp" &&
        channel.status === "active" &&
        Boolean(channel.whatsapp)
    ) ?? null
  );
}

export async function templateInWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  templateId: Id<"marketingTemplates">
): Promise<Doc<"marketingTemplates">> {
  const template = await ctx.db.get("marketingTemplates", templateId);
  if (!template || template.workspaceId !== workspaceId) {
    throw new Error("Template not found");
  }
  return template;
}

async function requireEvent(
  ctx: QueryCtx,
  eventId: Id<"marketingEvents">
): Promise<Doc<"marketingEvents">> {
  const event = await ctx.db.get("marketingEvents", eventId);
  if (!event) throw new Error("Calendar entry not found");
  await requireWorkspace(ctx, event.workspaceId);
  return event;
}

export function clampHour(hour: number): number {
  return Math.min(23, Math.max(0, Math.round(hour)));
}

function withMeta(template: Doc<"marketingTemplates">) {
  return { ...template, metaBody: metaBody(template.body) };
}

// ------------------------------------------------------------------ queries

/** Everything the marketing screen needs that is not date-bound. */
export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;

    const desk = await ctx.db
      .query("agents")
      .withIndex("by_workspace_kind", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("kind", "marketing")
      )
      .first();

    const templates = await ctx.db
      .query("marketingTemplates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    templates.sort((a, b) => a.createdAt - b.createdAt);

    const settings = await settingsFor(ctx, args.workspaceId);
    const channel = await sendingChannel(ctx, args.workspaceId);

    // Counted up to a cap rather than exactly: Convex has no count, and "at
    // least 2,000 people" is as useful on this screen as the precise figure.
    const scanned = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(AUDIENCE_SCAN_CAP);
    const withBirthday = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_and_birthday", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("birthday", "01-01")
      )
      .take(AUDIENCE_SCAN_CAP);

    return {
      timezone: workspace.timezone,
      desk: desk ? { _id: desk._id, botName: desk.botName } : null,
      templates: templates.map(withMeta),
      settings: {
        birthdayEnabled: settings?.birthdayEnabled ?? false,
        birthdayTemplateId: settings?.birthdayTemplateId ?? null,
        birthdayHour: settings?.birthdayHour ?? DEFAULT_BIRTHDAY_HOUR,
        lastBirthdayRun: settings?.lastBirthdayRun ?? null,
      },
      channel: channel
        ? {
            name: channel.name,
            phone: channel.whatsapp?.displayPhoneNumber ?? null,
          }
        : null,
      audience: {
        whatsapp: scanned.filter(reachable).length,
        optedOut: scanned.filter((c) => c.channelType === "whatsapp" && c.optedOutAt)
          .length,
        capped: scanned.length >= AUDIENCE_SCAN_CAP,
        withBirthday: withBirthday.filter(reachable).length,
      },
      weeklyCap: settings?.weeklyCap ?? 0,
      categories: withBuiltIns(settings?.categories),
    };
  },
});

/**
 * What falls between two local dates: the workspace's own entries, the
 * birthdays, and the preset festivals — marked when already on the calendar.
 */
export const calendar = query({
  args: {
    workspaceId: v.id("workspaces"),
    from: v.string(),
    to: v.string(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (!isLocalDate(args.from) || !isLocalDate(args.to) || args.from > args.to) {
      throw new Error("Pass a date range as YYYY-MM-DD.");
    }
    const span = (Date.parse(args.to) - Date.parse(args.from)) / 86_400_000;
    if (span > MAX_CALENDAR_DAYS) {
      throw new Error(`Ask for at most ${MAX_CALENDAR_DAYS} days at a time.`);
    }

    const events = await ctx.db
      .query("marketingEvents")
      .withIndex("by_workspace_and_date", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("date", args.from)
          .lte("date", args.to)
      )
      .take(300);

    const templateNames = new Map<string, string>();
    for (const event of events) {
      if (!event.templateId || templateNames.has(event.templateId)) continue;
      const template = await ctx.db.get("marketingTemplates", event.templateId);
      if (template) templateNames.set(event.templateId, template.name);
    }

    // Birthdays are stored without a year, so the range is on "MM-DD" — split
    // in two when it runs across New Year.
    const fromDay = args.from.slice(5);
    const toDay = args.to.slice(5);
    const ranges: Array<[string, string]> =
      fromDay <= toDay
        ? [[fromDay, toDay]]
        : [
            [fromDay, "12-31"],
            ["01-01", toDay],
          ];
    const birthdays: Array<{
      contactId: Id<"contacts">;
      name: string;
      birthday: string;
    }> = [];
    for (const [low, high] of ranges) {
      const rows = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_and_birthday", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .gte("birthday", low)
            .lte("birthday", high)
        )
        .take(500);
      for (const contact of rows) {
        if (contact.channelType !== "whatsapp" || !contact.birthday) continue;
        birthdays.push({
          contactId: contact._id,
          name: contact.name ?? contact.phone ?? contact.externalId,
          birthday: contact.birthday,
        });
      }
    }

    const added = new Set(
      events
        .filter((event) => event.presetKey)
        .map((event) => `${event.presetKey}:${event.date.slice(0, 4)}`)
    );

    return {
      events: events.map((event) => ({
        ...event,
        templateName: event.templateId
          ? (templateNames.get(event.templateId) ?? null)
          : null,
      })),
      birthdays,
      festivals: festivalsBetween(args.from, args.to).map((festival) => ({
        ...festival,
        added: added.has(`${festival.key}:${festival.date.slice(0, 4)}`),
      })),
    };
  },
});

/**
 * The next preset festivals not yet on the calendar, for the suggestions row.
 * `today` comes from the caller, since a query must not read the clock.
 */
export const upcomingFestivals = query({
  args: {
    workspaceId: v.id("workspaces"),
    today: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (!isLocalDate(args.today)) throw new Error("Pass today as YYYY-MM-DD.");

    const days = Math.min(365, Math.max(1, args.days ?? 120));
    const until = new Date(Date.parse(args.today) + days * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const events = await ctx.db
      .query("marketingEvents")
      .withIndex("by_workspace_and_date", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("date", args.today)
          .lte("date", until)
      )
      .take(500);
    const added = new Set(
      events.map((event) => `${event.presetKey}:${event.date.slice(0, 4)}`)
    );

    return festivalsBetween(args.today, until).filter(
      (festival) => !added.has(`${festival.key}:${festival.date.slice(0, 4)}`)
    );
  },
});

/** WhatsApp contacts, newest first, for setting birthdays by hand. */
export const contacts = query({
  args: { workspaceId: v.id("workspaces"), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(500);

    const needle = args.search?.trim().toLowerCase() ?? "";
    return rows
      .filter((contact) => contact.channelType === "whatsapp")
      .filter(
        (contact) =>
          !needle ||
          [contact.name, contact.phone, contact.externalId, contact.company]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(needle))
      )
      .slice(0, 150)
      .map((contact) => ({
        _id: contact._id,
        label: contact.name ?? contact.phone ?? contact.externalId,
        phone: contact.phone ?? contact.externalId,
        birthday: contact.birthday ?? null,
      }));
  },
});

// ---------------------------------------------------------------- mutations

export const ensureDesk = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ensureMarketingDesk(ctx, args.workspaceId);
  },
});

export const saveTemplate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    templateId: v.optional(v.id("marketingTemplates")),
    name: v.string(),
    occasion,
    body: v.string(),
    metaTemplateName: v.optional(v.string()),
    languageCode: v.optional(v.string()),
    category: v.optional(templateCategory),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const name = args.name.trim();
    const body = args.body.trim();
    if (!name) throw new Error("Give the template a name.");
    if (!body) throw new Error("Write the message first.");
    if (body.length > 1024) {
      // Meta's limit on a template body.
      throw new Error("Keep the message under 1,024 characters.");
    }

    // Meta names are lowercase, digits and underscores; normalised here so a
    // pasted "Diwali Wishes" still matches the approved diwali_wishes.
    const metaTemplateName =
      args.metaTemplateName
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "") || undefined;
    const languageCode = args.languageCode?.trim() || "en";

    const now = Date.now();
    if (args.templateId) {
      const existing = await templateInWorkspace(ctx, args.workspaceId, args.templateId);

      // Keeping Meta's copy honest. A name typed over by hand links a
      // different template, so what was tracked for the old one goes. A
      // change to the text, language or category of one applied from here
      // means Meta approved something else — it stops sending until the
      // change is applied too. A new language is a new template in Meta, so
      // it loses the id an edit would go to.
      const relinked = metaTemplateName !== existing.metaTemplateName;
      const reworded =
        body !== existing.body ||
        languageCode !== existing.languageCode ||
        (args.category !== undefined && args.category !== (existing.category ?? "marketing"));
      const review = relinked
        ? {
            metaStatus: undefined,
            metaTemplateId: undefined,
            metaRejectedReason: undefined,
          }
        : reworded && existing.metaStatus
          ? {
              metaStatus: "CHANGED",
              ...(languageCode !== existing.languageCode ? { metaTemplateId: undefined } : {}),
            }
          : {};

      await ctx.db.patch("marketingTemplates", args.templateId, {
        name,
        occasion: args.occasion,
        body,
        metaTemplateName,
        languageCode,
        // Left alone when not given, so a caller that predates categories
        // cannot quietly move a utility template back to marketing.
        ...(args.category ? { category: args.category } : {}),
        ...review,
        updatedAt: now,
      });
      return args.templateId;
    }

    return await ctx.db.insert("marketingTemplates", {
      workspaceId: args.workspaceId,
      name,
      occasion: args.occasion,
      body,
      metaTemplateName,
      languageCode,
      category: args.category ?? "marketing",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const removeTemplate = mutation({
  args: { templateId: v.id("marketingTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get("marketingTemplates", args.templateId);
    if (!template) return { success: true };
    await requireWorkspace(ctx, template.workspaceId);

    // Anything still waiting to go out on it goes back to draft rather than
    // sending with a template that is no longer there.
    const events = await ctx.db
      .query("marketingEvents")
      .withIndex("by_workspace_and_date", (q) =>
        q.eq("workspaceId", template.workspaceId)
      )
      .take(1000);
    for (const event of events) {
      if (event.templateId !== args.templateId) continue;
      if (event.status === "sending") {
        throw new Error("A calendar entry is sending with this template right now.");
      }
      if (event.status === "scheduled" || event.status === "draft") {
        await ctx.db.patch("marketingEvents", event._id, {
          templateId: undefined,
          status: "draft",
          updatedAt: Date.now(),
        });
      }
    }

    // An event keeps no template it could not save again with: its reminders
    // went back to draft above, and the event itself is cleared to match.
    const campaigns = await ctx.db
      .query("marketingCampaigns")
      .withIndex("by_workspace_and_date", (q) =>
        q.eq("workspaceId", template.workspaceId)
      )
      .take(500);
    for (const campaign of campaigns) {
      if (campaign.templateId !== args.templateId) continue;
      await ctx.db.patch("marketingCampaigns", campaign._id, {
        templateId: undefined,
        updatedAt: Date.now(),
      });
    }

    const settings = await settingsFor(ctx, template.workspaceId);
    if (settings?.birthdayTemplateId === args.templateId) {
      await ctx.db.patch("marketingSettings", settings._id, {
        birthdayTemplateId: undefined,
        birthdayEnabled: false,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete("marketingTemplates", args.templateId);
    return { success: true };
  },
});

export const saveEvent = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventId: v.optional(v.id("marketingEvents")),
    title: v.string(),
    date: v.string(),
    sendHour: v.number(),
    templateId: v.optional(v.id("marketingTemplates")),
    presetKey: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const title = args.title.trim();
    if (!title) throw new Error("Give the entry a title.");
    if (!isLocalDate(args.date)) throw new Error("Pick a date.");
    if (args.templateId) {
      await templateInWorkspace(ctx, args.workspaceId, args.templateId);
    }

    const sendHour = clampHour(args.sendHour);
    const sendAt = zonedToInstant(args.date, sendHour, workspace.timezone);
    const now = Date.now();
    if (args.templateId && sendAt <= now) {
      throw new Error("That time has already passed. Pick a later one, or use Send now.");
    }

    const fields = {
      title,
      date: args.date,
      sendHour,
      sendAt,
      templateId: args.templateId,
      note: args.note?.trim() || undefined,
      status: args.templateId ? ("scheduled" as const) : ("draft" as const),
      updatedAt: now,
    };

    if (args.eventId) {
      const event = await requireEvent(ctx, args.eventId);
      if (event.workspaceId !== args.workspaceId) {
        throw new Error("Calendar entry not found");
      }
      if (event.status === "sending" || event.status === "sent") {
        throw new Error("This one has already gone out, so it can no longer be changed.");
      }
      // Its day, hour and template are the event's, and the next save of the
      // event would put them back — so they are changed there, not here.
      if (event.campaignId) {
        throw new Error("This is one of an event's reminders. Change it from the event.");
      }
      await ctx.db.patch("marketingEvents", args.eventId, {
        ...fields,
        lastError: undefined,
      });
      return args.eventId;
    }

    return await ctx.db.insert("marketingEvents", {
      workspaceId: args.workspaceId,
      presetKey: args.presetKey,
      sentCount: 0,
      failedCount: 0,
      createdAt: now,
      ...fields,
    });
  },
});

export const removeEvent = mutation({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await requireEvent(ctx, args.eventId);
    if (event.status === "sending") {
      throw new Error("This is sending right now. Wait for it to finish.");
    }
    await ctx.db.delete("marketingEvents", event._id);
    return { success: true };
  },
});

/** Skips the wait: sends a calendar entry straight away. */
export const sendEventNow = mutation({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await requireEvent(ctx, args.eventId);
    if (!event.templateId) throw new Error("Pick a template first.");
    if (event.status === "sending" || event.status === "sent") {
      throw new Error("This one has already gone out.");
    }
    await startEvent(ctx, event, 0);
    return { success: true };
  },
});

export const saveSettings = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    birthdayEnabled: v.boolean(),
    birthdayTemplateId: v.optional(v.id("marketingTemplates")),
    birthdayHour: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.birthdayTemplateId) {
      await templateInWorkspace(ctx, args.workspaceId, args.birthdayTemplateId);
    }
    if (args.birthdayEnabled && !args.birthdayTemplateId) {
      throw new Error("Pick the template birthday wishes are sent with.");
    }

    const fields = {
      birthdayEnabled: args.birthdayEnabled,
      birthdayTemplateId: args.birthdayTemplateId,
      birthdayHour: clampHour(args.birthdayHour),
      updatedAt: Date.now(),
    };
    const existing = await settingsFor(ctx, args.workspaceId);
    if (existing) {
      await ctx.db.patch("marketingSettings", existing._id, fields);
    } else {
      await ctx.db.insert("marketingSettings", {
        workspaceId: args.workspaceId,
        ...fields,
      });
    }
    return { success: true };
  },
});

const MAX_CATEGORIES = 12;

export const saveAudienceSettings = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    weeklyCap: v.number(),
    categories: v.array(audienceCategoryValidator),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const categories = args.categories
      .map((category) => ({
        key: category.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 32),
        label: category.label.trim().slice(0, 40),
        description: category.description.trim().slice(0, 300),
      }))
      .filter((category) => category.key && category.label && !isBuiltIn(category.key));
    if (categories.length > MAX_CATEGORIES) {
      throw new Error(`Use at most ${MAX_CATEGORIES} categories.`);
    }
    if (new Set(categories.map((c) => c.key)).size !== categories.length) {
      throw new Error("Two categories have the same name.");
    }
    const fields = {
      weeklyCap: Math.max(0, Math.min(14, Math.round(args.weeklyCap))),
      categories,
      updatedAt: Date.now(),
    };
    const existing = await settingsFor(ctx, args.workspaceId);
    if (existing) {
      await ctx.db.patch("marketingSettings", existing._id, fields);
    } else {
      await ctx.db.insert("marketingSettings", {
        workspaceId: args.workspaceId,
        birthdayEnabled: false,
        birthdayHour: DEFAULT_BIRTHDAY_HOUR,
        ...fields,
      });
    }
    return { success: true };
  },
});

export const stats = query({
  args: { workspaceId: v.id("workspaces"), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const result: Record<string, MarketingCounts> = {};
    for (const key of args.keys.slice(0, 100)) {
      result[key] = await statsFor(ctx, key);
    }
    return result;
  },
});

// ---------------------------------------------------------------- the sweeps

export async function startEvent(
  ctx: MutationCtx,
  event: Doc<"marketingEvents">,
  delayMs: number
) {
  const now = Date.now();
  await ctx.db.patch("marketingEvents", event._id, {
    status: "sending",
    startedAt: now,
    lastError: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(delayMs, internal.marketingSend.runEvent, {
    eventId: event._id,
  });
}

/** Claims every calendar entry whose time has come. Run by the cron. */
export const claimDueEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("marketingEvents")
      .withIndex("by_status_and_sendAt", (q) =>
        q.eq("status", "scheduled").lte("sendAt", now)
      )
      .take(25);
    // Staggered, so a festival every workspace has on the calendar at 9am
    // does not put all of them through Meta in the same second.
    for (const [index, event] of due.entries()) {
      await startEvent(ctx, event, index * 2000);
    }
    return { claimed: due.length };
  },
});

/**
 * Starts today's birthday wishes for every workspace whose hour has come.
 * Run hourly; `lastBirthdayRun` is what makes it once a day.
 */
export const claimBirthdays = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const enabled = await ctx.db
      .query("marketingSettings")
      .withIndex("by_birthdayEnabled", (q) => q.eq("birthdayEnabled", true))
      .take(500);

    let started = 0;
    for (const settings of enabled) {
      if (!settings.birthdayTemplateId) continue;
      const workspace = await ctx.db.get("workspaces", settings.workspaceId);
      if (!workspace || workspace.status !== "active") continue;

      const local = zonedParts(now, workspace.timezone);
      if (local.hour < settings.birthdayHour) continue;
      if (settings.lastBirthdayRun === local.date) continue;

      await ctx.db.patch("marketingSettings", settings._id, {
        lastBirthdayRun: local.date,
      });
      await ctx.scheduler.runAfter(
        started * 2000,
        internal.marketingSend.runBirthdays,
        {
          workspaceId: settings.workspaceId,
          monthDay: local.date.slice(5),
          key: `birthday:${local.date.slice(0, 4)}`,
        }
      );
      started++;
    }
    return { started };
  },
});

// ------------------------------------------------------- what the sender reads

type SendContext = {
  workspaceName: string;
  /** For the event's date as the customer reads it. */
  locale: string;
  agentId: Id<"agents"> | null;
  /**
   * The sending number, and the agent it points at: the conversation key an
   * inbound reply is filed under, so a message written there is the thread
   * the customer's answer lands in.
   */
  channelId: Id<"channels"> | null;
  entryAgentId: Id<"agents"> | null;
  template: Doc<"marketingTemplates"> | null;
  channel: {
    apiBaseUrl: string;
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
  } | null;
  /** Why the wallet cannot pay for this template now, if it cannot. */
  walletBlock: string | null;
};

async function sendContext(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  templateId: Id<"marketingTemplates"> | undefined
): Promise<SendContext | null> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return null;
  const template = templateId
    ? await ctx.db.get("marketingTemplates", templateId)
    : null;
  const channel = await sendingChannel(ctx, workspaceId);
  const desk = await ctx.db
    .query("agents")
    .withIndex("by_workspace_kind", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", "marketing")
    )
    .first();
  const own = template && template.workspaceId === workspaceId ? template : null;
  return {
    workspaceName: workspace.name,
    locale: workspace.locale,
    agentId: desk?._id ?? null,
    channelId: channel?._id ?? null,
    entryAgentId: channel?.agentId ?? null,
    template: own,
    // Read per page, so a campaign that drains the wallet stops at the page
    // it ran out on rather than sending the rest on credit.
    walletBlock: own
      ? await templateBlock(ctx, workspaceId, own.category ?? "marketing")
      : null,
    channel: channel?.whatsapp
      ? {
          apiBaseUrl: channel.whatsapp.apiBaseUrl,
          apiVersion: channel.whatsapp.apiVersion,
          phoneNumberId: channel.whatsapp.phoneNumberId,
          accessToken: channel.whatsapp.accessToken,
        }
      : null,
  };
}

export const eventContext = internalQuery({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event) return null;
    const context = await sendContext(ctx, event.workspaceId, event.templateId);
    // A reminder speaks for its event: the name, day and venue in the
    // template are the event's, not the reminder's own calendar title.
    const campaign = event.campaignId
      ? await ctx.db.get("marketingCampaigns", event.campaignId)
      : null;
    return context ? { ...context, event, campaign } : null;
  },
});

export const birthdayContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const settings = await settingsFor(ctx, args.workspaceId);
    if (!settings?.birthdayEnabled) return null;
    return await sendContext(ctx, args.workspaceId, settings.birthdayTemplateId);
  },
});

/**
 * One page of who to send to, minus anyone already sent this occasion.
 * By birthday when `monthDay` is given, otherwise every WhatsApp contact.
 */
export const audiencePage = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    key: v.string(),
    monthDay: v.optional(v.string()),
    audience: v.optional(audienceSelectionValidator),
    campaignId: v.optional(v.id("marketingCampaigns")),
    guestSegment: v.optional(guestSegmentValidator),
    now: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const options = { numItems: SEND_BATCH, cursor: args.cursor };
    const monthDay = args.monthDay;
    const campaignId = args.campaignId;
    const fromGuests =
      campaignId &&
      (args.guestSegment === "interested" ||
        args.guestSegment === "attended" ||
        args.guestSegment === "no_show");

    let candidates: Array<Doc<"contacts"> | null>;
    let continueCursor: string;
    let isDone: boolean;
    if (fromGuests) {
      const page = await ctx.db
        .query("eventGuests")
        .withIndex("by_campaignId_and_contactId", (q) => q.eq("campaignId", campaignId))
        .paginate(options);
      const wanted = page.page.filter((guest) => {
        const interested = guest.rsvp === "going" || guest.rsvp === "maybe";
        if (args.guestSegment === "interested") return interested;
        if (args.guestSegment === "attended") return guest.attended === true;
        return interested && !guest.attended;
      });
      candidates = await Promise.all(wanted.map((guest) => ctx.db.get("contacts", guest.contactId)));
      ({ continueCursor, isDone } = page);
    } else {
      const page = monthDay
        ? await ctx.db
            .query("contacts")
            .withIndex("by_workspace_and_birthday", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("birthday", monthDay)
            )
            .paginate(options)
        : await ctx.db
            .query("contacts")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
            .paginate(options);
      candidates = page.page;
      ({ continueCursor, isDone } = page);
    }

    const settings = await settingsFor(ctx, args.workspaceId);
    const cap = !monthDay && args.now ? (settings?.weeklyCap ?? 0) : 0;

    const contacts: Array<{
      contactId: Id<"contacts">;
      to: string;
      name?: string;
    }> = [];
    let skipped = 0;
    for (const contact of candidates) {
      if (!contact || contact.workspaceId !== args.workspaceId) continue;
      if (!reachable(contact)) continue;
      if (!fromGuests && !(await inSelection(ctx, contact, args.audience))) continue;
      if (campaignId && args.guestSegment === "not_declined") {
        const guest = await ctx.db
          .query("eventGuests")
          .withIndex("by_campaignId_and_contactId", (q) =>
            q.eq("campaignId", campaignId).eq("contactId", contact._id)
          )
          .unique();
        if (guest?.rsvp === "declined") continue;
      }
      const already = await ctx.db
        .query("marketingSends")
        .withIndex("by_contact_and_key", (q) =>
          q.eq("contactId", contact._id).eq("key", args.key)
        )
        .first();
      if (already?.status === "sent") continue;
      if (cap > 0 && (await sentRecently(ctx, contact._id, args.now! - WEEK_MS)) >= cap) {
        skipped++;
        continue;
      }
      contacts.push({
        contactId: contact._id,
        to: contact.externalId,
        name: contact.name,
      });
    }

    return { contacts, skipped, continueCursor, isDone };
  },
});

/**
 * The thread a marketing message to this contact is written into: the one
 * their reply would land in — keyed on the agent the sending number points
 * at, as the inbound webhook keys it — found, or opened here.
 *
 * One opened here is `marketingOnly` until they answer: a message sent, not a
 * conversation had, which the follow-up desk and the dashboard leave alone.
 */
async function marketingThread(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    contactId: Id<"contacts">;
    entryAgentId?: Id<"agents">;
    channelId?: Id<"channels">;
    now: number;
  }
): Promise<Doc<"conversations"> | null> {
  if (!args.entryAgentId) {
    // No sending number to key on — only a send that started before its
    // channel was removed. The contact's latest thread, as it always was.
    const threads = await ctx.db
      .query("conversations")
      .withIndex("by_contact_agent", (q) => q.eq("contactId", args.contactId))
      .take(20);
    return threads.reduce<Doc<"conversations"> | null>(
      (best, row) => (!best || row.lastMessageAt > best.lastMessageAt ? row : best),
      null
    );
  }

  const entryAgentId = args.entryAgentId;
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) =>
      q.eq("contactId", args.contactId).eq("agentId", entryAgentId)
    )
    .unique();
  if (existing) return existing;

  const conversationId = await insertConversation(ctx, {
    workspaceId: args.workspaceId,
    agentId: entryAgentId,
    activeAgentId: entryAgentId,
    handoffCount: 0,
    contactId: args.contactId,
    channelId: args.channelId,
    channelType: "whatsapp",
    status: "open",
    messageCount: 0,
    lastMessageAt: args.now,
    marketingOnly: true,
    createdAt: args.now,
  });
  return await ctx.db.get("conversations", conversationId);
}

/** Writes one delivered marketing message into a thread, as the desk's. */
async function writeMarketingMessage(
  ctx: MutationCtx,
  thread: Doc<"conversations">,
  args: { text: string; agentId?: Id<"agents">; now: number; wamid?: string }
) {
  const messageId = await ctx.db.insert("messages", {
    workspaceId: thread.workspaceId,
    conversationId: thread._id,
    role: "assistant",
    kind: "text",
    text: args.text,
    agentId: args.agentId,
    createdAt: args.now,
  });
  const delivery = await noteSent(ctx, messageId, { wamid: args.wamid });
  await recordAgentReply(ctx, thread.workspaceId, args.agentId, {
    at: args.now,
    text: args.text,
  });
  const desk = args.agentId ? await ctx.db.get("agents", args.agentId) : null;
  await noteMessage(ctx, thread, {
    from: "agent",
    sender: desk?.botName,
    preview: args.text,
    at: args.now,
    delivery,
  });
  return messageId;
}

/**
 * Logs a batch of sends and puts each delivered greeting in the contact's
 * conversation — opening one for somebody who has never written — so the
 * inbox shows what they were sent and the agent reads it in history when they
 * reply.
 */
export const recordBatch = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventId: v.optional(v.id("marketingEvents")),
    key: v.string(),
    agentId: v.optional(v.id("agents")),
    /** The sending number and the agent it points at: the thread's key. */
    channelId: v.optional(v.id("channels")),
    entryAgentId: v.optional(v.id("agents")),
    /** What each delivered send is billed as. */
    category: v.optional(templateCategory),
    templateName: v.optional(v.string()),
    results: v.array(
      v.object({
        contactId: v.id("contacts"),
        /** The WhatsApp number it went to, for the billing ledger. */
        to: v.optional(v.string()),
        ok: v.boolean(),
        text: v.string(),
        error: v.optional(v.string()),
        wamid: v.optional(v.string()),
        linkCode: v.optional(v.string()),
        linkTarget: v.optional(v.string()),
      })
    ),
    skipped: v.optional(v.number()),
    nextCursor: v.optional(v.union(v.string(), v.null())),
    done: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let sent = 0;
    let failed = 0;
    let lastError: string | undefined;

    for (const result of args.results) {
      const sendId = await ctx.db.insert("marketingSends", {
        workspaceId: args.workspaceId,
        contactId: result.contactId,
        eventId: args.eventId,
        key: args.key,
        status: result.ok ? "sent" : "failed",
        error: result.error,
        text: result.ok ? result.text : undefined,
        agentId: args.agentId,
        delivery: result.ok ? "sent" : "failed",
        linkCode: result.ok ? result.linkCode : undefined,
        linkTarget: result.ok ? result.linkTarget : undefined,
        createdAt: now,
      });

      if (!result.ok) {
        failed++;
        lastError = result.error;
        continue;
      }
      sent++;

      const thread = await marketingThread(ctx, {
        workspaceId: args.workspaceId,
        contactId: result.contactId,
        entryAgentId: args.entryAgentId,
        channelId: args.channelId,
        now,
      });

      // Charged whether or not there is a thread to write it into: the
      // customer received a template either way, and that is what is billed.
      if (result.to) {
        await charge(ctx, {
          workspaceId: args.workspaceId,
          conversationId: thread?._id,
          to: result.to,
          category: args.category ?? "marketing",
          source: "campaign",
          preview: result.text,
          templateName: args.templateName,
          wamid: result.wamid,
        });
      }
      if (!thread) continue;
      const messageId = await writeMarketingMessage(ctx, thread, {
        text: result.text,
        agentId: args.agentId,
        now,
        wamid: result.wamid,
      });
      await ctx.db.patch("marketingSends", sendId, { messageId });
    }

    if (sent > 0 || failed > 0) {
      await bumpStats(ctx, args.workspaceId, args.key, { sent, failed });
    }

    if (args.eventId) {
      const event = await ctx.db.get("marketingEvents", args.eventId);
      if (event) {
        const sentCount = event.sentCount + sent;
        const failedCount = event.failedCount + failed;
        await ctx.db.patch("marketingEvents", event._id, {
          sentCount,
          failedCount,
          skippedCount: (event.skippedCount ?? 0) + (args.skipped ?? 0),
          cursor: args.nextCursor,
          lastError: lastError ?? event.lastError,
          updatedAt: now,
          ...(args.done
            ? {
                status: sentCount === 0 && failedCount > 0 ? "failed" : "sent",
                finishedAt: now,
              }
            : {}),
        });
      }
    }
    return { sent, failed };
  },
});

/** The desk and the business it speaks for, for the drafting action. */
export const draftContext = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const { agentId } = await ensureMarketingDesk(ctx, args.workspaceId);
    const agent = await ctx.db.get("agents", agentId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!agent || !workspace) throw new Error("Workspace not found");
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
        name: workspace.name,
        industry: workspace.industry ?? null,
        description: workspace.description ?? null,
        tagline: workspace.tagline ?? null,
      },
    };
  },
});

// ------------------------------------------------------------- test sends

/**
 * Everything a test send needs: a calendar entry (greeting or reminder) or a
 * bare template, where it goes out from, and the number it goes to —
 * normalised the way a contact's is, with the contact's own name when the
 * number is one on file. Checks the caller may.
 */
export const testContext = internalQuery({
  args: {
    eventId: v.optional(v.id("marketingEvents")),
    templateId: v.optional(v.id("marketingTemplates")),
    to: v.string(),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = args.eventId ? await ctx.db.get("marketingEvents", args.eventId) : null;
    if (args.eventId && !event) throw new Error("Calendar entry not found");
    const templateId = event ? event.templateId : args.templateId;
    if (!templateId) throw new Error("Pick a template first.");
    const template = await ctx.db.get("marketingTemplates", templateId);
    const workspaceId = event?.workspaceId ?? template?.workspaceId;
    if (!workspaceId) throw new Error("Template not found");
    await requireWorkspace(ctx, workspaceId);

    const context = await sendContext(ctx, workspaceId, templateId);
    if (!context) throw new Error("Workspace not found");
    const campaign = event?.campaignId
      ? await ctx.db.get("marketingCampaigns", event.campaignId)
      : null;

    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    const to = normalisePhone(
      args.to,
      args.countryCode?.trim() || settings?.defaultCountryCode || "91"
    );
    const contact = to
      ? await ctx.db
          .query("contacts")
          .withIndex("by_workspace_external", (q) =>
            q.eq("workspaceId", workspaceId).eq("externalId", to)
          )
          .unique()
      : null;

    return {
      ...context,
      workspaceId,
      event,
      campaign,
      to,
      contactId: contact?._id ?? null,
      contactName: contact?.name ?? null,
    };
  },
});

/**
 * Bills a test send, and puts it in the chat when the number is a contact's.
 *
 * It is a real template message, so it is charged like one — but it is not
 * logged as a send of the entry, so the number still gets the real one when
 * it goes out. A number nobody has on file gets no contact made for it: one
 * would put the tester on every campaign's audience.
 */
export const recordTest = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    to: v.string(),
    category: templateCategory,
    text: v.string(),
    templateName: v.optional(v.string()),
    wamid: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    agentId: v.optional(v.id("agents")),
    channelId: v.optional(v.id("channels")),
    entryAgentId: v.optional(v.id("agents")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const thread = args.contactId
      ? await marketingThread(ctx, {
          workspaceId: args.workspaceId,
          contactId: args.contactId,
          entryAgentId: args.entryAgentId,
          channelId: args.channelId,
          now,
        })
      : null;
    await charge(ctx, {
      workspaceId: args.workspaceId,
      conversationId: thread?._id,
      to: args.to,
      category: args.category,
      source: "campaign",
      preview: `Test · ${args.text}`,
      templateName: args.templateName,
      wamid: args.wamid,
    });
    if (thread) {
      await writeMarketingMessage(ctx, thread, {
        text: args.text,
        agentId: args.agentId,
        now,
        wamid: args.wamid,
      });
    }
    return null;
  },
});

// ------------------------------------------------- applying a template to Meta

/** The panel the sending number is connected through, as the apply calls need it. */
function panelOf(channel: Doc<"channels"> | null) {
  return channel?.whatsapp
    ? {
        apiBaseUrl: channel.whatsapp.apiBaseUrl,
        apiVersion: channel.whatsapp.apiVersion,
        accessToken: channel.whatsapp.accessToken,
        wabaId: channel.whatsapp.wabaId ?? null,
      }
    : null;
}

/** One template and where to apply it. Checks the caller may. */
export const applyContext = internalQuery({
  args: { templateId: v.id("marketingTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get("marketingTemplates", args.templateId);
    if (!template) throw new Error("Template not found");
    await requireWorkspace(ctx, template.workspaceId);
    const workspace = await ctx.db.get("workspaces", template.workspaceId);
    return {
      template,
      business: workspace?.name ?? "",
      panel: panelOf(await sendingChannel(ctx, template.workspaceId)),
    };
  },
});

/** Throws unless the caller may work in this workspace. */
export const assertWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return null;
  },
});

/**
 * Every template that goes by a name in Meta, and the panel to ask about
 * them. No access check: the review sweep runs it with nobody signed in, and
 * the owner's own check goes through `assertWorkspace` first.
 */
export const reviewContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("marketingTemplates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    return {
      panel: panelOf(await sendingChannel(ctx, args.workspaceId)),
      templates: templates
        .filter((t) => t.metaTemplateName)
        .map((t) => ({
          templateId: t._id,
          metaTemplateName: t.metaTemplateName!,
          languageCode: t.languageCode,
          metaStatus: t.metaStatus ?? null,
        })),
    };
  },
});

const metaCategory = (category: string | undefined) => {
  const lower = category?.toLowerCase();
  return lower === "marketing" || lower === "utility" || lower === "authentication"
    ? lower
    : undefined;
};

/** What Meta said when a template was applied. */
export const recordApplied = internalMutation({
  args: {
    templateId: v.id("marketingTemplates"),
    metaTemplateName: v.string(),
    metaTemplateId: v.optional(v.string()),
    status: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get("marketingTemplates", args.templateId);
    if (!template) return null;
    const category = metaCategory(args.category);
    const now = Date.now();
    await ctx.db.patch("marketingTemplates", template._id, {
      metaTemplateName: args.metaTemplateName,
      metaTemplateId: args.metaTemplateId ?? template.metaTemplateId,
      metaStatus: args.status.toUpperCase(),
      metaRejectedReason: undefined,
      // Meta may approve it under another category than asked for, and the
      // one it approves is the one every send is billed at.
      ...(category ? { category } : {}),
      appliedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/** Where Meta's review of each template now stands, from the panel's list. */
export const recordReviews = internalMutation({
  args: {
    rows: v.array(
      v.object({
        templateId: v.id("marketingTemplates"),
        status: v.string(),
        metaTemplateId: v.optional(v.string()),
        reason: v.optional(v.string()),
        category: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let changed = 0;
    for (const row of args.rows) {
      const template = await ctx.db.get("marketingTemplates", row.templateId);
      if (!template) continue;
      // An edit not yet applied stays marked as one: Meta's status is for
      // the text it has, not the text on screen.
      if (template.metaStatus === "CHANGED") continue;
      const status = row.status.toUpperCase();
      const category = metaCategory(row.category);
      const reason = status === "REJECTED" ? row.reason : undefined;
      if (
        template.metaStatus === status &&
        template.metaRejectedReason === reason &&
        (!row.metaTemplateId || template.metaTemplateId === row.metaTemplateId) &&
        (!category || template.category === category)
      ) {
        continue;
      }
      await ctx.db.patch("marketingTemplates", template._id, {
        metaStatus: status,
        metaRejectedReason: reason,
        ...(row.metaTemplateId ? { metaTemplateId: row.metaTemplateId } : {}),
        ...(category ? { category } : {}),
        updatedAt: Date.now(),
      });
      changed++;
    }
    return { changed };
  },
});

/**
 * Asks after every template still in Meta's review, a workspace at a time.
 * Run by the cron, so an approval is picked up without anyone checking.
 */
export const claimTemplateReviews = internalMutation({
  args: {},
  handler: async (ctx) => {
    const waiting = await ctx.db
      .query("marketingTemplates")
      .withIndex("by_metaStatus", (q) => q.eq("metaStatus", "PENDING"))
      .take(500);
    const workspaces = [...new Set(waiting.map((t) => t.workspaceId))];
    for (const [index, workspaceId] of workspaces.entries()) {
      await ctx.scheduler.runAfter(
        index * 1000,
        internal.marketingTemplates.checkReviews,
        { workspaceId }
      );
    }
    return { workspaces: workspaces.length };
  },
});

/** Ends a calendar entry that could not start at all, with the reason. */
export const failEvent = internalMutation({
  args: { eventId: v.id("marketingEvents"), error: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event) return;
    const now = Date.now();
    await ctx.db.patch("marketingEvents", event._id, {
      status: "failed",
      lastError: args.error,
      finishedAt: now,
      updatedAt: now,
    });
  },
});
