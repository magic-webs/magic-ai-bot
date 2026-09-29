// Notifications: the rules, the templates they send and the log of what went.
//
// How an alert gets out, end to end:
//
//   a record is filed / an order is taken / an agent escalates
//     -> webhooks.deliver, which every platform event already passes through,
//        schedules notificationsSend.dispatch with the same payload
//   another system posts to /notify/<key>
//     -> http.ts hands the body to acceptInbound, which schedules the same
//   dispatch reads the rules listening for that event (dispatchContext),
//   fills each rule's template from the payload, sends it on WhatsApp or
//   through ZeptoMail, and recordResults logs every send — charging the
//   WhatsApp ones and writing them into the customer's thread.
//
// The sending lives in notificationsSend.ts, next door, because it is all
// fetch and nothing here needs to be.

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
import { kvPair } from "./schema";
import { requireWorkspace } from "./lib/auth";
import { charge } from "./lib/billing";
import { randomKey } from "./lib/shared";
import {
  NOTIFICATION_EVENTS,
  ZEPTO_REGIONS,
  eventInfo,
  isZeptoRegion,
  leafPaths,
  normaliseEmail,
  parseTemplate,
  placeholderPaths,
  trimSample,
  type NotificationEvent,
} from "./lib/notifications";

const eventValidator = v.union(
  v.literal("record_filed"),
  v.literal("record_updated"),
  v.literal("record_stage_changed"),
  v.literal("order_created"),
  v.literal("escalation"),
  v.literal("inbound")
);

const channelValidator = v.union(v.literal("whatsapp"), v.literal("email"));

/** The largest incoming body kept as a mapping sample. */
const MAX_SAMPLE = 16_000;
const MAX_PARAMS = 30;
const MAX_RECIPIENTS = 20;

// ------------------------------------------------------------------ helpers

async function settingsFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"notificationSettings"> | null> {
  return await ctx.db
    .query("notificationSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

/**
 * The number alerts go out from: the one chosen in settings while it is still
 * live, otherwise the workspace's first live WhatsApp channel — the same
 * number the marketing desk sends from.
 */
async function senderFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  settings: { whatsappChannelId?: Id<"channels"> } | null
): Promise<Doc<"channels"> | null> {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(50);
  const live = channels.filter(
    (channel) =>
      channel.type === "whatsapp" &&
      channel.status === "active" &&
      Boolean(channel.whatsapp)
  );
  return (
    live.find((channel) => channel._id === settings?.whatsappChannelId) ??
    live[0] ??
    null
  );
}

async function requireRule(
  ctx: QueryCtx,
  ruleId: Id<"notificationRules">
): Promise<Doc<"notificationRules">> {
  const rule = await ctx.db.get("notificationRules", ruleId);
  if (!rule) throw new Error("Alert not found");
  await requireWorkspace(ctx, rule.workspaceId);
  return rule;
}

async function requireEmailTemplate(
  ctx: QueryCtx,
  templateId: Id<"emailTemplates">
): Promise<Doc<"emailTemplates">> {
  const template = await ctx.db.get("emailTemplates", templateId);
  if (!template) throw new Error("Email template not found");
  await requireWorkspace(ctx, template.workspaceId);
  return template;
}

function inboundUrl(key: string | undefined): string | null {
  if (!key) return null;
  const site = process.env.CONVEX_SITE_URL ?? "";
  return `${site.replace(/\/$/, "")}/notify/${key}`;
}

function templateKey(name: string, language: string): string {
  return `${name}|${language}`;
}

/** A synced template, read for the app: its blanks, its text and its state. */
function describeTemplate(row: Doc<"whatsappTemplates">) {
  let components: unknown = [];
  try {
    components = JSON.parse(row.components);
  } catch {
    components = [];
  }
  const parsed = parseTemplate(components);
  return {
    _id: row._id,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    header: parsed.header ?? null,
    body: parsed.body?.text ?? null,
    footer: parsed.footer ?? null,
    buttons: parsed.buttons,
    slots: parsed.slots,
    unsupported: parsed.unsupported ?? null,
    sendable: row.status === "APPROVED" && !parsed.unsupported,
  };
}

function cleanList(values: string[], max: number): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, max);
}

// ------------------------------------------------------------------ queries

/**
 * Everything the Notifications screen needs that is not a list: the senders,
 * the events a rule can listen for, and the variables each one offers.
 */
