// Sending alerts: WhatsApp templates through the channel's panel, email
// through the platform's mail account, and the template sync that feeds the first.
//
// Default runtime rather than Node: all of this is fetch, and the payloads are
// built by lib/notifications so they can be reasoned about without a network.

import { ConvexError, v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { kvPair } from "./schema";
import {
  billingCategory,
  htmlToText,
  isNotificationEvent,
  normaliseEmail,
  normalisePhone,
  parseTemplate,
  platformEmail,
  renderText,
  resolveRecipients,
  sampleData,
  senderName,
  setPath,
  templateComponents,
  templateMessage,
  templatePreview,
  textToHtml,
  zeptoAuthorization,
  type NotificationChannel,
} from "./lib/notifications";
import {
  channelHeaders,
  discoverWaba,
  errorText,
  listTemplates,
  providerError,
  request,
  type Json,
} from "./lib/panel";
import { providerMessageId } from "./lib/whatsappSend";


type Channel = {
  _id: Id<"channels">;
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
};

type Settings = {
  defaultCountryCode?: string;
  fromName?: string;
  replyTo?: string;
};

type Workspace = {
  _id: Id<"workspaces">;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
};

type Templates = Record<
  string,
  { name: string; language: string; category: string; status: string; components: string }
>;

type EmailTemplates = Record<
  string,
  { _id: Id<"emailTemplates">; name: string; subject: string; body: string; format: "text" | "html" }
>;

type Rule = {
  _id?: Id<"notificationRules">;
  name?: string;
  event?: string;
  stage?: string;
  channel: NotificationChannel;
  whatsappTemplateName?: string;
  whatsappLanguage?: string;
  emailTemplateId?: Id<"emailTemplates">;
  params: Array<{ key: string; value: string }>;
  recipients: string[];
};

type Result = {
  ruleId?: Id<"notificationRules">;
  ruleName?: string;
  event?: string;
  channel: NotificationChannel;
  to: string;
  templateName?: string;
  subject?: string;
  preview?: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  messageId?: string;
  kind?: "test" | "manual";
  category?: "marketing" | "utility" | "authentication";
};

type Delivery = { ok: boolean; messageId?: string; error?: string };

// ------------------------------------------------------------------ transport

async function postWhatsApp(channel: Channel, body: Json): Promise<Delivery> {
  const url = `${channel.apiBaseUrl.replace(/\/$/, "")}/${channel.apiVersion}/${channel.phoneNumberId}/messages`;
  try {
    const response = await request(url, {
      method: "POST",
      headers: channelHeaders(channel),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { ok: false, error: providerError(response.status, response.body, response.text) };
    }
    return { ok: true, messageId: providerMessageId(response.body) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

async function postEmail(
  workspace: Workspace,
  settings: Settings,
  message: { to: string; subject: string; html: string }
): Promise<Delivery> {
  const platform = platformEmail();
  if (!platform) {
    console.error("ZEPTOMAIL_TOKEN is not set on the deployment; email not sent.");
    return { ok: false, error: "Email sending is not available right now." };
  }
  try {
    const response = await request(platform.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: zeptoAuthorization(platform.token),
      },
      body: JSON.stringify({
        from: {
          address: platform.fromEmail,
          name: senderName(workspace.name, settings.fromName, platform.fromName),
        },
        to: [{ email_address: { address: message.to } }],
        ...(settings.replyTo ? { reply_to: [{ address: settings.replyTo }] } : {}),
        subject: message.subject,
        htmlbody: message.html,
      }),
    });
    if (!response.ok) {
      return { ok: false, error: providerError(response.status, response.body, response.text) };
    }
    const requestId = (response.body as Json | null)?.request_id;
    return { ok: true, messageId: typeof requestId === "string" ? requestId : undefined };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

// ------------------------------------------------------------------ rendering

function nowLabel(workspace: Workspace): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat(workspace.locale || "en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  try {
    return format(workspace.timezone);
  } catch {
    return format("UTC");
  }
}

/**
 * The payload a rule's placeholders are filled from: the event's own data,
 * the contact it is about, and the workspace.
 */
function buildContext(
  data: Json,
  workspace: Workspace,
  contact: Record<string, string | null> | null
): Json {
  const given = (data.contact && typeof data.contact === "object" ? data.contact : {}) as Json;
  const merged: Json = { ...given };
  for (const [key, value] of Object.entries(contact ?? {})) {
    if (value && !merged[key]) merged[key] = value;
  }

  const items = Array.isArray(data.items) ? (data.items as Json[]) : null;
  return {
    ...data,
    ...(items && !data.itemsSummary
      ? {
          itemsSummary: items
            .map((item) => `${item.quantity ?? ""} × ${item.productName ?? ""}`.trim())
            .join(", "),
        }
      : {}),
    contact: merged,
    workspace: { name: workspace.name, slug: workspace.slug },
    now: nowLabel(workspace),
  };
}

/** The rule's template, rendered for one payload. Null with a reason when it cannot be. */
function renderWhatsApp(
  rule: Rule,
  templates: Templates,
  payload: Json
):
  | { ok: true; name: string; language: string; category: Result["category"]; components: Json[]; preview: string }
  | { ok: false; error: string } {
  const name = rule.whatsappTemplateName;
  const language = rule.whatsappLanguage;
  if (!name || !language) return { ok: false, error: "The alert has no template." };
  const template = templates[`${name}|${language}`];
  if (!template) {
    return {
      ok: false,
      error: `"${name}" (${language}) is not in the synced templates. Sync templates, or pick another.`,
    };
  }
  if (template.status !== "APPROVED") {
    return { ok: false, error: `"${name}" is ${template.status.toLowerCase()}, not approved.` };
  }
  let components: unknown = [];
  try {
    components = JSON.parse(template.components);
  } catch {
    components = [];
  }
  const parsed = parseTemplate(components);
  if (parsed.unsupported) return { ok: false, error: parsed.unsupported };

  const values: Record<string, string> = {};
  for (const pair of rule.params) values[pair.key] = renderText(pair.value, payload);
  if (parsed.slots.some((slot) => slot.key === "header:media") && !values["header:media"]) {
    return { ok: false, error: `"${name}" needs a media link for its header.` };
  }

  return {
    ok: true,
    name,
    language,
    category: billingCategory(template.category),
    components: templateComponents(parsed, values),
    preview: templatePreview(parsed, values),
  };
}

function renderEmail(
  rule: Rule,
  emails: EmailTemplates,
  payload: Json
): { ok: true; subject: string; html: string; preview: string } | { ok: false; error: string } {
  const template = rule.emailTemplateId ? emails[rule.emailTemplateId] : undefined;
  if (!template) return { ok: false, error: "The alert's email template was deleted." };
  const subject = renderText(template.subject, payload).replace(/\s+/g, " ").trim();
  const html =
    template.format === "html"
      ? renderText(template.body, payload, { html: true })
      : textToHtml(renderText(template.body, payload));
  return {
    ok: true,
    subject: subject || "(no subject)",
    html,
    preview: htmlToText(html).slice(0, 600),
  };
}

/**
 * Send one rule for one payload, to its own recipients or to `overrideTo`.
 *
 * Never throws: every outcome, including "there was nobody to send to", comes
 * back as a result row, because the log is the only place anyone will look.
 */
async function runRule(
  rule: Rule,
  payload: Json,
  context: {
    workspace: Workspace;
    settings: Settings;
    channel: Channel | null;
    templates: Templates;
    emailTemplates: EmailTemplates;
    walletBlocks: Record<NonNullable<Result["category"]>, string | null>;
  },
  options: { overrideTo?: string; kind?: "test" | "manual" } = {}
): Promise<Result[]> {
  const base = {
    ruleId: rule._id,
    ruleName: rule.name,
    event: rule.event,
    channel: rule.channel,
    kind: options.kind,
  };

  const recipients = options.overrideTo
    ? { valid: [options.overrideTo], invalid: [] }
    : resolveRecipients(
        rule.recipients,
        rule.channel,
        payload,
        context.settings.defaultCountryCode
      );

  const skipped: Result[] = recipients.invalid.map((raw) => ({
    ...base,
    to: raw.slice(0, 80),
    status: "skipped",
    error:
      rule.channel === "whatsapp"
        ? `"${raw}" is not a WhatsApp number.`
        : `"${raw}" is not an email address.`,
  }));
  if (recipients.valid.length === 0) {
    return [
      ...skipped,
      ...(skipped.length === 0
        ? [
            {
              ...base,
              to: "",
              status: "skipped" as const,
              error: `Nobody to send to — this event carried no ${rule.channel === "whatsapp" ? "number" : "email address"}.`,
            },
          ]
        : []),
    ];
  }

  if (rule.channel === "whatsapp") {
    const rendered = renderWhatsApp(rule, context.templates, payload);
    const channel = context.channel;
    if (!rendered.ok || !channel) {
      const error = !rendered.ok
        ? rendered.error
        : "There is no live WhatsApp number to send from.";
      return [
        ...skipped,
        ...recipients.valid.map((to) => ({
          ...base,
          to,
          templateName: rule.whatsappTemplateName,
          status: "skipped" as const,
          error,
        })),
      ];
    }
    // A template is the business starting the conversation, so it waits for
    // credit; the log says why rather than it vanishing.
    const walletBlock = context.walletBlocks[rendered.category ?? "utility"];
    if (walletBlock) {
      return [
        ...skipped,
        ...recipients.valid.map((to) => ({
          ...base,
          to,
          templateName: rendered.name,
          category: rendered.category,
          status: "skipped" as const,
          error: walletBlock,
        })),
      ];
    }
    const sent: Result[] = [];
    for (const to of recipients.valid) {
      const delivery = await postWhatsApp(
        channel,
        templateMessage(to, rendered, rendered.components)
      );
      sent.push({
        ...base,
        to,
        templateName: rendered.name,
        preview: rendered.preview,
        category: rendered.category,
        status: delivery.ok ? "sent" : "failed",
        error: delivery.error,
        messageId: delivery.messageId,
      });
    }
    return [...skipped, ...sent];
  }

  const rendered = renderEmail(rule, context.emailTemplates, payload);
  if (!rendered.ok) {
    return [
      ...skipped,
      ...recipients.valid.map((to) => ({
        ...base,
        to,
        status: "skipped" as const,
        error: rendered.error,
      })),
    ];
  }
  const sent: Result[] = [];
  for (const to of recipients.valid) {
    const delivery = await postEmail(context.workspace, context.settings, {
      to,
      subject: rendered.subject,
      html: rendered.html,
    });
    sent.push({
      ...base,
      to,
      templateName: rule.emailTemplateId
        ? context.emailTemplates[rule.emailTemplateId]?.name
        : undefined,
      subject: rendered.subject,
      preview: rendered.preview,
      status: delivery.ok ? "sent" : "failed",
      error: delivery.error,
      messageId: delivery.messageId,
    });
  }
  return [...skipped, ...sent];
}

async function record(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    channelId?: Id<"channels">;
    conversationId?: Id<"conversations">;
    results: Result[];
  }
) {
  if (args.results.length === 0) return;
  await ctx.runMutation(internal.notifications.recordResults, args);
}

/** A string id off a payload, wherever the event keeps it. */
function idAt(data: Json, ...paths: string[][]): string | undefined {
  for (const path of paths) {
    let node: unknown = data;
    for (const key of path) {
      node = node && typeof node === "object" ? (node as Json)[key] : undefined;
    }
    if (typeof node === "string" && node) return node;
  }
  return undefined;
}

// ------------------------------------------------------------------- dispatch

/**
 * Fire every rule listening for one event.
 *
 * Scheduled by `webhooks.deliver` for platform events and by `acceptInbound`
 * for an incoming webhook, so a slow provider holds up neither a customer's
 * reply nor the other system's request.
 */
export const dispatch = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.string(),
    data: v.any(),
    recordBookId: v.optional(v.id("recordBooks")),
    /** One rule only — an incoming webhook's URL belongs to one rule. */
    ruleId: v.optional(v.id("notificationRules")),
  },
  handler: async (ctx, args): Promise<null> => {
    if (!isNotificationEvent(args.event)) return null;
    const data: Json =
      args.data && typeof args.data === "object" && !Array.isArray(args.data)
        ? (args.data as Json)
        : { value: args.data };

    const context = await ctx.runQuery(internal.notifications.dispatchContext, {
      workspaceId: args.workspaceId,
      event: args.event,
      recordBookId: args.recordBookId,
      ruleId: args.ruleId,
      contactId: idAt(data, ["record", "contactId"], ["contactId"]),
      conversationId: idAt(
        data,
        ["record", "conversationId"],
        ["conversationId"]
      ),
    });
    if (!context) return null;

    const payload = buildContext(data, context.workspace, context.contact);
    const stage = idAt(data, ["record", "stage"]);

    // In parallel: one provider taking its fifteen seconds must not decide
    // how long the next rule waits.
    const batches = await Promise.all(
      context.rules
        .filter((rule) => !rule.stage || rule.stage === stage)
        .map((rule) => runRule(rule, payload, context))
    );

    await record(ctx, {
      workspaceId: args.workspaceId,
      channelId: context.channel?._id,
      conversationId: context.conversationId ?? undefined,
      results: batches.flat(),
    });
    return null;
  },
});

