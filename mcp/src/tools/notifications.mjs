/**
 * Notifications — alerts sent on WhatsApp and email when something happens.
 *
 * An *alert* listens for one event — a record filed, updated or moving stage,
 * an order, an escalation, or another system posting to the alert's own URL —
 * and sends one template to a list of recipients. WhatsApp alerts send an
 * approved template synced from the panel (nothing else reaches someone
 * outside the 24-hour window); email alerts send a template written here,
 * from the platform's address under the workspace's name.
 *
 * The one idea worth holding on to: a template's blanks and an alert's
 * recipients are text with `{{path}}` placeholders over the event's payload —
 * the same JSON the workspace webhook receives. `{{record.person.name}}` is
 * the person on a filed record, `{{customer.phone}}` the customer on an order,
 * and `{{a | b}}` falls back from one to the other.
 */

import { z } from "zod";
import { kvArg, workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findChannel, findRecordBook, pickByName } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

// convex/lib/notifications.ts NOTIFICATION_EVENTS is the source of truth.
// Not order_created: orders are the Orders record book's records, so an order
// alert is record_filed on that book.
const EVENTS = [
  "record_filed",
  "record_updated",
  "record_stage_changed",
  "escalation",
  "inbound",
];

const RECORD_EVENTS = new Set(["record_filed", "record_updated", "record_stage_changed"]);

const iso = (instant) => (instant ? new Date(instant).toISOString() : null);

const alertArg = z.string().describe("Alert name or id");

const eventArg = z
  .enum(EVENTS)
  .describe(
    "record_filed / record_updated / record_stage_changed: a record book event — an order taken is record_filed on the Orders book. escalation: an agent handed a conversation to a person. inbound: another system POSTs to the alert's own URL."
  );

const paramsArg = z
  .array(kvArg)
  .describe(
    "One per template blank: key is the slot from list_whatsapp_templates ('body:1', 'header:1', 'header:media', 'button:0' — a bare '1' means 'body:1'), value is text and/or {{path}} placeholders."
  );

const recipientsArg = z
  .array(z.string())
  .describe(
    "Who it goes to. Each entry is a number with country code, an email, a {{path}} placeholder, or 'customer' for the event's own customer. WhatsApp alerts take numbers, email alerts take addresses."
  );

// ------------------------------------------------------------------ lookups

async function findAlert(workspaceId, wanted) {
  const rules = await call.query(api.notifications.listRules, { workspaceId });
  if (rules.some((rule) => rule._id === wanted)) {
    return rules.find((rule) => rule._id === wanted);
  }
  return pickByName(rules, wanted, "alert", ["name"]);
}

async function findEmailTemplate(workspaceId, wanted) {
  const rows = await call.query(api.notifications.listEmailTemplates, { workspaceId });
  if (rows.some((row) => row._id === wanted)) {
    return rows.find((row) => row._id === wanted);
  }
  return pickByName(rows, wanted, "email template", ["name", "subject"]);
}

/** A synced template by name, and by language when it exists in several. */
async function findWhatsAppTemplate(workspaceId, name, language) {
  const rows = await call.query(api.notifications.listWhatsAppTemplates, { workspaceId });
  if (rows.length === 0) {
    throw new Error(
      "No WhatsApp templates synced for the sending number. Run sync_whatsapp_templates first."
    );
  }
  const wanted = name.trim().toLowerCase();
  const named = rows.filter((row) => row.name.toLowerCase() === wanted);
  if (named.length === 0) {
    const close = rows
      .filter((row) => row.name.toLowerCase().includes(wanted))
      .map((row) => `${row.name} (${row.language})`);
    throw new Error(
      `No synced template called "${name}".${close.length ? ` Did you mean: ${close.join(", ")}?` : " Use list_whatsapp_templates to see them."}`
    );
  }
  const matches = language
    ? named.filter((row) => row.language.toLowerCase() === language.trim().toLowerCase())
    : named;
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(
      `"${name}" is not synced in ${language}. It exists in: ${named.map((row) => row.language).join(", ")}.`
    );
  }
  throw new Error(
    `"${name}" exists in ${matches.map((row) => row.language).join(", ")}. Pass whatsappLanguage.`
  );
}