export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const settings = await settingsFor(ctx, args.workspaceId);
    const sender = await senderFor(ctx, args.workspaceId, settings);

    const channels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(50);
    const books = await ctx.db
      .query("recordBooks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(100);
    const team = await ctx.db
      .query("teamMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(100);

    const token = settings?.zeptoToken?.trim();

    return {
      settings: {
        whatsappChannelId: settings?.whatsappChannelId ?? null,
        defaultCountryCode: settings?.defaultCountryCode ?? null,
        zeptoRegion: settings?.zeptoRegion ?? null,
        fromEmail: settings?.fromEmail ?? null,
        fromName: settings?.fromName ?? null,
        replyTo: settings?.replyTo ?? null,
        // Never the token itself: this document goes to the phone.
        tokenSet: Boolean(token),
        tokenHint: token ? `••••${token.slice(-4)}` : null,
        templatesSyncedAt: settings?.templatesSyncedAt ?? null,
        templatesSyncError: settings?.templatesSyncError ?? null,
      },
      sender: sender
        ? {
            _id: sender._id,
            name: sender.name,
            phone: sender.whatsapp?.displayPhoneNumber ?? null,
            hasWaba: Boolean(sender.whatsapp?.wabaId),
          }
        : null,
      channels: channels
        .filter((channel) => channel.type === "whatsapp" && channel.whatsapp)
        .map((channel) => ({
          _id: channel._id,
          name: channel.name,
          phone: channel.whatsapp?.displayPhoneNumber ?? null,
          status: channel.status,
        })),
      emailReady: Boolean(token && settings?.fromEmail),
      events: NOTIFICATION_EVENTS,
      books: books
        .filter((book) => book.status !== "archived")
        .map((book) => ({
          _id: book._id,
          name: book.name,
          pluralName: book.pluralName,
          stages: book.stages,
          variables: book.fields.map((field) => ({
            path: `record.details.${field.key}`,
            label: field.label,
          })),
        })),
      team: team
        .filter((member) => member.status !== "inactive")
        .filter((member) => member.phone || member.email)
        .map((member) => ({
          _id: member._id,
          name: member.name,
          phone: member.phone ?? null,
          email: member.email ?? null,
        })),
      regions: ZEPTO_REGIONS,
    };
  },
});

/** The synced WhatsApp templates of the sending number, approved first. */
export const listWhatsAppTemplates = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const settings = await settingsFor(ctx, args.workspaceId);
    const sender = await senderFor(ctx, args.workspaceId, settings);
    if (!sender) return [];
    const rows = await ctx.db
      .query("whatsappTemplates")
      .withIndex("by_channel", (q) => q.eq("channelId", sender._id))
      .take(500);
    return rows
      .map(describeTemplate)
      .sort(
        (a, b) =>
          Number(b.status === "APPROVED") - Number(a.status === "APPROVED") ||
          a.name.localeCompare(b.name)
      );
  },
});

export const listEmailTemplates = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("emailTemplates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    return rows
      .map((row) => ({
        ...row,
        variables: placeholderPaths(`${row.subject}\n${row.body}`),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const listRules = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rules = await ctx.db
      .query("notificationRules")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);

    const bookIds = [...new Set(rules.flatMap((rule) => (rule.bookId ? [rule.bookId] : [])))];
    const books = new Map(
      (await Promise.all(bookIds.map((id) => ctx.db.get("recordBooks", id))))
        .filter((book): book is Doc<"recordBooks"> => book !== null)
        .map((book) => [book._id, book])
    );
    const emailIds = [
      ...new Set(rules.flatMap((rule) => (rule.emailTemplateId ? [rule.emailTemplateId] : []))),
    ];
    const emails = new Map(
      (await Promise.all(emailIds.map((id) => ctx.db.get("emailTemplates", id))))
        .filter((row): row is Doc<"emailTemplates"> => row !== null)
        .map((row) => [row._id, row])
    );

    return rules.map((rule) => {
      let samplePaths: string[] = [];
      if (rule.lastInboundPayload) {
        try {
          samplePaths = leafPaths(JSON.parse(rule.lastInboundPayload));
        } catch {
          samplePaths = [];
        }
      }
      const book = rule.bookId ? books.get(rule.bookId) : undefined;
      return {
        _id: rule._id,
        name: rule.name,
        enabled: rule.enabled,
        event: rule.event,
        eventLabel: eventInfo(rule.event).label,
        bookId: rule.bookId ?? null,
        // Null with a bookId set means the book was deleted under the rule,
        // which the screen shows rather than quietly reading as "any book".
        bookName: rule.bookId ? (book?.pluralName ?? null) : null,
        stage: rule.stage ?? null,
        channel: rule.channel,
        whatsappTemplateName: rule.whatsappTemplateName ?? null,
        whatsappLanguage: rule.whatsappLanguage ?? null,
        emailTemplateId: rule.emailTemplateId ?? null,
        emailTemplateName: rule.emailTemplateId
          ? (emails.get(rule.emailTemplateId)?.name ?? null)
          : null,
        params: rule.params,
        recipients: rule.recipients,
        inboundUrl: rule.event === "inbound" ? inboundUrl(rule.inboundKey) : null,
        lastInboundAt: rule.lastInboundAt ?? null,
        // A sample kept before its time was recorded was the last call's.
        sampleAt:
          rule.inboundSampleAt ??
          (rule.lastInboundPayload ? (rule.lastInboundAt ?? null) : null),
        capturing: rule.inboundCapture ?? false,
        samplePaths,
        sentCount: rule.sentCount,
        failedCount: rule.failedCount,
        lastFiredAt: rule.lastFiredAt ?? null,
        lastError: rule.lastError ?? null,
        updatedAt: rule.updatedAt,
      };
    });
  },
});