// ---------------------------------------------------------------- dashboard

function recipientFor(channel: NotificationChannel, raw: string, code?: string): string {
  const address =
    channel === "whatsapp" ? normalisePhone(raw, code) : normaliseEmail(raw);
  if (!address) {
    throw new ConvexError(
      channel === "whatsapp"
        ? "That is not a WhatsApp number. Include the country code."
        : "That is not an email address."
    );
  }
  return address;
}

function outcome(results: Result[]): { ok: boolean; error?: string; preview?: string } {
  const last = results[results.length - 1];
  return {
    ok: results.some((result) => result.status === "sent"),
    error: results.find((result) => result.status !== "sent")?.error,
    preview: last?.preview,
  };
}

/** "Send a test" on a rule: a sample payload, to one number or address. */
export const testRule = action({
  args: { ruleId: v.id("notificationRules"), to: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string; preview?: string }> => {
    const context = await ctx.runQuery(internal.notifications.testContext, {
      ruleId: args.ruleId,
    });
    if (!context) throw new ConvexError("Alert not found");

    const to = recipientFor(
      context.rule.channel,
      args.to,
      context.settings.defaultCountryCode
    );
    const data = sampleData(context.rule.event, context.book, context.lastInbound);
    const payload = buildContext(data, context.workspace, null);
    const results = await runRule(context.rule, payload, context, {
      overrideTo: to,
      kind: "test",
    });
    await record(ctx, {
      workspaceId: context.workspace._id,
      channelId: context.channel?._id,
      results,
    });
    return outcome(results);
  },
});