/** Params as the slots the template actually has, refusing ones it does not. */
function slotParams(template, params) {
  const known = new Set(template.slots.map((slot) => slot.key));
  const out = [];
  for (const pair of params ?? []) {
    const key = pair.key.includes(":") ? pair.key : `body:${pair.key}`;
    if (!known.has(key)) {
      throw new Error(
        `"${template.name}" has no blank "${pair.key}". Its blanks: ${
          template.slots.map((slot) => slot.key).join(", ") || "none"
        }.`
      );
    }
    out.push({ key, value: pair.value });
  }
  return out;
}

/** 'customer' becomes the event's own customer placeholder for the channel. */
function expandRecipients(entries, eventInfo, channel) {
  return entries.map((entry) => {
    if (entry.trim().toLowerCase() !== "customer") return entry.trim();
    const placeholder =
      channel === "whatsapp" ? eventInfo?.customerPhone : eventInfo?.customerEmail;
    if (!placeholder) {
      throw new Error(
        `A ${eventInfo?.label ?? "this"} event has no customer ${channel === "whatsapp" ? "number" : "address"} of its own. Map one from the payload with a {{path}}.`
      );
    }
    return placeholder;
  });
}

const alertBrief = (rule) => ({
  id: rule._id,
  name: rule.name,
  enabled: rule.enabled,
  event: rule.event,
  // Null with bookId set means the book was deleted under the alert.
  book: rule.bookId ? (rule.bookName ?? "(deleted book)") : "any",
  stage: rule.stage,
  channel: rule.channel,
  whatsappTemplate: rule.whatsappTemplateName
    ? { name: rule.whatsappTemplateName, language: rule.whatsappLanguage }
    : null,
  emailTemplate: rule.emailTemplateName,
  params: rule.params,
  recipients: rule.recipients,
  inboundUrl: rule.inboundUrl,
  lastInboundAt: iso(rule.lastInboundAt),
  sampleFields: rule.samplePaths,
  sampleCapturedAt: iso(rule.sampleAt),
  // Waiting for the next call to replace the sample.
  capturingSample: rule.event === "inbound" ? rule.capturing : undefined,
  sent: rule.sentCount,
  notSent: rule.failedCount,
  lastFiredAt: iso(rule.lastFiredAt),
  lastError: rule.lastError,
});

/**
 * Everything saveRule takes, from an existing alert and a set of changes — the
 * mutation replaces the whole alert, so an update has to send what it keeps.
 */