/** Most recent first. One rule's sends, or everything. */
export const listLogs = query({
  args: {
    workspaceId: v.id("workspaces"),
    ruleId: v.optional(v.id("notificationRules")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    if (args.ruleId) {
      const rule = await ctx.db.get("notificationRules", args.ruleId);
      if (!rule || rule.workspaceId !== args.workspaceId) return [];
      return await ctx.db
        .query("notificationLogs")
        .withIndex("by_rule", (q) => q.eq("ruleId", args.ruleId))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("notificationLogs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(limit);
  },
});

// ---------------------------------------------------------------- mutations

export const saveSettings = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    whatsappChannelId: v.optional(v.union(v.id("channels"), v.null())),
    defaultCountryCode: v.optional(v.string()),
    zeptoRegion: v.optional(v.string()),
    /** Omit to keep the saved token, "" to clear it. */
    zeptoToken: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    replyTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const existing = await settingsFor(ctx, args.workspaceId);

    if (args.whatsappChannelId) {
      const channel = await ctx.db.get("channels", args.whatsappChannelId);
      if (!channel || channel.workspaceId !== args.workspaceId || channel.type !== "whatsapp") {
        throw new Error("That WhatsApp number is not on this workspace.");
      }
    }
    if (args.zeptoRegion !== undefined && args.zeptoRegion && !isZeptoRegion(args.zeptoRegion)) {
      throw new Error("Pick one of ZeptoMail's regions.");
    }
    const fromEmail = args.fromEmail?.trim();
    if (fromEmail && !normaliseEmail(fromEmail)) {
      throw new Error("The sender address is not an email address.");
    }
    const replyTo = args.replyTo?.trim();
    if (replyTo && !normaliseEmail(replyTo)) {
      throw new Error("The reply-to address is not an email address.");
    }

    // Undefined leaves a field as it was; an empty string clears it.
    const pick = (value: string | undefined, current: string | undefined) =>
      value === undefined ? current : value.trim() || undefined;

    const next = {
      whatsappChannelId:
        args.whatsappChannelId === undefined
          ? existing?.whatsappChannelId
          : (args.whatsappChannelId ?? undefined),
      defaultCountryCode:
        args.defaultCountryCode === undefined
          ? existing?.defaultCountryCode
          : args.defaultCountryCode.replace(/\D/g, "") || undefined,
      zeptoRegion: pick(args.zeptoRegion, existing?.zeptoRegion),
      zeptoToken: pick(args.zeptoToken, existing?.zeptoToken),
      fromEmail: pick(args.fromEmail, existing?.fromEmail),
      fromName: pick(args.fromName, existing?.fromName),
      replyTo: pick(args.replyTo, existing?.replyTo),
      updatedAt: Date.now(),
    };

    if (existing) {
      // A different number means a different business account and a
      // different template list, so the old sync no longer describes it.
      // Compared as the number that actually sends: picking the one that was
      // already the default is not a change.
      const before = await senderFor(ctx, args.workspaceId, existing);
      const after = await senderFor(ctx, args.workspaceId, next);
      const changedNumber = before?._id !== after?._id;
      await ctx.db.patch("notificationSettings", existing._id, {
        ...next,
        ...(changedNumber
          ? { templatesSyncedAt: undefined, templatesSyncError: undefined }
          : {}),
      });
    } else {
      await ctx.db.insert("notificationSettings", {
        workspaceId: args.workspaceId,
        ...next,
      });
    }
    return { success: true };
  },
});

