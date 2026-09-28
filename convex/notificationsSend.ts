// Sending alerts: WhatsApp templates through the channel's panel, email
// through Zoho ZeptoMail, and the template sync that feeds the first.
//
// Default runtime rather than Node: all of this is fetch, and the payloads are
// built by lib/notifications so they can be reasoned about without a network.

import { v } from "convex/values";
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
  renderText,
  resolveRecipients,
  sampleData,
  setPath,
  templateComponents,
  templateMessage,
  templatePreview,
  textToHtml,
  zeptoAuthorization,
  zeptoEndpoint,
  type NotificationChannel,
} from "./lib/notifications";

const TIMEOUT_MS = 15_000;
/** Pages of templates read per sync, at the most the panel hands back per page. */
const TEMPLATE_PAGE = 100;
const MAX_TEMPLATE_PAGES = 20;

type Json = Record<string, unknown>;

type Channel = {
  _id: Id<"channels">;
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
};

type Settings = {
  defaultCountryCode?: string;
  zeptoRegion?: string;
  zeptoToken?: string;
  fromEmail?: string;
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

function errorText(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "The provider did not respond in time.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function request(
  url: string,
  init: RequestInit
): Promise<{ status: number; ok: boolean; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, body, text };
  } finally {
    clearTimeout(timer);
  }
}

/** The most specific message a provider's error body offers. */
function providerError(status: number, body: unknown, text: string): string {
  const root = (body ?? {}) as Json;
  const error = (root.error ?? root.data ?? root) as Json;
  const details = Array.isArray(error.details) ? (error.details[0] as Json) : null;
  const message =
    (details?.message as string | undefined) ??
    ((error.error_data as Json | undefined)?.details as string | undefined) ??
    (error.message as string | undefined) ??
    (root.message as string | undefined);
  return `HTTP ${status}: ${(typeof message === "string" && message) || text.slice(0, 300) || "no response body"}`;
}

function channelHeaders(channel: { accessToken: string }): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channel.accessToken}`,
    // The panel's WABA management endpoints read the same token from API-KEY.
    "API-KEY": channel.accessToken,
  };
}

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
    const messages = (response.body as Json | null)?.messages;
    const id = Array.isArray(messages) ? (messages[0] as Json | undefined)?.id : undefined;
    return { ok: true, messageId: typeof id === "string" ? id : undefined };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

async function postEmail(
  settings: Settings,
  message: { to: string; subject: string; html: string }
): Promise<Delivery> {
  if (!settings.zeptoToken || !settings.fromEmail) {
    return { ok: false, error: "Email is not set up — add the ZeptoMail token and sender address." };
  }
  try {
    const response = await request(zeptoEndpoint(settings.zeptoRegion), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: zeptoAuthorization(settings.zeptoToken),
      },
      body: JSON.stringify({
        from: {
          address: settings.fromEmail,
          ...(settings.fromName ? { name: settings.fromName } : {}),
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
    settings: Settings;
    channel: Channel | null;
    templates: Templates;
    emailTemplates: EmailTemplates;
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
    const delivery = await postEmail(context.settings, {
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
    throw new Error(
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
    if (!context) throw new Error("Alert not found");

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
    if (!context) throw new Error("Workspace not found");

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

/** Proves the ZeptoMail settings with one plain email. */
export const sendTestEmail = action({
  args: { workspaceId: v.id("workspaces"), to: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const context = await ctx.runQuery(internal.notifications.manualContext, {
      workspaceId: args.workspaceId,
    });
    if (!context) throw new Error("Workspace not found");
    const to = recipientFor("email", args.to);
    const subject = `Test email from ${context.workspace.name}`;
    const html = textToHtml(
      `This is a test from Magic Agent.\n\nIf you are reading it, ${context.workspace.name}'s email alerts are set up and will arrive from this address.`
    );
    const delivery = await postEmail(context.settings, { to, subject, html });
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

