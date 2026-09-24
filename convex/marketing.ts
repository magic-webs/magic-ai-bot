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
// `birthday` is today's day and month, once a day, at the hour set.

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
import { ensureMarketingDesk } from "./agents";
import {
  festivalsBetween,
  isLocalDate,
  metaBody,
  zonedParts,
  zonedToInstant,
} from "./lib/marketing";

/** How many contacts one send batch covers. */
export const SEND_BATCH = 40;
/** How far the audience count looks before it says "at least". */
const AUDIENCE_SCAN_CAP = 2000;
/** The longest window the calendar query answers for — a month and a bit. */
const MAX_CALENDAR_DAYS = 62;
const DEFAULT_BIRTHDAY_HOUR = 9;

const occasion = v.union(
  v.literal("birthday"),
  v.literal("festival"),
  v.literal("offer"),
  v.literal("general")
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
async function sendingChannel(
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

async function templateInWorkspace(
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

function clampHour(hour: number): number {
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
        whatsapp: scanned.filter((c) => c.channelType === "whatsapp").length,
        capped: scanned.length >= AUDIENCE_SCAN_CAP,
        withBirthday: withBirthday.filter((c) => c.channelType === "whatsapp")
          .length,
      },
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
      await templateInWorkspace(ctx, args.workspaceId, args.templateId);
      await ctx.db.patch("marketingTemplates", args.templateId, {
        name,
        occasion: args.occasion,
        body,
        metaTemplateName,
        languageCode,
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

// ---------------------------------------------------------------- the sweeps

async function startEvent(
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
  agentId: Id<"agents"> | null;
  template: Doc<"marketingTemplates"> | null;
  channel: {
    apiBaseUrl: string;
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
  } | null;
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
  return {
    workspaceName: workspace.name,
    agentId: desk?._id ?? null,
    template: template && template.workspaceId === workspaceId ? template : null,
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
    return context ? { ...context, event } : null;
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
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const options = { numItems: SEND_BATCH, cursor: args.cursor };
    const monthDay = args.monthDay;
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

    const contacts: Array<{
      contactId: Id<"contacts">;
      to: string;
      name?: string;
    }> = [];
    for (const contact of page.page) {
      if (contact.channelType !== "whatsapp") continue;
      const already = await ctx.db
        .query("marketingSends")
        .withIndex("by_contact_and_key", (q) =>
          q.eq("contactId", contact._id).eq("key", args.key)
        )
        .first();
      if (already?.status === "sent") continue;
      contacts.push({
        contactId: contact._id,
        to: contact.externalId,
        name: contact.name,
      });
    }

    return {
      contacts,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Logs a batch of sends and puts each delivered greeting in the contact's
 * thread, so the Chats screen shows what they were sent and the agent sees it
 * in history when they reply to it.
 */
export const recordBatch = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventId: v.optional(v.id("marketingEvents")),
    key: v.string(),
    agentId: v.optional(v.id("agents")),
    results: v.array(
      v.object({
        contactId: v.id("contacts"),
        ok: v.boolean(),
        text: v.string(),
        error: v.optional(v.string()),
      })
    ),
    done: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let sent = 0;
    let failed = 0;
    let lastError: string | undefined;

    for (const result of args.results) {
      await ctx.db.insert("marketingSends", {
        workspaceId: args.workspaceId,
        contactId: result.contactId,
        eventId: args.eventId,
        key: args.key,
        status: result.ok ? "sent" : "failed",
        error: result.error,
        createdAt: now,
      });

      if (!result.ok) {
        failed++;
        lastError = result.error;
        continue;
      }
      sent++;

      // A contact can have one conversation per agent; the latest one is the
      // thread a person means. Someone with no thread yet has nothing to
      // write into, and the send log is the record.
      const threads = await ctx.db
        .query("conversations")
        .withIndex("by_contact_agent", (q) => q.eq("contactId", result.contactId))
        .take(20);
      const thread = threads.reduce<Doc<"conversations"> | null>(
        (best, row) => (!best || row.lastMessageAt > best.lastMessageAt ? row : best),
        null
      );
      if (!thread) continue;

      await ctx.db.insert("messages", {
        workspaceId: args.workspaceId,
        conversationId: thread._id,
        role: "assistant",
        kind: "text",
        text: result.text,
        agentId: args.agentId,
        createdAt: now,
      });
      await ctx.db.patch("conversations", thread._id, {
        messageCount: thread.messageCount + 1,
        lastMessageAt: now,
        lastMessagePreview: result.text.slice(0, 140),
        lastMessageRole: "assistant",
      });
    }

    if (args.eventId) {
      const event = await ctx.db.get("marketingEvents", args.eventId);
      if (event) {
        const sentCount = event.sentCount + sent;
        const failedCount = event.failedCount + failed;
        await ctx.db.patch("marketingEvents", event._id, {
          sentCount,
          failedCount,
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