export const saveEmailTemplate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    templateId: v.optional(v.id("emailTemplates")),
    name: v.string(),
    subject: v.string(),
    body: v.string(),
    format: v.union(v.literal("text"), v.literal("html")),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const name = args.name.trim();
    const subject = args.subject.trim();
    const body = args.body.trim();
    if (!name) throw new Error("Give the template a name.");
    if (!subject) throw new Error("An email needs a subject.");
    if (!body) throw new Error("An email needs a message.");
    if (body.length > 100_000) throw new Error("That message is too long to send.");

    const now = Date.now();
    if (args.templateId) {
      const existing = await requireEmailTemplate(ctx, args.templateId);
      if (existing.workspaceId !== args.workspaceId) throw new Error("Email template not found");
      await ctx.db.patch("emailTemplates", args.templateId, {
        name,
        subject,
        body,
        format: args.format,
        updatedAt: now,
      });
      return { templateId: args.templateId };
    }
    const templateId = await ctx.db.insert("emailTemplates", {
      workspaceId: args.workspaceId,
      name,
      subject,
      body,
      format: args.format,
      createdAt: now,
      updatedAt: now,
    });
    return { templateId };
  },
});

export const removeEmailTemplate = mutation({
  args: { templateId: v.id("emailTemplates") },
  handler: async (ctx, args) => {
    const template = await requireEmailTemplate(ctx, args.templateId);
    const rules = await ctx.db
      .query("notificationRules")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", template.workspaceId))
      .take(200);
    const using = rules.filter((rule) => rule.emailTemplateId === args.templateId);
    // Refused rather than cascaded: an alert that silently stops sending is
    // worse than being asked to repoint it first.
    if (using.length > 0) {
      throw new Error(
        `Used by ${using.length === 1 ? `"${using[0].name}"` : `${using.length} alerts`}. Point ${using.length === 1 ? "it" : "them"} at another template first.`
      );
    }
    await ctx.db.delete("emailTemplates", args.templateId);
    return { success: true };
  },
});

export const saveRule = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    ruleId: v.optional(v.id("notificationRules")),
    name: v.string(),
    enabled: v.boolean(),
    event: eventValidator,
    bookId: v.optional(v.id("recordBooks")),
    stage: v.optional(v.string()),
    channel: channelValidator,
    whatsappTemplateName: v.optional(v.string()),
    whatsappLanguage: v.optional(v.string()),
    emailTemplateId: v.optional(v.id("emailTemplates")),
    params: v.array(kvPair),
    recipients: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const existing = args.ruleId ? await requireRule(ctx, args.ruleId) : null;
    if (existing && existing.workspaceId !== args.workspaceId) {
      throw new Error("Alert not found");
    }

    const name = args.name.trim();
    if (!name) throw new Error("Give the alert a name.");

    const isRecord = eventInfo(args.event as NotificationEvent).source === "record";
    let bookId: Id<"recordBooks"> | undefined;
    let stage: string | undefined;
    if (isRecord && args.bookId) {
      const book = await ctx.db.get("recordBooks", args.bookId);
      if (!book || book.workspaceId !== args.workspaceId) {
        throw new Error("That record book is not on this workspace.");
      }
      bookId = book._id;
      const wanted = args.stage?.trim();
      if (wanted) {
        if (!book.stages.includes(wanted)) {
          throw new Error(`${book.pluralName} has no stage called "${wanted}".`);
        }
        stage = wanted;
      }
    }

    let whatsappTemplateName: string | undefined;
    let whatsappLanguage: string | undefined;
    let emailTemplateId: Id<"emailTemplates"> | undefined;
    if (args.channel === "whatsapp") {
      whatsappTemplateName = args.whatsappTemplateName?.trim();
      whatsappLanguage = args.whatsappLanguage?.trim();
      if (!whatsappTemplateName || !whatsappLanguage) {
        throw new Error("Pick the WhatsApp template this alert sends.");
      }
    } else {
      if (!args.emailTemplateId) throw new Error("Pick the email this alert sends.");
      const template = await requireEmailTemplate(ctx, args.emailTemplateId);
      if (template.workspaceId !== args.workspaceId) throw new Error("Email template not found");
      emailTemplateId = template._id;
    }

    const recipients = cleanList(args.recipients, MAX_RECIPIENTS);
    if (recipients.length === 0) {
      throw new Error("Add at least one person to send it to.");
    }
    const params = args.params
      .map((pair) => ({ key: pair.key.trim(), value: pair.value.trim() }))
      .filter((pair) => pair.key && pair.value)
      .slice(0, MAX_PARAMS);

    // An incoming webhook needs an address of its own, and keeps it across
    // edits so the other system does not have to be reconfigured.
    const inboundKey =
      args.event === "inbound"
        ? (existing?.inboundKey ?? randomKey(28))
        : undefined;

    const now = Date.now();
    const fields = {
      name,
      enabled: args.enabled,
      event: args.event,
      bookId,
      stage,
      inboundKey,
      channel: args.channel,
      whatsappTemplateName,
      whatsappLanguage,
      emailTemplateId,
      params,
      recipients,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch("notificationRules", existing._id, fields);
      return { ruleId: existing._id };
    }
    const ruleId = await ctx.db.insert("notificationRules", {
      workspaceId: args.workspaceId,
      ...fields,
      sentCount: 0,
      failedCount: 0,
      createdAt: now,
    });
    return { ruleId };
  },
});

