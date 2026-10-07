// Sends the marketing desk's greetings, a batch at a time.
//
// Default runtime rather than Node: this is fetch and nothing else, and
// calling whatsapp.sendOutbound instead would cross into the Node runtime once
// per contact. The payload itself comes from the same builder the engine uses.

import { ConvexError, v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { buildMessage, providerMessageId } from "./lib/whatsappSend";
import {
  asParameter,
  eventDateLabel,
  greetingName,
  missingVariables,
  renderTemplate,
  sampleValues,
  templateBlocker,
  type TemplateVariable,
} from "./lib/marketing";
import type { AudienceSelection } from "./lib/audience";
import { slug, trackFirstLink } from "./lib/links";
import { errorText, providerError } from "./lib/panel";
import { publicSiteUrl } from "./lib/publicUrl";

/** Every variable but the customer's own name, which is filled per contact. */
type SharedValues = Omit<Record<TemplateVariable, string>, "name">;

type Channel = {
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
};

async function sendTemplate(
  channel: Channel,
  to: string,
  template: Doc<"marketingTemplates">,
  parameters: string[],
  preview: string
): Promise<{ ok: boolean; error?: string; wamid?: string }> {
  const url = `${channel.apiBaseUrl.replace(/\/$/, "")}/${channel.apiVersion}/${channel.phoneNumberId}/messages`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channel.accessToken}`,
      },
      body: JSON.stringify(
        buildMessage(to, {
          kind: "template",
          templateName: template.metaTemplateName!,
          languageCode: template.languageCode,
          bodyVariables: parameters,
          preview,
        })
      ),
    });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: true, wamid: providerMessageId(body) };
    }
    const text = await response.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { ok: false, error: providerError(response.status, body, text) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/**
 * One page: read who is due, send to each, record the lot. Returns the cursor
 * to carry on from, or null once the audience is exhausted.
 */
async function sendPage(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    eventId?: Id<"marketingEvents">;
    values: SharedValues;
    key: string;
    monthDay?: string;
    audience?: AudienceSelection;
    campaignId?: Id<"marketingCampaigns">;
    guestSegment?: Doc<"marketingEvents">["guestSegment"];
    track?: string;
    cursor: string | null;
    context: {
      workspaceName: string;
      agentId: Id<"agents"> | null;
      channelId: Id<"channels"> | null;
      entryAgentId: Id<"agents"> | null;
      template: Doc<"marketingTemplates">;
      channel: Channel;
    };
  }
): Promise<{ cursor: string; sent: number } | null> {
  const page = await ctx.runQuery(internal.marketing.audiencePage, {
    workspaceId: args.workspaceId,
    key: args.key,
    monthDay: args.monthDay,
    audience: args.audience,
    campaignId: args.campaignId,
    guestSegment: args.guestSegment,
    now: Date.now(),
    cursor: args.cursor,
  });

  const results: Array<{
    contactId: Id<"contacts">;
    to: string;
    ok: boolean;
    text: string;
    error?: string;
    wamid?: string;
    linkCode?: string;
    linkTarget?: string;
  }> = [];
  const base = process.env.TRACKING_BASE_URL ?? publicSiteUrl();
  for (const contact of page.contacts) {
    const rendered = renderTemplate(args.context.template.body, {
      ...args.values,
      name: greetingName(contact.name),
    });
    const { text, parameters, code, target }: ReturnType<typeof trackFirstLink> =
      args.track && base
        ? trackFirstLink(rendered.parameters, rendered.text, base, args.track)
        : rendered;
    const sent = await sendTemplate(
      args.context.channel,
      contact.to,
      args.context.template,
      parameters,
      text
    );
    results.push({
      contactId: contact.contactId,
      to: contact.to,
      text,
      ...sent,
      linkCode: code,
      linkTarget: target,
    });
  }

  await ctx.runMutation(internal.marketing.recordBatch, {
    workspaceId: args.workspaceId,
    eventId: args.eventId,
    key: args.key,
    agentId: args.context.agentId ?? undefined,
    channelId: args.context.channelId ?? undefined,
    entryAgentId: args.context.entryAgentId ?? undefined,
    // Billed at what Meta approved the template as. A template saved before
    // it had a category was a greeting, and greetings are marketing.
    category: args.context.template.category ?? "marketing",
    templateName: args.context.template.metaTemplateName,
    results,
    skipped: page.skipped,
    nextCursor: page.isDone ? null : page.continueCursor,
    done: page.isDone,
  });

  return page.isDone ? null : { cursor: page.continueCursor, sent: results.length };
}

/** Why a greeting cannot go out at all, in words the owner can act on. */
function blocker(context: {
  template: Doc<"marketingTemplates"> | null;
  channel: Channel | null;
  walletBlock: string | null;
}): string | null {
  if (!context.template) return "The template was removed.";
  // Not applied, still in review, rejected, or edited since it was approved.
  const unapproved = templateBlocker(context.template);
  if (unapproved) return unapproved;
  if (!context.channel) return "There is no active WhatsApp channel to send from.";
  return context.walletBlock;
}

const MESSAGE_VARIABLE = /\{\{\s*message\s*\}\}/;

/**
 * What a calendar entry fills the template with. A reminder speaks for its
 * event — the event's name, day, time and venue, and the line the desk wrote
 * for this reminder — while a plain entry has only its own title and day.
 */
function eventValues(context: {
  workspaceName: string;
  locale: string;
  event: Doc<"marketingEvents">;
  campaign: Doc<"marketingCampaigns"> | null;
}): SharedValues {
  const { event, campaign } = context;
  return {
    business: context.workspaceName,
    event: asParameter(campaign?.title ?? event.title),
    date: eventDateLabel(
      campaign?.date ?? event.date,
      campaign?.startTime,
      context.locale
    ),
    venue: asParameter(campaign?.venue ?? ""),
    message: asParameter(event.message ?? event.note ?? ""),
  };
}

/**
 * Why the template cannot be filled for this send, if it cannot: Meta refuses
 * an empty parameter, so a {{venue}} with no venue is caught here once rather
 * than failing for every contact.
 */
function unfilled(body: string, values: SharedValues): string | null {
  const missing = missingVariables(body, { ...values, name: "there" });
  if (missing.length === 0) return null;
  const names = missing.map((name) => `{{${name}}}`).join(" and ");
  return missing.includes("message")
    ? `The template uses ${names}, and this has no message written for it yet.`
    : `The template uses ${names}, which this has nothing to fill with.`;
}

export const runEvent = internalAction({
  args: {
    eventId: v.id("marketingEvents"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<null> => {
    let context = await ctx.runQuery(internal.marketing.eventContext, {
      eventId: args.eventId,
    });
    if (!context) return null;
    // Removed or finished while this was queued.
    if (context.event.status !== "sending") return null;

    // A reminder whose line the desk has not managed to write yet — the
    // write on save failed, or it was sent early by hand — gets it now, on
    // the first page, before anyone is sent a template with a hole in it.
    const firstPage = (args.cursor ?? null) === null;
    if (
      firstPage &&
      context.event.campaignId &&
      !context.event.message &&
      context.template &&
      MESSAGE_VARIABLE.test(context.template.body)
    ) {
      await ctx.runAction(internal.marketingAi.writeTouches, {
        campaignId: context.event.campaignId,
        eventIds: [args.eventId],
        overwrite: false,
      });
      context = await ctx.runQuery(internal.marketing.eventContext, {
        eventId: args.eventId,
      });
      if (!context || context.event.status !== "sending") return null;
    }

    const values = eventValues(context);
    const reason =
      blocker(context) ??
      (context.template ? unfilled(context.template.body, values) : null);
    if (reason || !context.template || !context.channel) {
      await ctx.runMutation(internal.marketing.failEvent, {
        eventId: args.eventId,
        error: reason ?? "Nothing to send.",
      });
      return null;
    }

    const next = await sendPage(ctx, {
      workspaceId: context.event.workspaceId,
      eventId: args.eventId,
      values,
      key: `event:${args.eventId}`,
      audience: context.event.audience ?? context.campaign?.audience,
      campaignId: context.event.campaignId,
      guestSegment: context.event.guestSegment,
      track:
        context.event.trackLinks || context.event.campaignId
          ? slug(context.campaign?.title ?? context.event.title)
          : undefined,
      cursor: args.cursor ?? null,
      context: {
        workspaceName: context.workspaceName,
        agentId: context.agentId,
        channelId: context.channelId,
        entryAgentId: context.entryAgentId,
        template: context.template,
        channel: context.channel,
      },
    });

    // The next page in a fresh action, so a workspace with thousands of
    // contacts never runs into one action's time limit.
    if (next !== null) {
      const rate = context.event.ratePerMinute;
      const delay = rate ? Math.round((next.sent / rate) * 60_000) : 0;
      await ctx.scheduler.runAfter(delay, internal.marketingSend.runEvent, {
        eventId: args.eventId,
        cursor: next.cursor,
      });
    }
    return null;
  },
});

export const runBirthdays = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    monthDay: v.string(),
    key: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.marketing.birthdayContext, {
      workspaceId: args.workspaceId,
    });
    if (!context) return null;

    const values: SharedValues = {
      business: context.workspaceName,
      event: "your birthday",
      date: "",
      venue: "",
      message: "",
    };
    const reason =
      blocker(context) ??
      (context.template ? unfilled(context.template.body, values) : null);
    if (reason || !context.template || !context.channel) {
      console.warn("[marketing] birthdays not sent", args.workspaceId, reason);
      return null;
    }

    const next = await sendPage(ctx, {
      workspaceId: args.workspaceId,
      values,
      key: args.key,
      monthDay: args.monthDay,
      cursor: args.cursor ?? null,
      context: {
        workspaceName: context.workspaceName,
        agentId: context.agentId,
        channelId: context.channelId,
        entryAgentId: context.entryAgentId,
        template: context.template,
        channel: context.channel,
      },
    });

    if (next !== null) {
      await ctx.scheduler.runAfter(0, internal.marketingSend.runBirthdays, {
        ...args,
        cursor: next.cursor,
      });
    }
    return null;
  },
});

/**
 * Sends one greeting, reminder or template to one number, to see it as a
 * customer will before everyone does.
 *
 * The same message the real send makes — same checks, same variables, the
 * reminder's line written first if it has none — to that number alone. It is
 * a real template message, so it is billed; it is not logged as a send of the
 * entry, so the number still gets the real one.
 */
export const sendTest = action({
  args: {
    to: v.string(),
    countryCode: v.optional(v.string()),
    eventId: v.optional(v.id("marketingEvents")),
    templateId: v.optional(v.id("marketingTemplates")),
  },
  handler: async (ctx, args): Promise<{ to: string; text: string }> => {
    if (!args.eventId && !args.templateId) {
      throw new ConvexError("Say what to test: a calendar entry or a template.");
    }
    let context = await ctx.runQuery(internal.marketing.testContext, args);

    if (
      context.event?.campaignId &&
      !context.event.message &&
      context.template &&
      MESSAGE_VARIABLE.test(context.template.body)
    ) {
      await ctx.runAction(internal.marketingAi.writeTouches, {
        campaignId: context.event.campaignId,
        eventIds: [context.event._id],
        overwrite: false,
      });
      context = await ctx.runQuery(internal.marketing.testContext, args);
    }

    if (!context.to) {
      throw new ConvexError(
        "That is not a WhatsApp number. Write it with its country code, or the way you would dial it."
      );
    }
    const template = context.template;
    // A template on its own has no event behind it, so its blanks get the
    // same samples Meta reviewed it with.
    const samples = sampleValues(context.workspaceName, template?.occasion);
    const values: SharedValues = context.event
      ? eventValues({ ...context, event: context.event })
      : {
          business: samples.business,
          event: samples.event,
          date: samples.date,
          venue: samples.venue,
          message: samples.message,
        };
    const reason =
      blocker(context) ?? (template ? unfilled(template.body, values) : null);
    if (reason || !template || !context.channel) {
      throw new ConvexError(reason ?? "Nothing to send.");
    }

    const { text, parameters } = renderTemplate(template.body, {
      ...values,
      name: greetingName(context.contactName ?? undefined),
    });
    const sent = await sendTemplate(context.channel, context.to, template, parameters, text);
    if (!sent.ok) throw new ConvexError(`WhatsApp did not accept it — ${sent.error}`);

    await ctx.runMutation(internal.marketing.recordTest, {
      workspaceId: context.workspaceId,
      to: context.to,
      category: template.category ?? "marketing",
      text,
      templateName: template.metaTemplateName,
      wamid: sent.wamid,
      contactId: context.contactId ?? undefined,
      agentId: context.agentId ?? undefined,
      channelId: context.channelId ?? undefined,
      entryAgentId: context.entryAgentId ?? undefined,
    });
    return { to: context.to, text };
  },
});
