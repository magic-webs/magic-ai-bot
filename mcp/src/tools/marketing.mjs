/**
 * The marketing desk: its WhatsApp templates and Meta's review of them, the
 * business's own events and the reminders each sends, the greeting calendar,
 * birthday wishes, and the contacts all of it goes to.
 *
 * Everything the desk sends is an approved WhatsApp template, because a
 * greeting reaches people outside the 24-hour window. So the order that works
 * is: save a template, apply it to Meta, wait for APPROVED — then schedule.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findMarketingEvent, findMarketingTemplate } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

// Mirrors EVENT_TOUCHES in convex/lib/marketing.ts, which a .mjs file cannot
// import: days before (negative) or after (positive) the event.
const REMINDERS = {
  week_before: -7,
  three_days_before: -3,
  day_before: -1,
  on_the_day: 0,
  day_after: 1,
};
const REMINDER_NAMES = Object.keys(REMINDERS);
const reminderName = (offset) =>
  REMINDER_NAMES.find((name) => REMINDERS[name] === offset) ?? `${offset} days`;
const DEFAULT_REMINDERS = ["three_days_before", "day_before", "on_the_day", "day_after"];

/** At most this many people per addMany call — the mutation's own cap. */
const ADD_BATCH = 500;

const reminderArg = z.enum(REMINDER_NAMES);

const occasionArg = z
  .enum(["festival", "birthday", "event", "offer", "general"])
  .describe(
    "'event' is the template an event's reminders go out with: it must carry {{message}}, the line the desk writes for each reminder."
  );

/**
 * Whether a template can send now. Mirrors templateBlocker in
 * convex/lib/marketing.ts: a name in Meta, and either approved or linked by
 * hand (no status tracked).
 */
const canSend = (t) => Boolean(t.metaTemplateName) && (!t.metaStatus || t.metaStatus === "APPROVED");

const templateBrief = (t) => ({
  id: t._id,
  name: t.name,
  occasion: t.occasion,
  category: t.category ?? "marketing",
  languageCode: t.languageCode,
  body: t.body,
  // What Meta reviews: the same text with {{1}}, {{2}}… in order.
  metaBody: t.metaBody,
  metaTemplateName: t.metaTemplateName ?? null,
  metaStatus: t.metaStatus ?? (t.metaTemplateName ? "LINKED" : "NOT_APPLIED"),
  rejectedReason: t.metaRejectedReason ?? null,
  canSend: canSend(t),
});

const eventBrief = (e) => ({
  id: e._id,
  title: e.title,
  date: e.date,
  startTime: e.startTime ?? null,
  venue: e.venue ?? null,
  details: e.details,
  offer: e.offer ?? null,
  link: e.link ?? null,
  template: e.templateName,
  sendHour: e.sendHour,
  reminders: e.touches.map((touch) => ({
    // A calendar entry id: send_calendar_entry_now and delete_calendar_entry
    // take it.
    entryId: touch._id,
    reminder: reminderName(touch.offsetDays ?? 0),
    sendsOn: touch.date,
    sendHour: touch.sendHour,
    status: touch.status,
    message: touch.message ?? null,
    sent: touch.sentCount,
    failed: touch.failedCount,
    lastError: touch.lastError ?? null,
  })),
});