export const setRuleEnabled = mutation({
  args: { ruleId: v.id("notificationRules"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireRule(ctx, args.ruleId);
    await ctx.db.patch("notificationRules", args.ruleId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const removeRule = mutation({
  args: { ruleId: v.id("notificationRules") },
  handler: async (ctx, args) => {
    await requireRule(ctx, args.ruleId);
    // The log keeps its rows: they carry the rule's name, and what was sent
    // to a customer is worth keeping after the rule that sent it is gone.
    await ctx.db.delete("notificationRules", args.ruleId);
    return { success: true };
  },
});

/** A new URL for an incoming webhook, when the old one has leaked. */
export const rotateInboundKey = mutation({
  args: { ruleId: v.id("notificationRules") },
  handler: async (ctx, args) => {
    const rule = await requireRule(ctx, args.ruleId);
    if (rule.event !== "inbound") throw new Error("Only incoming webhooks have a URL.");
    const inboundKey = randomKey(28);
    await ctx.db.patch("notificationRules", rule._id, { inboundKey, updatedAt: Date.now() });
    return { inboundUrl: inboundUrl(inboundKey) };
  },
});

/**
 * "Capture new sample": the next call to the URL replaces the body the fields
 * are mapped from. `capture: false` stops waiting for one.
 */
export const captureInboundSample = mutation({
  args: { ruleId: v.id("notificationRules"), capture: v.boolean() },
  handler: async (ctx, args) => {
    const rule = await requireRule(ctx, args.ruleId);
    if (rule.event !== "inbound") throw new Error("Only incoming webhooks take a sample.");
    await ctx.db.patch("notificationRules", rule._id, {
      inboundCapture: args.capture ? true : undefined,
    });
    return { success: true };
  },
});

// ----------------------------------------------------------------- internal

type SendContext = {
  workspace: {
    _id: Id<"workspaces">;
    name: string;
    slug: string;
    timezone: string;
    locale: string;
  };
  settings: {
    defaultCountryCode?: string;
    zeptoRegion?: string;
    zeptoToken?: string;
    fromEmail?: string;
    fromName?: string;
    replyTo?: string;
  };
  channel: {
    _id: Id<"channels">;
    apiBaseUrl: string;
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
  } | null;
  templates: Record<
    string,
    { name: string; language: string; category: string; status: string; components: string }
  >;
  emailTemplates: Record<
    string,
    { _id: Id<"emailTemplates">; name: string; subject: string; body: string; format: "text" | "html" }
  >;
};

/**
 * The workspace, its senders, and the templates `rules` use — read in one go
 * so a dispatch is one query, however many rules fire.
 */
async function sendContextFor(
  ctx: QueryCtx,
  workspace: Doc<"workspaces">,
  rules: Array<{
    whatsappTemplateName?: string;
    whatsappLanguage?: string;
    emailTemplateId?: Id<"emailTemplates">;
  }>
): Promise<SendContext> {
  const settings = await settingsFor(ctx, workspace._id);
  const sender = await senderFor(ctx, workspace._id, settings);

  const templates: SendContext["templates"] = {};
  const wanted = new Set(
    rules.flatMap((rule) =>
      rule.whatsappTemplateName && rule.whatsappLanguage
        ? [templateKey(rule.whatsappTemplateName, rule.whatsappLanguage)]
        : []
    )
  );
  if (sender && wanted.size > 0) {
    const rows = await ctx.db
      .query("whatsappTemplates")
      .withIndex("by_channel", (q) => q.eq("channelId", sender._id))
      .take(500);
    for (const row of rows) {
      const key = templateKey(row.name, row.language);
      if (wanted.has(key)) {
        templates[key] = {
          name: row.name,
          language: row.language,
          category: row.category,
          status: row.status,
          components: row.components,
        };
      }
    }
  }

  const emailTemplates: SendContext["emailTemplates"] = {};
  for (const rule of rules) {
    if (!rule.emailTemplateId || emailTemplates[rule.emailTemplateId]) continue;
    const row = await ctx.db.get("emailTemplates", rule.emailTemplateId);
    if (row && row.workspaceId === workspace._id) {
      emailTemplates[row._id] = {
        _id: row._id,
        name: row.name,
        subject: row.subject,
        body: row.body,
        format: row.format,
      };
    }
  }

  return {
    workspace: {
      _id: workspace._id,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      locale: workspace.locale,
    },
    settings: {
      defaultCountryCode: settings?.defaultCountryCode,
      zeptoRegion: settings?.zeptoRegion,
      zeptoToken: settings?.zeptoToken,
      fromEmail: settings?.fromEmail,
      fromName: settings?.fromName,
      replyTo: settings?.replyTo,
    },
    channel:
      sender?.whatsapp
        ? {
            _id: sender._id,
            apiBaseUrl: sender.whatsapp.apiBaseUrl,
            apiVersion: sender.whatsapp.apiVersion,
            phoneNumberId: sender.whatsapp.phoneNumberId,
            accessToken: sender.whatsapp.accessToken,
          }
        : null,
    templates,
    emailTemplates,
  };
}

/** Who the event is about, from the ids its payload carries. */
async function contactFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  contactId: string | undefined,
  conversationId: string | undefined
) {
  let conversation: Doc<"conversations"> | null = null;
  const conversationKey = conversationId
    ? ctx.db.normalizeId("conversations", conversationId)
    : null;
  if (conversationKey) {
    conversation = await ctx.db.get("conversations", conversationKey);
    if (conversation?.workspaceId !== workspaceId) conversation = null;
  }

  const contactKey =
    (contactId ? ctx.db.normalizeId("contacts", contactId) : null) ??
    conversation?.contactId ??
    null;
  const contact = contactKey ? await ctx.db.get("contacts", contactKey) : null;
  if (!contact || contact.workspaceId !== workspaceId) {
    return { contact: null, conversationId: conversation?._id ?? null };
  }
  return {
    contact: {
      name: contact.name ?? null,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      company: contact.company ?? null,
      // On WhatsApp the external id is the number the customer writes from.
      whatsapp: contact.channelType === "whatsapp" ? contact.externalId : null,
    },
    conversationId: conversation?._id ?? null,
  };
}

/** The rules one event fires, and everything needed to send them. */
export const dispatchContext = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.string(),
    recordBookId: v.optional(v.id("recordBooks")),
    ruleId: v.optional(v.id("notificationRules")),
    contactId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;

    let rules: Doc<"notificationRules">[];
    if (args.ruleId) {
      const rule = await ctx.db.get("notificationRules", args.ruleId);
      rules = rule && rule.workspaceId === args.workspaceId && rule.enabled ? [rule] : [];
    } else {
      const event = args.event as NotificationEvent;
      rules = (
        await ctx.db
          .query("notificationRules")
          .withIndex("by_workspace_event", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("event", event)
          )
          .take(100)
      ).filter(
        (rule) =>
          rule.enabled && (!rule.bookId || rule.bookId === args.recordBookId)
      );
    }
    if (rules.length === 0) return null;

    const sending = await sendContextFor(ctx, workspace, rules);
    const who = await contactFor(ctx, workspace._id, args.contactId, args.conversationId);
    return {
      ...sending,
      rules: rules.map((rule) => ({
        _id: rule._id,
        name: rule.name,
        event: rule.event,
        stage: rule.stage,
        channel: rule.channel,
        whatsappTemplateName: rule.whatsappTemplateName,
        whatsappLanguage: rule.whatsappLanguage,
        emailTemplateId: rule.emailTemplateId,
        params: rule.params,
        recipients: rule.recipients,
      })),
      contact: who.contact,
      conversationId: who.conversationId,
    };
  },
});

/** One rule, a sample payload's makings and its senders, for "Send a test". */
export const testContext = internalQuery({
  args: { ruleId: v.id("notificationRules") },
  handler: async (ctx, args) => {
    // Guarded even though only `notificationsSend.testRule` calls it: it
    // reads the channel's access token and the ZeptoMail token.
    const rule = await requireRule(ctx, args.ruleId);
    const workspace = await ctx.db.get("workspaces", rule.workspaceId);
    if (!workspace) return null;

    let book = rule.bookId ? await ctx.db.get("recordBooks", rule.bookId) : null;
    if (!book && eventInfo(rule.event).source === "record") {
      book =
        (
          await ctx.db
            .query("recordBooks")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
            .take(1)
        )[0] ?? null;
    }

    let lastInbound: unknown = null;
    if (rule.lastInboundPayload) {
      try {
        lastInbound = JSON.parse(rule.lastInboundPayload);
      } catch {
        lastInbound = null;
      }
    }

    const sending = await sendContextFor(ctx, workspace, [rule]);
    return {
      ...sending,
      rule: {
        _id: rule._id,
        name: rule.name,
        event: rule.event,
        stage: rule.stage,
        channel: rule.channel,
        whatsappTemplateName: rule.whatsappTemplateName,
        whatsappLanguage: rule.whatsappLanguage,
        emailTemplateId: rule.emailTemplateId,
        params: rule.params,
        recipients: rule.recipients,
      },
      book: book
        ? {
            name: book.name,
            pluralName: book.pluralName,
            handle: book.handle,
            referencePrefix: book.referencePrefix,
            stages: book.stages,
            fields: book.fields,
          }
        : null,
      lastInbound,
    };
  },
});

/** The senders and one template, for a message sent by hand. */
export const manualContext = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    whatsappTemplateName: v.optional(v.string()),
    whatsappLanguage: v.optional(v.string()),
    emailTemplateId: v.optional(v.id("emailTemplates")),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    return await sendContextFor(ctx, workspace, [
      {
        whatsappTemplateName: args.whatsappTemplateName,
        whatsappLanguage: args.whatsappLanguage,
        emailTemplateId: args.emailTemplateId,
      },
    ]);
  },
});