/**
 * A saved template sent by hand: a WhatsApp template with its blanks filled
 * in, or an email template with its variables.
 */
export const sendMessage = action({
  args: {
    workspaceId: v.id("workspaces"),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    to: v.string(),
    whatsappTemplateName: v.optional(v.string()),
    whatsappLanguage: v.optional(v.string()),
    /** Template slot to the value it takes. */
    params: v.optional(v.array(kvPair)),
    emailTemplateId: v.optional(v.id("emailTemplates")),
    /** Variable path to value, for an email template's `{{path}}`s. */
    values: v.optional(v.array(kvPair)),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string; preview?: string }> => {
    const context = await ctx.runQuery(internal.notifications.manualContext, {
      workspaceId: args.workspaceId,
      whatsappTemplateName: args.whatsappTemplateName,
      whatsappLanguage: args.whatsappLanguage,
      emailTemplateId: args.emailTemplateId,
    });
    if (!context) throw new ConvexError("Workspace not found");

    const to = recipientFor(args.channel, args.to, context.settings.defaultCountryCode);
    const data: Json = {};
    for (const pair of args.values ?? []) {
      if (pair.key.trim()) setPath(data, pair.key.trim(), pair.value);
    }
    const payload = buildContext(data, context.workspace, null);
    const results = await runRule(
      {
        channel: args.channel,
        whatsappTemplateName: args.whatsappTemplateName,
        whatsappLanguage: args.whatsappLanguage,
        emailTemplateId: args.emailTemplateId,
        params: args.params ?? [],
        recipients: [],
      },
      payload,
      context,
      { overrideTo: to, kind: "manual" }
    );
    await record(ctx, {
      workspaceId: args.workspaceId,
      channelId: context.channel?._id,
      results,
    });
    return outcome(results);
  },
});