/** "YYYY-MM-DD" in a timezone. */
function localDate(instant, timeZone) {
  const format = (zone) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- CSV export

// Mirrors lib/contact-csv.ts, which a .mjs file cannot import: the same
// columns and the same cell formats, so a file exported here imports back
// through the dashboard.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const csvCell = (value) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const phoneCell = (digits) =>
  /^91\d{10}$/.test(digits) ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : `+${digits}`;
const birthdayCell = (monthDay) =>
  monthDay ? `${Number(monthDay.slice(3))} ${MONTHS[Number(monthDay.slice(0, 2)) - 1]}` : "";

function contactsCsv(rows) {
  const lines = [
    ["name", "phone", "birthday", "email", "company"],
    ...rows.map((row) => [
      row.name ?? "",
      phoneCell(String(row.phone).replace(/\D/g, "")),
      birthdayCell(row.birthday),
      row.email ?? "",
      row.company ?? "",
    ]),
  ];
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  // ---------------------------------------------------------------- overview

  server.registerTool(
    "get_marketing_overview",
    {
      title: "Marketing overview",
      description:
        "The marketing desk at a glance: whether it exists, the WhatsApp number it sends from, how many WhatsApp contacts it reaches, the birthday-wish settings, and how many templates can send.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const overview = await call.query(api.marketing.overview, { workspaceId: found._id });
      if (!overview) return ok("No such workspace.");
      return ok({
        timezone: overview.timezone,
        desk: overview.desk,
        sendsFrom: overview.channel,
        audience: overview.audience,
        birthdayWishes: overview.settings,
        templates: {
          total: overview.templates.length,
          canSend: overview.templates.filter(canSend).length,
          inReview: overview.templates.filter((t) => t.metaStatus === "PENDING").length,
        },
      });
    })
  );

  // --------------------------------------------------------------- templates

  server.registerTool(
    "list_marketing_templates",
    {
      title: "List marketing templates",
      description:
        "Every marketing template, with where Meta's review of it stands. Only canSend: true templates deliver; NOT_APPLIED ones need apply_marketing_template, PENDING ones are waiting on Meta, REJECTED ones carry the reason, CHANGED ones were edited after approval and need applying again.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const overview = await call.query(api.marketing.overview, { workspaceId: found._id });
      return ok((overview?.templates ?? []).map(templateBrief));
    })
  );

  server.registerTool(
    "draft_marketing_template",
    {
      title: "Draft a marketing template",
      description:
        "Have the marketing desk write a template in the company's voice. Returns name and body without saving — pass them to save_marketing_template. Costs tokens against the workspace.",
      inputSchema: {
        ...workspaceArg,
        occasion: occasionArg,
        eventTitle: z.string().optional().describe("The festival or event, e.g. 'Diwali'"),
        notes: z
          .string()
          .optional()
          .describe("Anything to say: an offer, a language, a tone. Offers are only ever repeated as given."),
      },
    },
    handler(async ({ workspace, occasion, eventTitle, notes }) => {
      const found = await resolveWorkspace(workspace);
      return ok(
        await call.action(api.marketingAi.draft, {
          workspaceId: found._id,
          occasion,
          eventTitle,
          notes,
        })
      );
    })
  );

  server.registerTool(
    "save_marketing_template",
    {
      title: "Save a marketing template",
      description:
        "Create a template, or change one when `template` names it (omitted fields keep their value). Variables are written {{name}}, {{business}}, {{event}}, and for an event's reminders {{date}}, {{venue}} and {{message}}. Saving does not submit it: apply_marketing_template does. Editing the text of an approved template stops it sending until the change is applied.",
      inputSchema: {
        ...workspaceArg,
        template: z.string().optional().describe("Name or id of the template to change; omit to create"),
        name: z.string().optional(),
        occasion: occasionArg.optional(),
        body: z
          .string()
          .optional()
          .describe(
            "Under 1,024 characters. Meta rejects a body that starts or ends with a variable, or puts two side by side."
          ),
        category: z
          .enum(["marketing", "utility", "authentication"])
          .optional()
          .describe("What Meta approves it as, and so what every send is billed at. Default marketing."),
        languageCode: z.string().optional().describe("Meta's code: 'en', 'hi', 'en_US'. Default 'en'."),
        metaTemplateName: z
          .string()
          .optional()
          .describe(
            "Only to link a template already approved elsewhere. apply_marketing_template sets it otherwise."
          ),
      },
    },
    handler(async ({ workspace, template, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const existing = template ? await findMarketingTemplate(found._id, template) : null;
      const name = fields.name ?? existing?.name;
      const body = fields.body ?? existing?.body;
      const occasion = fields.occasion ?? existing?.occasion;
      if (!name || !body || !occasion) {
        throw new Error("A new template needs a name, an occasion and a body.");
      }
      const templateId = await call.mutation(api.marketing.saveTemplate, {
        workspaceId: found._id,
        templateId: existing?._id,
        name,
        occasion,
        body,
        category: fields.category ?? existing?.category,
        languageCode: fields.languageCode ?? existing?.languageCode,
        metaTemplateName: fields.metaTemplateName ?? existing?.metaTemplateName,
      });
      return ok({
        templateId,
        name,
        next: "apply_marketing_template to send it to Meta for review.",
      });
    })
  );

  server.registerTool(
    "apply_marketing_template",
    {
      title: "Apply a template to Meta",
      description:
        "Submit a saved template to Meta for review, through the panel the workspace's WhatsApp number is connected through — with a realistic sample for every variable, which Meta requires. A template approved before and edited since is applied as an edit of the same Meta template. It sends only once Meta approves it: poll check_marketing_template_status. A real submission to Meta.",
      inputSchema: {
        ...workspaceArg,
        template: z.string().describe("Template name or id"),
      },
      annotations: { openWorldHint: true },
    },
    handler(async ({ workspace, template }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findMarketingTemplate(found._id, template);
      const result = await call.action(api.marketingTemplates.apply, {
        templateId: target._id,
      });
      return ok({ template: target.name, metaTemplateName: result.name, status: result.status });
    })
  );

  server.registerTool(
    "check_marketing_template_status",
    {
      title: "Check templates with Meta",
      description:
        "Read Meta's current decision on every applied template from the panel, and record it. The platform also does this every half hour on its own.",
      inputSchema: { ...workspaceArg },
      annotations: { openWorldHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const { changed } = await call.action(api.marketingTemplates.checkStatus, {
        workspaceId: found._id,
      });
      const overview = await call.query(api.marketing.overview, { workspaceId: found._id });
      return ok({
        changed,
        templates: (overview?.templates ?? []).map((t) => {
          const brief = templateBrief(t);
          return {
            name: brief.name,
            metaStatus: brief.metaStatus,
            rejectedReason: brief.rejectedReason,
            canSend: brief.canSend,
          };
        }),
      });
    })
  );

  server.registerTool(
    "delete_marketing_template",
    {
      title: "Delete a marketing template",
      description:
        "Delete a template here. Anything scheduled on it goes back to draft, and birthday wishes on it switch off. It is not deleted from Meta.",
      inputSchema: {
        ...workspaceArg,
        template: z.string().describe("Template name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, template }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findMarketingTemplate(found._id, template);
      await call.mutation(api.marketing.removeTemplate, { templateId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );

  // ------------------------------------------------------------------ events

  server.registerTool(
    "list_marketing_events",
    {
      title: "List marketing events",
      description:
        "The business's own events — launches, workshops, sales — each with its reminders: when each sends, its status, and the line the desk wrote for it (message). Each reminder's entryId works with send_calendar_entry_now and delete_calendar_entry.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const events = await call.query(api.marketingCampaigns.list, { workspaceId: found._id });
      return ok(events.map(eventBrief));
    })
  );

  server.registerTool(
    "save_marketing_event",
    {
      title: "Save a marketing event",
      description:
        "Create an event, or change one when `event` names it (omitted fields keep their value; an empty string clears an optional one). Saving lays its reminders on the calendar at sendHour in the workspace's timezone, skipping any whose moment has passed, and the marketing desk writes each reminder's own line from the details straight away — read them with list_marketing_events. Reminders are scheduled only with a template that can send; without one they are drafts. Every reminder goes to every WhatsApp contact.",
      inputSchema: {
        ...workspaceArg,
        event: z.string().optional().describe("Title or id of the event to change; omit to create"),
        title: z.string().optional(),
        date: z.string().optional().describe("YYYY-MM-DD, the workspace's local date"),
        startTime: z.string().optional().describe("HH:MM, 24-hour"),
        venue: z.string().optional(),
        details: z
          .string()
          .optional()
          .describe("What is happening, for whom, what to expect — the desk writes every reminder from this"),
        offer: z.string().optional().describe("Only ever repeated as given"),
        link: z.string().optional(),
        template: z
          .string()
          .optional()
          .describe("Template name or id, or 'none'. Usually the one with occasion 'event'."),
        sendHour: z.number().int().min(0).max(23).optional().describe("Local hour reminders go at. Default 10."),
        reminders: z
          .array(reminderArg)
          .optional()
          .describe(`Which to send. Default ${DEFAULT_REMINDERS.join(", ")}.`),
      },
    },
    handler(async ({ workspace, event, template, reminders, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const existing = event ? await findMarketingEvent(found._id, event) : null;

      let templateId = existing?.templateId;
      if (template !== undefined) {
        templateId =
          template.trim().toLowerCase() === "none"
            ? undefined
            : (await findMarketingTemplate(found._id, template))._id;
      }

      const pick = (key) => (fields[key] !== undefined ? fields[key] : existing?.[key]);
      const title = pick("title");
      const date = pick("date");
      const details = pick("details");
      if (!title || !date || !details) {
        throw new Error("A new event needs a title, a date and details.");
      }

      const offsets = reminders
        ? reminders.map((name) => REMINDERS[name])
        : existing
          ? existing.touches
              .filter((t) => t.status === "draft" || t.status === "scheduled")
              .map((t) => t.offsetDays ?? 0)
          : DEFAULT_REMINDERS.map((name) => REMINDERS[name]);

      const result = await call.mutation(api.marketingCampaigns.save, {
        workspaceId: found._id,
        campaignId: existing?._id,
        title,
        date,
        startTime: pick("startTime") || undefined,
        venue: pick("venue") ?? undefined,
        details,
        offer: pick("offer") ?? undefined,
        link: pick("link") ?? undefined,
        templateId,
        sendHour: pick("sendHour") ?? 10,
        touches: offsets,
      });
      return ok({
        eventId: result.campaignId,
        remindersScheduled: result.scheduled,
        remindersAlreadyPast: result.passed,
        template: templateId ? "set" : "none — the reminders are drafts until one is picked",
        next: "The desk is writing each reminder's line now; list_marketing_events shows them in a minute.",
      });
    })
  );

  server.registerTool(
    "set_event_reminder_message",
    {
      title: "Set a reminder's message",
      description:
        "Replace the line the desk wrote for one of an event's reminders with your own. It goes out as the template's {{message}}: one or two sentences, no greeting or sign-off (the template has those), no line breaks.",
      inputSchema: {
        ...workspaceArg,
        event: z.string().describe("Event title or id"),
        reminder: reminderArg,
        message: z.string().max(400),
      },
    },
    handler(async ({ workspace, event, reminder, message }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findMarketingEvent(found._id, event);
      const touch = target.touches.find((t) => t.offsetDays === REMINDERS[reminder]);
      if (!touch) throw new Error(`${target.title} has no ${reminder} reminder.`);
      await call.mutation(api.marketingCampaigns.updateMessage, {
        eventId: touch._id,
        message,
      });
      return ok(`Saved the ${reminder} message for ${target.title}.`);
    })
  );

  server.registerTool(
    "rewrite_event_reminders",
    {
      title: "Rewrite an event's reminders",
      description:
        "Have the desk write the lines again from the event's details — every reminder still to go, or just one. Replaces any hand-written line. Costs tokens.",
      inputSchema: {
        ...workspaceArg,
        event: z.string().describe("Event title or id"),
        reminder: reminderArg.optional().describe("Omit for all of them"),
      },
    },
    handler(async ({ workspace, event, reminder }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findMarketingEvent(found._id, event);
      const touch = reminder
        ? target.touches.find((t) => t.offsetDays === REMINDERS[reminder])
        : undefined;
      if (reminder && !touch) throw new Error(`${target.title} has no ${reminder} reminder.`);
      const result = await call.action(api.marketingAi.rewriteTouches, {
        campaignId: target._id,
        eventId: touch?._id,
      });
      const fresh = await findMarketingEvent(found._id, target._id);
      return ok({ written: result.written, reminders: eventBrief(fresh).reminders });
    })
  );

  server.registerTool(
    "delete_marketing_event",
    {
      title: "Delete a marketing event",
      description:
        "Delete an event and every reminder still to go. Reminders that already went out stay on the calendar as the record of what was sent.",
      inputSchema: {
        ...workspaceArg,
        event: z.string().describe("Event title or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, event }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findMarketingEvent(found._id, event);
      await call.mutation(api.marketingCampaigns.remove, { campaignId: target._id });
      return ok(`Deleted ${target.title}.`);
    })
  );

  // ---------------------------------------------------------------- calendar

  server.registerTool(
    "list_marketing_calendar",
    {
      title: "List the marketing calendar",
      description:
        "What is on the calendar between two dates (at most 62 days): greetings and event reminders with their status, contacts' birthdays, and preset festivals — marked added when already scheduled. Defaults to the next 30 days.",
      inputSchema: {
        ...workspaceArg,
        from: z.string().optional().describe("YYYY-MM-DD, default today"),
        to: z.string().optional().describe("YYYY-MM-DD, default 30 days on"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, from, to }) => {
      const found = await resolveWorkspace(workspace);
      const start = from ?? localDate(Date.now(), found.timezone);
      const end = to ?? addDays(start, 30);
      const calendar = await call.query(api.marketing.calendar, {
        workspaceId: found._id,
        from: start,
        to: end,
      });
      return ok({
        from: start,
        to: end,
        entries: calendar.events.map((entry) => ({
          entryId: entry._id,
          title: entry.title,
          date: entry.date,
          sendHour: entry.sendHour,
          status: entry.status,
          template: entry.templateName,
          partOfEvent: Boolean(entry.campaignId),
          sent: entry.sentCount,
          failed: entry.failedCount,
          lastError: entry.lastError ?? null,
        })),
        birthdays: calendar.birthdays,
        festivals: calendar.festivals,
      });
    })
  );

  server.registerTool(
    "schedule_greeting",
    {
      title: "Schedule a greeting",
      description:
        "Put a one-off greeting on the calendar — a festival, an offer, an anniversary — sent to every WhatsApp contact at sendHour in the workspace's timezone. With a template that can send it is scheduled; without one it is a draft. Pass `entry` to change one not yet sent. For an event with reminders before and after, use save_marketing_event instead.",
      inputSchema: {
        ...workspaceArg,
        entry: z.string().optional().describe("entryId to change; omit to create"),
        title: z.string().describe("Fills {{event}} in the template"),
        date: z.string().describe("YYYY-MM-DD"),
        sendHour: z.number().int().min(0).max(23).optional().describe("Default 9"),
        template: z.string().optional().describe("Template name or id; omit for a draft"),
        festival: z
          .string()
          .optional()
          .describe("A preset festival's key from list_marketing_calendar, so it is not suggested again"),
      },
    },
    handler(async ({ workspace, entry, title, date, sendHour, template, festival }) => {
      const found = await resolveWorkspace(workspace);
      const templateId = template
        ? (await findMarketingTemplate(found._id, template))._id
        : undefined;
      const entryId = await call.mutation(api.marketing.saveEvent, {
        workspaceId: found._id,
        eventId: entry,
        title,
        date,
        sendHour: sendHour ?? 9,
        templateId,
        presetKey: festival,
      });
      return ok({ entryId, status: templateId ? "scheduled" : "draft" });
    })
  );

  server.registerTool(
    "send_calendar_entry_now",
    {
      title: "Send a calendar entry now",
      description:
        "Send a greeting or an event reminder straight away instead of at its hour — to every WhatsApp contact, as real, billed template messages. Needs a template that can send.",
      inputSchema: {
        ...workspaceArg,
        entryId: z.string().describe("From list_marketing_calendar or list_marketing_events"),
      },
      annotations: { openWorldHint: true },
    },
    handler(async ({ entryId }) => {
      await call.mutation(api.marketing.sendEventNow, { eventId: entryId });
      return ok("Sending now. list_marketing_calendar shows the count as it goes.");
    })
  );

  server.registerTool(
    "delete_calendar_entry",
    {
      title: "Delete a calendar entry",
      description:
        "Take a greeting off the calendar, or skip one of an event's reminders. Not while it is sending.",
      inputSchema: {
        ...workspaceArg,
        entryId: z.string().describe("From list_marketing_calendar or list_marketing_events"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ entryId }) => {
      await call.mutation(api.marketing.removeEvent, { eventId: entryId });
      return ok("Removed from the calendar.");
    })
  );

  server.registerTool(
    "update_birthday_wishes",
    {
      title: "Update birthday wishes",
      description:
        "Switch the standing birthday wish on or off, and set the template and the local hour it goes at. Every WhatsApp contact whose birthday is today gets it once. Omitted fields keep their value.",
      inputSchema: {
        ...workspaceArg,
        enabled: z.boolean().optional(),
        template: z.string().optional().describe("Template name or id — needed to switch on"),
        hour: z.number().int().min(0).max(23).optional(),
      },
    },
    handler(async ({ workspace, enabled, template, hour }) => {
      const found = await resolveWorkspace(workspace);
      const overview = await call.query(api.marketing.overview, { workspaceId: found._id });
      if (!overview) throw new Error("No such workspace.");
      const templateId = template
        ? (await findMarketingTemplate(found._id, template))._id
        : (overview.settings.birthdayTemplateId ?? undefined);
      await call.mutation(api.marketing.saveSettings, {
        workspaceId: found._id,
        birthdayEnabled: enabled ?? overview.settings.birthdayEnabled,
        birthdayTemplateId: templateId,
        birthdayHour: hour ?? overview.settings.birthdayHour,
      });
      return ok(`Birthday wishes are ${enabled ?? overview.settings.birthdayEnabled ? "on" : "off"}.`);
    })
  );

  // ---------------------------------------------------------------- contacts

  server.registerTool(
    "add_marketing_contacts",
    {
      title: "Add marketing contacts",
      description:
        "Add WhatsApp contacts — one, or a whole imported list: to import a CSV, read it and pass its rows here. Stored the way an inbound message would store them, so a reply lands on the same contact and shows in the inbox. Someone already on file is not duplicated; their empty name, birthday, email or company are filled in. Numbers that are not valid WhatsApp numbers come back in `invalid`.",
      inputSchema: {
        ...workspaceArg,
        contacts: z
          .array(
            z.object({
              phone: z.string(),
              name: z.string().optional(),
              birthday: z.string().optional().describe("Any readable day, day first: '25/12', '25 Dec'"),
              email: z.string().optional(),
              company: z.string().optional(),
            })
          )
          .min(1)
          .max(10_000),
        countryCode: z
          .string()
          .optional()
          .describe("Put in front of numbers written without one. Default 91 (India)."),
        consent: z
          .literal(true)
          .describe(
            "Confirms these people agreed to get WhatsApp messages from the business. Messaging people who did not gets the number reported and restricted."
          ),
      },
    },
    handler(async ({ workspace, contacts, countryCode }) => {
      const found = await resolveWorkspace(workspace);
      const total = { added: 0, updated: 0, invalid: [] };
      for (let start = 0; start < contacts.length; start += ADD_BATCH) {
        const batch = await call.mutation(api.contacts.addMany, {
          workspaceId: found._id,
          countryCode: countryCode ?? "91",
          contacts: contacts.slice(start, start + ADD_BATCH),
        });
        total.added += batch.added;
        total.updated += batch.updated;
        total.invalid.push(...batch.invalid);
      }
      return ok(total);
    })
  );

  server.registerTool(
    "export_contacts",
    {
      title: "Export contacts",
      description:
        "Every WhatsApp contact, as the same CSV the dashboard imports (name, phone, birthday, email, company) or as JSON rows.",
      inputSchema: {
        ...workspaceArg,
        format: z.enum(["csv", "json"]).optional().describe("Default csv"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, format }) => {
      const found = await resolveWorkspace(workspace);
      const rows = [];
      let cursor = null;
      for (;;) {
        const page = await call.query(api.contacts.exportPage, {
          workspaceId: found._id,
          paginationOpts: { numItems: 500, cursor },
        });
        rows.push(...page.page);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      if (format === "json") return ok({ count: rows.length, contacts: rows });
      return ok(contactsCsv(rows));
    })
  );
}