/** The number to sync templates for, and where its business account is. */
export const syncContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const settings = await settingsFor(ctx, args.workspaceId);
    const sender = await senderFor(ctx, args.workspaceId, settings);
    if (!sender?.whatsapp) return null;
    return {
      channelId: sender._id,
      apiBaseUrl: sender.whatsapp.apiBaseUrl,
      apiVersion: sender.whatsapp.apiVersion,
      wabaId: sender.whatsapp.wabaId ?? null,
      accessToken: sender.whatsapp.accessToken,
    };
  },
});

async function touchSettings(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  patch: { templatesSyncedAt?: number; templatesSyncError?: string }
) {
  const existing = await settingsFor(ctx, workspaceId);
  if (existing) {
    await ctx.db.patch("notificationSettings", existing._id, patch);
  } else {
    await ctx.db.insert("notificationSettings", {
      workspaceId,
      ...patch,
      updatedAt: Date.now(),
    });
  }
}

/**
 * The channel's templates, replaced by what the panel returned: new ones
 * added, changed ones updated in place, and ones the panel no longer has
 * removed.
 */
export const replaceTemplates = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    templates: v.array(
      v.object({
        providerId: v.optional(v.string()),
        name: v.string(),
        language: v.string(),
        category: v.string(),
        status: v.string(),
        components: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("whatsappTemplates")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .take(1000);
    const byKey = new Map(existing.map((row) => [templateKey(row.name, row.language), row]));
    const seen = new Set<string>();

    for (const template of args.templates) {
      const key = templateKey(template.name, template.language);
      if (seen.has(key)) continue;
      seen.add(key);
      const row = byKey.get(key);
      if (row) {
        await ctx.db.patch("whatsappTemplates", row._id, { ...template, syncedAt: now });
      } else {
        await ctx.db.insert("whatsappTemplates", {
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          ...template,
          syncedAt: now,
        });
      }
    }
    for (const row of existing) {
      if (!seen.has(templateKey(row.name, row.language))) {
        await ctx.db.delete("whatsappTemplates", row._id);
      }
    }

    await touchSettings(ctx, args.workspaceId, {
      templatesSyncedAt: now,
      templatesSyncError: undefined,
    });
    return { count: seen.size };
  },
});

