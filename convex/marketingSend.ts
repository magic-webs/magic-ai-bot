// Sends the marketing desk's greetings, a batch at a time.
//
// Default runtime rather than Node: this is fetch and nothing else, and
// calling whatsapp.sendOutbound instead would cross into the Node runtime once
// per contact. The payload itself comes from the same builder the engine uses.

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { buildMessage } from "./lib/whatsappSend";
import { greetingName, renderTemplate } from "./lib/marketing";

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
): Promise<{ ok: boolean; error?: string }> {
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
    if (response.ok) return { ok: true };
    const text = await response.text().catch(() => "");
    return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
    eventTitle: string;
    key: string;
    monthDay?: string;
    cursor: string | null;
    context: {
      workspaceName: string;
      agentId: Id<"agents"> | null;
      template: Doc<"marketingTemplates">;
      channel: Channel;
    };
  }
): Promise<string | null> {
  const page = await ctx.runQuery(internal.marketing.audiencePage, {
    workspaceId: args.workspaceId,
    key: args.key,
    monthDay: args.monthDay,
    cursor: args.cursor,
  });

  const results: Array<{
    contactId: Id<"contacts">;
    ok: boolean;
    text: string;
    error?: string;
  }> = [];
  for (const contact of page.contacts) {
    const { text, parameters } = renderTemplate(args.context.template.body, {
      name: greetingName(contact.name),
      business: args.context.workspaceName,
      event: args.eventTitle,
    });
    const sent = await sendTemplate(
      args.context.channel,
      contact.to,
      args.context.template,
      parameters,
      text
    );
    results.push({ contactId: contact.contactId, text, ...sent });
  }

  await ctx.runMutation(internal.marketing.recordBatch, {
    workspaceId: args.workspaceId,
    eventId: args.eventId,
    key: args.key,
    agentId: args.context.agentId ?? undefined,
    results,
    done: page.isDone,
  });

  return page.isDone ? null : page.continueCursor;
}

/** Why a greeting cannot go out at all, in words the owner can act on. */
function blocker(context: {
  template: Doc<"marketingTemplates"> | null;
  channel: Channel | null;
}): string | null {
  if (!context.template) return "The template was removed.";
  if (!context.template.metaTemplateName) {
    return `"${context.template.name}" is not linked to an approved Meta template yet.`;
  }
  if (!context.channel) return "There is no active WhatsApp channel to send from.";
  return null;
}

export const runEvent = internalAction({
  args: {
    eventId: v.id("marketingEvents"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.marketing.eventContext, {
      eventId: args.eventId,
    });
    if (!context) return null;
    // Removed or finished while this was queued.
    if (context.event.status !== "sending") return null;

    const reason = blocker(context);
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
      eventTitle: context.event.title,
      key: `event:${args.eventId}`,
      cursor: args.cursor ?? null,
      context: {
        workspaceName: context.workspaceName,
        agentId: context.agentId,
        template: context.template,
        channel: context.channel,
      },
    });

    // The next page in a fresh action, so a workspace with thousands of
    // contacts never runs into one action's time limit.
    if (next !== null) {
      await ctx.scheduler.runAfter(0, internal.marketingSend.runEvent, {
        eventId: args.eventId,
        cursor: next,
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

    const reason = blocker(context);
    if (reason || !context.template || !context.channel) {
      console.warn("[marketing] birthdays not sent", args.workspaceId, reason);
      return null;
    }

    const next = await sendPage(ctx, {
      workspaceId: args.workspaceId,
      eventTitle: "your birthday",
      key: args.key,
      monthDay: args.monthDay,
      cursor: args.cursor ?? null,
      context: {
        workspaceName: context.workspaceName,
        agentId: context.agentId,
        template: context.template,
        channel: context.channel,
      },
    });

    if (next !== null) {
      await ctx.scheduler.runAfter(0, internal.marketingSend.runBirthdays, {
        ...args,
        cursor: next,
      });
    }
    return null;
  },
});