/** A template list's rows, whichever envelope the panel wraps them in. */
function rowsOf(body: unknown): Json[] {
  if (Array.isArray(body)) return body as Json[];
  const root = (body ?? {}) as Json;
  for (const key of ["data", "templates", "message_templates", "results"]) {
    const value = root[key];
    if (Array.isArray(value)) return value as Json[];
    if (value && typeof value === "object") {
      const nested = rowsOf(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function templateRow(row: Json) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  const language =
    typeof row.language === "string"
      ? row.language
      : typeof (row.language as Json | undefined)?.code === "string"
        ? String((row.language as Json).code)
        : "en";
  return {
    providerId: row.id !== undefined ? String(row.id) : undefined,
    name,
    language,
    category: String(row.category ?? "UTILITY").toUpperCase(),
    status: String(row.status ?? "UNKNOWN").toUpperCase(),
    components: JSON.stringify(row.components ?? []),
  };
}

/**
 * The business account id, when the channel was saved without one.
 *
 * The panel's "Fetch Channel Information" answers for the token alone, and
 * somewhere in it is the WABA — under a name that differs by panel, so the
 * likely ones are all tried.
 */
async function discoverWaba(config: {
  apiBaseUrl: string;
  apiVersion: string;
  accessToken: string;
}): Promise<string | null> {
  try {
    const response = await request(
      `${config.apiBaseUrl.replace(/\/$/, "")}/${config.apiVersion}/info`,
      { method: "GET", headers: channelHeaders(config) }
    );
    if (!response.ok) return null;
    const search = (node: unknown, depth: number): string | null => {
      if (!node || typeof node !== "object" || depth > 4) return null;
      for (const [key, value] of Object.entries(node as Json)) {
        if (
          /^(waba_?id|whatsapp_business_account_id|business_account_id)$/i.test(key) &&
          (typeof value === "string" || typeof value === "number")
        ) {
          return String(value);
        }
      }
      for (const value of Object.values(node as Json)) {
        const hit = search(value, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    return search(response.body, 0);
  } catch {
    return null;
  }
}

/** Pulls every template the panel holds for the sending number's account. */
export const syncWhatsAppTemplates = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ count: number; approved: number }> => {
    const config = await ctx.runQuery(internal.notifications.syncContext, {
      workspaceId: args.workspaceId,
    });
    if (!config) {
      throw new Error("Connect a WhatsApp number under Channels first.");
    }

    const fail = async (message: string): Promise<never> => {
      await ctx.runMutation(internal.notifications.noteSyncError, {
        workspaceId: args.workspaceId,
        error: message,
      });
      throw new Error(message);
    };

    const wabaId = config.wabaId ?? (await discoverWaba(config));
    if (!wabaId) {
      return await fail(
        "The WhatsApp channel has no WABA ID. Add it on the channel in the web console, then sync again."
      );
    }

    const base = `${config.apiBaseUrl.replace(/\/$/, "")}/${config.apiVersion}/${wabaId}/message_templates`;
    const rows = new Map<string, NonNullable<ReturnType<typeof templateRow>>>();
    let offset = 0;
    let after: string | undefined;

    for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
      const url = new URL(base);
      url.searchParams.set("limit", String(TEMPLATE_PAGE));
      // The panel pages by offset; Meta itself by cursor. Both are sent, and
      // whichever the far end understands is the one it reads.
      url.searchParams.set("offset", String(offset));
      if (after) url.searchParams.set("after", after);

      let response;
      try {
        response = await request(url.toString(), {
          method: "GET",
          headers: channelHeaders(config),
        });
      } catch (error) {
        return await fail(`Could not reach the WhatsApp panel: ${errorText(error)}`);
      }
      if (!response.ok) {
        return await fail(
          `The panel refused the template list — ${providerError(response.status, response.body, response.text)}`
        );
      }

      const found = rowsOf(response.body);
      let added = 0;
      for (const raw of found) {
        const row = templateRow(raw);
        if (!row) continue;
        const key = `${row.name}|${row.language}`;
        if (!rows.has(key)) added++;
        rows.set(key, row);
      }

      const paging = ((response.body ?? {}) as Json).paging as Json | undefined;
      const cursor = (paging?.cursors as Json | undefined)?.after;
      after = paging?.next && typeof cursor === "string" ? cursor : undefined;
      offset += found.length;
      // Stop on a short page, or a page that added nothing new — a panel
      // ignoring both offset and cursor would otherwise return page one
      // twenty times.
      if (found.length < TEMPLATE_PAGE || added === 0) {
        if (!after || added === 0) break;
      }
    }

    const templates = [...rows.values()];
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