/** Proves the email sender settings with one plain email. */
export const sendTestEmail = action({
  args: { workspaceId: v.id("workspaces"), to: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const context = await ctx.runQuery(internal.notifications.manualContext, {
      workspaceId: args.workspaceId,
    });
    if (!context) throw new ConvexError("Workspace not found");
    const to = recipientFor("email", args.to);
    const subject = `Test email from ${context.workspace.name}`;
    const html = textToHtml(
      `This is a test from Magic Agent.\n\nIf you are reading it, ${context.workspace.name}'s email alerts are set up and will arrive from this address.`
    );
    const delivery = await postEmail(context.workspace, context.settings, { to, subject, html });
    await record(ctx, {
      workspaceId: args.workspaceId,
      results: [
        {
          channel: "email",
          to,
          subject,
          preview: htmlToText(html),
          status: delivery.ok ? "sent" : "failed",
          error: delivery.error,
          messageId: delivery.messageId,
          kind: "test",
        },
      ],
    });
    return { ok: delivery.ok, error: delivery.error };
  },
});

// ---------------------------------------------------------------------- sync

/** Pulls every template the panel holds for the sending number's account. */
export const syncWhatsAppTemplates = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ count: number; approved: number }> => {
    const config = await ctx.runQuery(internal.notifications.syncContext, {
      workspaceId: args.workspaceId,
    });
    if (!config) {
      throw new ConvexError("Connect a WhatsApp number under Channels first.");
    }

    const fail = async (message: string): Promise<never> => {
      await ctx.runMutation(internal.notifications.noteSyncError, {
        workspaceId: args.workspaceId,
        error: message,
      });
      throw new ConvexError(message);
    };

    const wabaId = config.wabaId ?? (await discoverWaba(config));
    if (!wabaId) {
      return await fail(
        "The WhatsApp channel has no WABA ID. Add it on the channel in the web console, then sync again."
      );
    }

    const listed = await listTemplates(config, wabaId);
    if (!listed.ok) return await fail(listed.error);

    // The panel's rejection reason is the marketing desk's concern, not the
    // alerts', so the synced copy keeps the fields it always had.
    const templates = listed.templates.map((row) => ({
      providerId: row.providerId,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      components: row.components,
    }));
    await ctx.runMutation(internal.notifications.replaceTemplates, {
      workspaceId: args.workspaceId,
      channelId: config.channelId,
      templates,
    });
    return {
      count: templates.length,
      approved: templates.filter((row) => row.status === "APPROVED").length,
    };
  },
});