export const noteSyncError = internalMutation({
  args: { workspaceId: v.id("workspaces"), error: v.string() },
  handler: async (ctx, args) => {
    await touchSettings(ctx, args.workspaceId, {
      templatesSyncError: args.error.slice(0, 500),
    });
  },
});

/**
 * An incoming webhook arrived: keep its body as the mapping sample if one is
 * wanted, and queue the send. A mutation rather than the http action scheduling it directly, so
 * the sample and the dispatch are one transaction.
 */
export const acceptInbound = internalMutation({
  args: { inboundKey: v.string(), payload: v.string() },
  handler: async (ctx, args): Promise<"queued" | "disabled" | "unknown"> => {
    const rule = await ctx.db
      .query("notificationRules")
      .withIndex("by_inboundKey", (q) => q.eq("inboundKey", args.inboundKey))
      .unique();
    if (!rule || rule.event !== "inbound") return "unknown";

    let data: unknown = {};
    try {
      data = JSON.parse(args.payload);
    } catch {
      data = {};
    }

    // The first call is the sample, and later ones leave it be until the
    // owner asks for a new one — a mapping made against it should not lose
    // its variables because the next call left a field out.
    const now = Date.now();
    const sample =
      args.payload.length <= MAX_SAMPLE ? args.payload : JSON.stringify(trimSample(data));
    const capture =
      (!rule.lastInboundPayload || rule.inboundCapture === true) && sample.length <= MAX_SAMPLE;
    await ctx.db.patch("notificationRules", rule._id, {
      lastInboundAt: now,
      ...(capture
        ? { lastInboundPayload: sample, inboundSampleAt: now, inboundCapture: undefined }
        : {}),
    });
    // Recorded even when switched off, so the fields can be mapped before the
    // alert is turned on.
    if (!rule.enabled) return "disabled";

    await ctx.scheduler.runAfter(0, internal.notificationsSend.dispatch, {
      workspaceId: rule.workspaceId,
      event: "inbound",
      data,
      ruleId: rule._id,
    });
    return "queued";
  },
});