async function buildRule(workspaceId, overview, current, changes) {
  const event = changes.event ?? current?.event ?? "record_filed";
  const channel = changes.channel ?? current?.channel ?? "whatsapp";
  const info = overview.events.find((item) => item.value === event);
  const isRecord = RECORD_EVENTS.has(event);

  let bookId = isRecord ? (current?.bookId ?? undefined) : undefined;
  if (changes.book !== undefined) {
    bookId =
      !changes.book || changes.book.toLowerCase() === "any"
        ? undefined
        : (await findRecordBook(workspaceId, changes.book))._id;
  }
  // A stage belongs to its book, so moving books drops it unless one is given.
  let stage =
    isRecord && bookId && changes.book === undefined ? (current?.stage ?? undefined) : undefined;
  if (changes.stage !== undefined) {
    stage = !changes.stage || changes.stage.toLowerCase() === "any" ? undefined : changes.stage;
  }
  if (!bookId) stage = undefined;

  const channelChanged = current && channel !== current.channel;

  let whatsappTemplateName;
  let whatsappLanguage;
  let params = [];
  let emailTemplateId;
  if (channel === "whatsapp") {
    const keepTemplate =
      !changes.whatsappTemplate &&
      !changes.whatsappLanguage &&
      !channelChanged &&
      current?.whatsappTemplateName;
    if (keepTemplate && !changes.params) {
      // Untouched: kept as it is, without re-checking it against the panel,
      // so renaming or pausing an alert whose template has since been paused
      // is still possible.
      whatsappTemplateName = current.whatsappTemplateName;
      whatsappLanguage = current.whatsappLanguage;
      params = current.params;
    } else {
      const name = changes.whatsappTemplate ?? (channelChanged ? undefined : current?.whatsappTemplateName);
      if (!name) throw new Error("A WhatsApp alert needs whatsappTemplate.");
      const language =
        changes.whatsappLanguage ??
        (changes.whatsappTemplate ? undefined : (current?.whatsappLanguage ?? undefined));
      const template = await findWhatsAppTemplate(workspaceId, name, language);
      if (!template.sendable) {
        throw new Error(
          template.unsupported ??
            `"${template.name}" is ${template.status.toLowerCase()} — only approved templates send.`
        );
      }
      whatsappTemplateName = template.name;
      whatsappLanguage = template.language;
      // Kept params survive only while the template is the same one.
      const sameTemplate =
        current?.whatsappTemplateName === template.name &&
        current?.whatsappLanguage === template.language;
      params = changes.params
        ? slotParams(template, changes.params)
        : sameTemplate
          ? current.params
          : [];
    }
  } else {
    if (changes.emailTemplate) {
      emailTemplateId = (await findEmailTemplate(workspaceId, changes.emailTemplate))._id;
    } else if (!channelChanged && current?.emailTemplateId) {
      emailTemplateId = current.emailTemplateId;
    } else {
      throw new Error("An email alert needs emailTemplate.");
    }
  }

  const recipients = changes.recipients
    ? expandRecipients(changes.recipients, info, channel)
    : channelChanged
      ? []
      : (current?.recipients ?? []);
  if (recipients.length === 0) {
    throw new Error(
      channelChanged
        ? "Switching channel clears the recipients — pass recipients for the new channel."
        : "Pass recipients: numbers, emails, {{path}} placeholders or 'customer'."
    );
  }

  return {
    workspaceId,
    ruleId: current?._id,
    name: changes.name ?? current?.name ?? "",
    enabled: changes.enabled ?? current?.enabled ?? true,
    event,
    bookId,
    stage,
    channel,
    whatsappTemplateName,
    whatsappLanguage,
    emailTemplateId,
    params,
    recipients,
  };
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  // ------------------------------------------------------------- senders

  server.registerTool(
    "get_notification_settings",
    {
      title: "Get notification settings",
      description:
        "Where alerts go out from — the WhatsApp number and the email sender — whether each is ready, and the catalogue an alert is written against: every event, the {{path}} variables each one offers, the record book fields ({{record.details.<key>}}), and teammates with a phone or email.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const overview = await call.query(api.notifications.overview, {
        workspaceId: found._id,
      });
      return ok({
        whatsapp: overview.sender
          ? {
              ready: true,
              channel: overview.sender.name,
              phone: overview.sender.phone,
              hasWabaId: overview.sender.hasWaba,
              templatesSyncedAt: iso(overview.settings.templatesSyncedAt),
              lastSyncError: overview.settings.templatesSyncError,
            }
          : { ready: false, reason: "No live WhatsApp channel." },
        email: {
          ready: overview.emailReady,
          sendsAs: `${overview.emailSender.name} <${overview.emailSender.address}>`,
          fromName: overview.settings.fromName,
          replyTo: overview.settings.replyTo,
        },
        defaultCountryCode: overview.settings.defaultCountryCode,
        events: overview.events.map((item) => ({
          event: item.value,
          label: item.label,
          when: item.hint,
          variables: item.variables.map((variable) => `{{${variable.path}}} — ${variable.label}`),
          customerPhone: item.customerPhone ?? null,
          customerEmail: item.customerEmail ?? null,
        })),
        recordBooks: overview.books.map((book) => ({
          name: book.pluralName,
          stages: book.stages,
          fields: book.variables.map((variable) => `{{${variable.path}}} — ${variable.label}`),
        })),
        teammates: overview.team,
        whatsappChannels: overview.channels,
      });
    })
  );

  server.registerTool(
    "update_notification_settings",
    {
      title: "Update notification settings",
      description:
        "Set where alerts go out from. WhatsApp: which channel sends (its business account is what templates sync from) and the country code put in front of numbers typed without one. Email: the sender name (shown as '<name> via Magic Agent'; empty uses the workspace name) and the Reply-to address. Omitted fields are left alone; an empty string clears one.",
      inputSchema: {
        ...workspaceArg,
        whatsappChannel: z
          .string()
          .optional()
          .describe("Channel name or id to send from. 'default' goes back to the first live one."),
        defaultCountryCode: z.string().optional().describe("Digits only: '91' for India"),
        fromName: z.string().optional().describe("Sender name shown before 'via Magic Agent'"),
        replyTo: z.string().optional().describe("Where replies to alert emails go"),
      },
    },
    handler(async ({ workspace, whatsappChannel, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      let whatsappChannelId;
      if (whatsappChannel !== undefined) {
        whatsappChannelId =
          !whatsappChannel || whatsappChannel.toLowerCase() === "default"
            ? null
            : (await findChannel(found._id, whatsappChannel))._id;
      }
      await call.mutation(api.notifications.saveSettings, {
        workspaceId: found._id,
        ...(whatsappChannelId !== undefined ? { whatsappChannelId } : {}),
        ...fields,
      });
      return ok(
        "Saved. Check it with send_test_email for email, and sync_whatsapp_templates for WhatsApp."
      );
    })
  );

  server.registerTool(
    "send_test_email",
    {
      title: "Send a test email",
      description:
        "One plain email with the saved sender name and Reply-to, to prove email alerts arrive. Reports why it did not send, if it did not.",
      inputSchema: {
        ...workspaceArg,
        to: z.string().describe("Email address to send it to"),
      },
    },
    handler(async ({ workspace, to }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.notificationsSend.sendTestEmail, {
        workspaceId: found._id,
        to,
      });
      return ok(result.ok ? `Sent to ${to}.` : `Not sent: ${result.error ?? "no reason given"}`);
    })
  );

  // ------------------------------------------------------------ templates

  server.registerTool(
    "sync_whatsapp_templates",
    {
      title: "Sync WhatsApp templates",
      description:
        "Pull every template from the sending number's WhatsApp business account — approved, pending and rejected. Templates are created and approved in WhatsApp Manager; this only reads them. Needs the channel's WABA ID (set it with update_channel if the sync says it is missing).",
      inputSchema: { ...workspaceArg },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.notificationsSend.syncWhatsAppTemplates, {
        workspaceId: found._id,
      });
      return ok(`Synced ${result.count} template(s), ${result.approved} approved.`);
    })
  );

  server.registerTool(
    "list_whatsapp_templates",
    {
      title: "List WhatsApp templates",
      description:
        "The synced templates of the sending number, with their text and every blank a send has to fill — the slot keys an alert's params use. Only 'sendable' ones (approved, and of a shape an alert can fill) can be used.",
      inputSchema: {
        ...workspaceArg,
        status: z
          .enum(["approved", "all"])
          .optional()
          .describe("Default 'approved'"),
        search: z.string().optional().describe("Matches the name or the body"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, status, search }) => {
      const found = await resolveWorkspace(workspace);
      const rows = await call.query(api.notifications.listWhatsAppTemplates, {
        workspaceId: found._id,
      });
      const term = search?.trim().toLowerCase();
      return ok(
        rows
          .filter((row) => (status ?? "approved") === "all" || row.status === "APPROVED")
          .filter(
            (row) =>
              !term ||
              row.name.toLowerCase().includes(term) ||
              (row.body ?? "").toLowerCase().includes(term)
          )
          .map((row) => ({
            name: row.name,
            language: row.language,
            category: row.category,
            status: row.status,
            sendable: row.sendable,
            unsupported: row.unsupported,
            header: row.header,
            body: row.body,
            footer: row.footer,
            buttons: row.buttons.map((button) => button.text),
            slots: row.slots,
          }))
      );
    })
  );

  server.registerTool(
    "list_email_templates",
    {
      title: "List email templates",
      description: "The emails this workspace has written for its alerts, with the {{variables}} each uses.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const rows = await call.query(api.notifications.listEmailTemplates, {
        workspaceId: found._id,
      });
      return ok(
        rows.map((row) => ({
          id: row._id,
          name: row.name,
          subject: row.subject,
          format: row.format,
          body: row.body,
          variables: row.variables,
          updatedAt: iso(row.updatedAt),
        }))
      );
    })
  );

  server.registerTool(
    "create_email_template",
    {
      title: "Create email template",
      description:
        "Write an email an alert can send. Subject and body take {{path}} variables from the event — {{record.person.name}}, {{record.reference}}, {{record.details.items}}, {{workspace.name}}; see get_notification_settings for each event's list. In 'html' the body is sent as written and inserted values are escaped; in 'text' line breaks are kept.",
      inputSchema: {
        ...workspaceArg,
        name: z.string(),
        subject: z.string(),
        body: z.string(),
        format: z.enum(["text", "html"]).optional().describe("Default 'text'"),
      },
    },
    handler(async ({ workspace, format, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const created = await call.mutation(api.notifications.saveEmailTemplate, {
        workspaceId: found._id,
        format: format ?? "text",
        ...fields,
      });
      return ok({ emailTemplateId: created.templateId });
    })
  );

  server.registerTool(
    "update_email_template",
    {
      title: "Update email template",
      description: "Change an email's name, subject, body or format. Omitted fields keep their current value.",
      inputSchema: {
        ...workspaceArg,
        template: z.string().describe("Email template name or id"),
        name: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        format: z.enum(["text", "html"]).optional(),
      },
    },
    handler(async ({ workspace, template, ...changes }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findEmailTemplate(found._id, template);
      await call.mutation(api.notifications.saveEmailTemplate, {
        workspaceId: found._id,
        templateId: current._id,
        name: changes.name ?? current.name,
        subject: changes.subject ?? current.subject,
        body: changes.body ?? current.body,
        format: changes.format ?? current.format,
      });
      return ok(`Updated ${changes.name ?? current.name}.`);
    })
  );

  server.registerTool(
    "delete_email_template",
    {
      title: "Delete email template",
      description:
        "Delete an email template. Refused while an alert still sends it — point the alert elsewhere first.",
      inputSchema: {
        ...workspaceArg,
        template: z.string().describe("Email template name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, template }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findEmailTemplate(found._id, template);
      await call.mutation(api.notifications.removeEmailTemplate, { templateId: current._id });
      return ok(`Deleted ${current.name}.`);
    })
  );

  // -------------------------------------------------------------- alerts

  server.registerTool(
    "list_notification_alerts",
    {
      title: "List alerts",
      description:
        "Every alert: what it listens for, what it sends to whom, how many went out, and why the last one failed if it did. Incoming-webhook alerts carry their URL and the fields of the sample body it captured — the first call, until capture_alert_sample asks for a new one.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const rules = await call.query(api.notifications.listRules, { workspaceId: found._id });
      return ok(rules.map(alertBrief));
    })
  );

  server.registerTool(
    "create_notification_alert",
    {
      title: "Create alert",
      description:
        "Send a WhatsApp template or an email whenever an event happens. For WhatsApp: sync templates first, then pass whatsappTemplate and one param per blank (slot keys from list_whatsapp_templates), each filled with text and/or {{path}} variables. For email: pass emailTemplate. Record events can be narrowed to one book and one stage. An 'inbound' alert gets its own URL, returned here, for another system to POST to. Test it with test_notification_alert.",
      inputSchema: {
        ...workspaceArg,
        name: z.string(),
        event: eventArg,
        book: z
          .string()
          .optional()
          .describe("Record events only: record book name, handle or id. Omit for every book."),
        stage: z
          .string()
          .optional()
          .describe("Record events only, with a book: fire only at this stage (the stage moved to, for stage_changed)"),
        channel: z.enum(["whatsapp", "email"]),
        whatsappTemplate: z.string().optional().describe("Synced template name"),
        whatsappLanguage: z
          .string()
          .optional()
          .describe("Only when the template is synced in more than one language"),
        params: paramsArg.optional(),
        emailTemplate: z.string().optional().describe("Email template name or id"),
        recipients: recipientsArg,
        enabled: z.boolean().optional().describe("Default true"),
      },
    },
    handler(async ({ workspace, ...changes }) => {
      const found = await resolveWorkspace(workspace);
      const overview = await call.query(api.notifications.overview, { workspaceId: found._id });
      const args = await buildRule(found._id, overview, null, changes);
      const { ruleId } = await call.mutation(api.notifications.saveRule, args);
      const saved = (await call.query(api.notifications.listRules, { workspaceId: found._id })).find(
        (rule) => rule._id === ruleId
      );
      return ok({
        alertId: ruleId,
        ...(saved?.inboundUrl
          ? {
              inboundUrl: saved.inboundUrl,
              next: "Give this URL to the other system. Post a sample to it, then list_notification_alerts shows its fields to map with update_notification_alert.",
            }
          : { next: "Use test_notification_alert to send it once with made-up details." }),
      });
    })
  );

  server.registerTool(
    "update_notification_alert",
    {
      title: "Update alert",
      description:
        "Change an alert. Omitted fields keep their value. Changing the template drops the old params unless new ones are passed; switching channel needs new recipients. book/stage 'any' clears the filter.",
      inputSchema: {
        ...workspaceArg,
        alert: alertArg,
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        event: eventArg.optional(),
        book: z.string().optional(),
        stage: z.string().optional(),
        channel: z.enum(["whatsapp", "email"]).optional(),
        whatsappTemplate: z.string().optional(),
        whatsappLanguage: z.string().optional(),
        params: paramsArg.optional().describe("Replaces the whole list"),
        emailTemplate: z.string().optional(),
        recipients: recipientsArg.optional().describe("Replaces the whole list"),
      },
    },
    handler(async ({ workspace, alert, ...changes }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findAlert(found._id, alert);
      const overview = await call.query(api.notifications.overview, { workspaceId: found._id });
      const args = await buildRule(found._id, overview, current, changes);
      await call.mutation(api.notifications.saveRule, args);
      return ok(`Updated ${args.name}.`);
    })
  );

  server.registerTool(
    "delete_notification_alert",
    {
      title: "Delete alert",
      description:
        "Stop an alert for good. Its send log is kept. To pause one instead, update_notification_alert with enabled: false.",
      inputSchema: { ...workspaceArg, alert: alertArg },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, alert }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findAlert(found._id, alert);
      await call.mutation(api.notifications.removeRule, { ruleId: current._id });
      return ok(`Deleted ${current.name}.`);
    })
  );

  server.registerTool(
    "rotate_alert_url",
    {
      title: "Give an alert a new URL",
      description:
        "Issue a new URL for an incoming-webhook alert. The old one stops working at once, so the other system has to be updated.",
      inputSchema: { ...workspaceArg, alert: alertArg },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, alert }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findAlert(found._id, alert);
      const result = await call.mutation(api.notifications.rotateInboundKey, {
        ruleId: current._id,
      });
      return ok({ inboundUrl: result.inboundUrl });
    })
  );

  server.registerTool(
    "capture_alert_sample",
    {
      title: "Capture a new sample",
      description:
        "An incoming-webhook alert maps its fields from the first body its URL received, and keeps it. This makes the next call replace it, so fields the other system has started sending can be mapped; list_notification_alerts shows them once it arrives. cancel: true stops waiting.",
      inputSchema: {
        ...workspaceArg,
        alert: alertArg,
        cancel: z.boolean().optional().describe("Stop waiting for a new sample"),
      },
    },
    handler(async ({ workspace, alert, cancel }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findAlert(found._id, alert);
      await call.mutation(api.notifications.captureInboundSample, {
        ruleId: current._id,
        capture: !cancel,
      });
      return ok(
        cancel
          ? `${current.name} keeps the sample it has.`
          : `${current.name} will take the next call to its URL as its new sample.`
      );
    })
  );

  server.registerTool(
    "test_notification_alert",
    {
      title: "Test an alert",
      description:
        "Send a saved alert once, with made-up details built from the record book's own fields (or the sample an incoming webhook captured), to one number or address instead of its recipients. Reports what the provider answered. A WhatsApp test is a real, billed message.",
      inputSchema: {
        ...workspaceArg,
        alert: alertArg,
        to: z.string().describe("A number with country code, or an email, matching the alert's channel"),
      },
    },
    handler(async ({ workspace, alert, to }) => {
      const found = await resolveWorkspace(workspace);
      const current = await findAlert(found._id, alert);
      const result = await call.action(api.notificationsSend.testRule, {
        ruleId: current._id,
        to,
      });
      return ok(
        result.ok
          ? { sent: true, to, preview: result.preview ?? null }
          : { sent: false, reason: result.error ?? "no reason given" }
      );
    })
  );

  server.registerTool(
    "send_notification",
    {
      title: "Send a template now",
      description:
        "Send one saved template to one person, now, outside any alert. WhatsApp: whatsappTemplate plus a literal value per blank in params. Email: emailTemplate plus values for its {{variables}} (key is the variable's path, e.g. 'record.person.name'). WhatsApp sends are billed.",
      inputSchema: {
        ...workspaceArg,
        channel: z.enum(["whatsapp", "email"]),
        to: z.string(),
        whatsappTemplate: z.string().optional(),
        whatsappLanguage: z.string().optional(),
        params: paramsArg.optional(),
        emailTemplate: z.string().optional(),
        values: z
          .array(kvArg)
          .optional()
          .describe("Email only: variable path to value"),
      },
    },
    handler(async ({ workspace, channel, to, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      let args;
      if (channel === "whatsapp") {
        if (!fields.whatsappTemplate) throw new Error("Pass whatsappTemplate.");
        const template = await findWhatsAppTemplate(
          found._id,
          fields.whatsappTemplate,
          fields.whatsappLanguage
        );
        args = {
          whatsappTemplateName: template.name,
          whatsappLanguage: template.language,
          params: slotParams(template, fields.params),
        };
      } else {
        if (!fields.emailTemplate) throw new Error("Pass emailTemplate.");
        const template = await findEmailTemplate(found._id, fields.emailTemplate);
        args = { emailTemplateId: template._id, values: fields.values ?? [] };
      }
      const result = await call.action(api.notificationsSend.sendMessage, {
        workspaceId: found._id,
        channel,
        to,
        ...args,
      });
      return ok(
        result.ok
          ? { sent: true, to, preview: result.preview ?? null }
          : { sent: false, reason: result.error ?? "no reason given" }
      );
    })
  );

  // ------------------------------------------------------------ activity

  server.registerTool(
    "list_notification_activity",
    {
      title: "List notification activity",
      description:
        "What alerts actually sent, newest first — including sends that were skipped or failed, with the reason: no number on the record, a template not approved, the provider refusing it.",
      inputSchema: {
        ...workspaceArg,
        alert: z.string().optional().describe("Only this alert's sends"),
        status: z.enum(["sent", "not_sent", "all"]).optional().describe("Default 'all'"),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, alert, status, limit }) => {
      const found = await resolveWorkspace(workspace);
      const ruleId = alert ? (await findAlert(found._id, alert))._id : undefined;
      const rows = await call.query(api.notifications.listLogs, {
        workspaceId: found._id,
        ruleId,
        limit: limit ?? 50,
      });
      return ok(
        rows
          .filter((row) =>
            !status || status === "all"
              ? true
              : status === "sent"
                ? row.status === "sent"
                : row.status !== "sent"
          )
          .map((row) => ({
            at: iso(row.createdAt),
            alert: row.ruleName ?? (row.kind === "manual" ? "sent by hand" : "test"),
            channel: row.channel,
            to: row.to || null,
            status: row.status,
            kind: row.kind ?? null,
            template: row.templateName ?? null,
            subject: row.subject ?? null,
            preview: row.preview ?? null,
            error: row.error ?? null,
          }))
      );
    })
  );
}