const resultValidator = v.object({
  ruleId: v.optional(v.id("notificationRules")),
  ruleName: v.optional(v.string()),
  event: v.optional(v.string()),
  channel: channelValidator,
  to: v.string(),
  templateName: v.optional(v.string()),
  subject: v.optional(v.string()),
  preview: v.optional(v.string()),
  status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
  error: v.optional(v.string()),
  messageId: v.optional(v.string()),
  kind: v.optional(v.union(v.literal("test"), v.literal("manual"))),
  /** What Meta approved the template as, for billing. */
  category: v.optional(
    v.union(v.literal("marketing"), v.literal("utility"), v.literal("authentication"))
  ),
});

/**
 * Log a batch of sends, move each rule's counters, charge every delivered
 * WhatsApp message, and write the ones that went to the event's own customer
 * into their thread — so the inbox shows what they were sent and the agent
 * replaying history knows it too.
 */
export const recordResults = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
    results: v.array(resultValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let thread: Doc<"conversations"> | null = null;
    let threadNumber: string | null = null;
    if (args.conversationId) {
      thread = await ctx.db.get("conversations", args.conversationId);
      if (thread && thread.workspaceId === args.workspaceId && thread.channelType === "whatsapp") {
        const contact = await ctx.db.get("contacts", thread.contactId);
        threadNumber = contact?.externalId.replace(/\D/g, "") ?? null;
      } else {
        thread = null;
      }
    }

    const counters = new Map<
      Id<"notificationRules">,
      { sent: number; failed: number; lastError?: string }
    >();

    for (const result of args.results) {
      await ctx.db.insert("notificationLogs", {
        workspaceId: args.workspaceId,
        ruleId: result.ruleId,
        ruleName: result.ruleName,
        event: result.event,
        channel: result.channel,
        to: result.to,
        templateName: result.templateName,
        subject: result.subject?.slice(0, 300),
        preview: result.preview?.slice(0, 600),
        status: result.status,
        error: result.error?.slice(0, 500),
        messageId: result.messageId,
        kind: result.kind,
        createdAt: now,
      });

      if (result.ruleId && !result.kind) {
        const count = counters.get(result.ruleId) ?? { sent: 0, failed: 0 };
        if (result.status === "sent") count.sent++;
        else {
          count.failed++;
          count.lastError = result.error;
        }
        counters.set(result.ruleId, count);
      }

      if (result.status !== "sent" || result.channel !== "whatsapp") continue;

      const toThread = thread !== null && threadNumber === result.to;
      await charge(ctx, {
        workspaceId: args.workspaceId,
        conversationId: toThread ? thread?._id : undefined,
        channelId: args.channelId,
        to: result.to,
        category: result.category ?? "utility",
        source: "notification",
        preview: result.preview,
        templateName: result.templateName,
      });

      if (toThread && thread && result.preview && !result.kind) {
        await ctx.db.insert("messages", {
          workspaceId: args.workspaceId,
          conversationId: thread._id,
          role: "assistant",
          kind: "text",
          text: result.preview,
          createdAt: now,
        });
        thread = {
          ...thread,
          messageCount: thread.messageCount + 1,
          lastMessageAt: now,
        };
        await ctx.db.patch("conversations", thread._id, {
          messageCount: thread.messageCount,
          lastMessageAt: now,
          lastMessagePreview: result.preview.slice(0, 140),
          lastMessageRole: "assistant",
        });
      }
    }

    for (const [ruleId, count] of counters) {
      const rule = await ctx.db.get("notificationRules", ruleId);
      if (!rule) continue;
      await ctx.db.patch("notificationRules", ruleId, {
        sentCount: rule.sentCount + count.sent,
        failedCount: rule.failedCount + count.failed,
        lastFiredAt: now,
        // A clean run clears the last error, so a fixed alert stops looking
        // broken. Skipped sends count as failures here: nothing went out.
        lastError: count.failed > 0 ? count.lastError?.slice(0, 500) : undefined,
      });
    }
    return null;
  },
});
