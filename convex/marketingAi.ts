"use node";

/**
 * The marketing desk writing: a template, and the line each of an event's
 * reminders carries.
 *
 * A template is only drafted: the text comes back to the screen to be read,
 * edited and saved, and then approved in Meta before anything can send, which
 * is why `draft` is a public action the owner calls directly.
 *
 * A reminder's line does reach customers — it is the template's {{message}} —
 * so it is written as soon as the event is saved, where the owner can read and
 * change it on the Events tab before its day.
 */

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { z } from "zod";
import { aiGateway, gatewayModelId, gatewayRouting } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";
import { eventDateLabel, touchBrief, touchLabel } from "./lib/marketing";

const draftSchema = z.object({
  name: z
    .string()
    .describe("A short name for the template, two to four words — 'Diwali wishes'."),
  body: z
    .string()
    .describe(
      "The message. Uses {{name}} for the customer's first name and {{business}} for the company, and {{event}} for the occasion when it is a festival or an event. An event's reminder template also carries {{message}} and may use {{date}}. Under 60 words."
    ),
});

const OCCASION_BRIEF: Record<string, string> = {
  birthday: "A birthday wish, sent on the customer's birthday.",
  festival: "A festival greeting, sent to every customer on the day.",
  offer: "A short offer announcement. Only mention what the owner's notes give you.",
  event:
    "The template every reminder for an event goes out with. It must contain {{message}} — a line written fresh for each reminder — and should name {{event}} and {{date}}. Keep the fixed words few: a greeting with {{name}}, the {{message}}, the event and its date, and a sign-off inviting a reply. Never start or end the message with a variable, and never put two variables side by side.",
  general: "A general message to every customer.",
};

export const draft = action({
  args: {
    workspaceId: v.id("workspaces"),
    occasion: v.union(
      v.literal("birthday"),
      v.literal("festival"),
      v.literal("offer"),
      v.literal("event"),
      v.literal("general")
    ),
    /** The festival or event, when there is one — "Diwali". */
    eventTitle: v.optional(v.string()),
    /** Anything the owner wants said: an offer, a tone, a language. */
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ name: string; body: string }> => {
    const { agent, workspace } = await ctx.runMutation(
      internal.marketing.draftContext,
      { workspaceId: args.workspaceId }
    );

    const tone = agent.tone;
    const instructions = [
      `You write marketing messages for ${workspace.name}${
        workspace.industry ? `, ${workspace.industry}` : ""
      }.`,
      workspace.tagline ? `Tagline: ${workspace.tagline}` : "",
      workspace.description ? `About the company: ${workspace.description}` : "",
      "",
      agent.jobDescription,
      `Tone: ${tone.traits.join(", ") || "warm"}; ${tone.formality}; emoji ${tone.emoji}.`,
      tone.languages.length ? `Write in ${tone.languages[0]}.` : "",
      agent.rules.length ? `Always:\n${agent.rules.map((r) => `- ${r}`).join("\n")}` : "",
      agent.guardrails.length
        ? `Never:\n${agent.guardrails.map((r) => `- ${r}`).join("\n")}`
        : "",
      "",
      "The message becomes a WhatsApp template, so write the variables literally — {{name}}, {{business}}, {{event}}, and for an event {{date}} and {{message}} — never fill them in.",
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = [
      OCCASION_BRIEF[args.occasion],
      args.eventTitle?.trim() ? `The occasion: ${args.eventTitle.trim()}.` : "",
      args.notes?.trim() ? `The owner's notes: ${args.notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const model = gatewayModelId(agent.model || DEFAULT_CHAT_MODEL);
    let inputTokens = 0;
    let outputTokens = 0;
    let object: z.infer<typeof draftSchema> | null = null;
    let lastError: unknown = null;

    // A second, blunter attempt, for the same reason the follow-up desk makes
    // one: a cheap model misses the format often enough to matter.
    for (const attempt of [0, 1]) {
      try {
        const result = await generateText({
          model: aiGateway()(model),
          providerOptions: gatewayRouting(model),
          output: Output.object({ schema: draftSchema }),
          instructions:
            attempt === 0
              ? instructions
              : `${instructions}\n\nReturn only the object. No preamble and no markdown fence.`,
          prompt,
          temperature: attempt === 0 ? agent.temperature : 0.5,
        });
        inputTokens += result.usage.inputTokens ?? 0;
        outputTokens += result.usage.outputTokens ?? 0;
        object = result.output;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    await ctx.runMutation(internal.usage.record, {
      workspaceId: args.workspaceId,
      agentId: agent._id,
      source: "draft_marketing",
      model,
      kind: "chat",
      inputTokens,
      outputTokens,
    });

    if (!object) {
      console.error("[marketing] draft failed", lastError);
      throw new Error("The desk could not write a draft just now. Try again.");
    }
    return { name: object.name.trim(), body: object.body.trim() };
  },
});

// --------------------------------------------------------- event reminders

const touchesSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().describe("The reminder's id, exactly as given."),
      message: z
        .string()
        .describe(
          "The line for that reminder: one or two sentences, no greeting, no sign-off, no customer name, no line breaks, under 45 words."
        ),
    })
  ),
});

/**
 * Writes the line for each of an event's reminders that needs one, in one
 * call so the lines read as a sequence rather than five unrelated takes.
 * Returns how many were saved.
 */
async function writeTouchLines(
  ctx: ActionCtx,
  args: {
    campaignId: Id<"marketingCampaigns">;
    eventIds?: Id<"marketingEvents">[];
    overwrite: boolean;
  }
): Promise<number> {
  const context = await ctx.runMutation(
    internal.marketingCampaigns.writingContext,
    args
  );
  if (!context || context.touches.length === 0) return 0;
  const { agent, workspace, campaign } = context;

  const tone = agent.tone;
  const instructions = [
    `You write marketing messages for ${workspace.name}${
      workspace.industry ? `, ${workspace.industry}` : ""
    }.`,
    workspace.description ? `About the company: ${workspace.description}` : "",
    "",
    agent.jobDescription,
    `Tone: ${tone.traits.join(", ") || "warm"}; ${tone.formality}; emoji ${tone.emoji}.`,
    tone.languages.length ? `Write in ${tone.languages[0]}.` : "",
    agent.guardrails.length
      ? `Never:\n${agent.guardrails.map((r) => `- ${r}`).join("\n")}`
      : "",
    "",
    "You are writing the reminders for one event. Each line you write is dropped into an approved WhatsApp template as a single variable, between a greeting to the customer and a sign-off the template already has — so write no greeting, no sign-off and no customer name, and no line breaks.",
    "Each reminder has its own job, set out below. Together they should read as a short sequence to the same customer, not the same line five times.",
    "Only ever state the date, time, place, offer and link you were given. Never invent a price, a discount, a deadline or a detail of the event.",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    `The event: ${campaign.title}`,
    `When: ${eventDateLabel(campaign.date, campaign.startTime ?? undefined, workspace.locale)}`,
    campaign.venue ? `Where: ${campaign.venue}` : "",
    `What it is: ${campaign.details}`,
    campaign.offer ? `The offer, exactly as given: ${campaign.offer}` : "",
    campaign.link ? `Link to include where it helps: ${campaign.link}` : "",
    "",
    "Write the line for each of these reminders:",
    ...context.touches.map(
      (touch) =>
        `- id ${touch.eventId} — ${touchLabel(touch.offsetDays)}, sent on ${eventDateLabel(
          touch.date,
          undefined,
          workspace.locale
        )}. ${touchBrief(touch.offsetDays)}`
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");

  const model = gatewayModelId(agent.model || DEFAULT_CHAT_MODEL);
  let inputTokens = 0;
  let outputTokens = 0;
  let object: z.infer<typeof touchesSchema> | null = null;
  let lastError: unknown = null;

  for (const attempt of [0, 1]) {
    try {
      const result = await generateText({
        model: aiGateway()(model),
        providerOptions: gatewayRouting(model),
        output: Output.object({ schema: touchesSchema }),
        instructions:
          attempt === 0
            ? instructions
            : `${instructions}\n\nReturn only the object. No preamble and no markdown fence.`,
        prompt,
        temperature: attempt === 0 ? agent.temperature : 0.5,
      });
      inputTokens += result.usage.inputTokens ?? 0;
      outputTokens += result.usage.outputTokens ?? 0;
      object = result.output;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  await ctx.runMutation(internal.usage.record, {
    workspaceId: workspace._id,
    agentId: agent._id,
    source: "draft_marketing",
    model,
    kind: "chat",
    inputTokens,
    outputTokens,
  });

  if (!object) {
    console.error("[marketing] reminder lines failed", lastError);
    return 0;
  }

  // Only ids that were asked for: a model that invents one, or repeats one,
  // cannot write into a reminder it was not given.
  const wanted = new Map(
    context.touches.map((touch) => [touch.eventId as string, touch.eventId])
  );
  const messages = object.messages.flatMap((row) => {
    const eventId = wanted.get(row.id.trim());
    return eventId && row.message.trim() ? [{ eventId, message: row.message }] : [];
  });
  if (messages.length === 0) return 0;

  const { saved } = await ctx.runMutation(internal.marketingCampaigns.saveMessages, {
    messages,
    overwrite: args.overwrite,
  });
  return saved;
}

/** Run when an event is saved, and by the sender for a reminder with no line. */
export const writeTouches = internalAction({
  args: {
    campaignId: v.id("marketingCampaigns"),
    eventIds: v.optional(v.array(v.id("marketingEvents"))),
    overwrite: v.boolean(),
  },
  handler: async (ctx, args): Promise<number> => {
    return await writeTouchLines(ctx, args);
  },
});

/** "Rewrite" on the Events tab: every reminder still to go, or just one. */
export const rewriteTouches = action({
  args: {
    campaignId: v.id("marketingCampaigns"),
    eventId: v.optional(v.id("marketingEvents")),
  },
  handler: async (ctx, args): Promise<{ written: number }> => {
    await ctx.runQuery(internal.marketingCampaigns.access, {
      campaignId: args.campaignId,
    });
    const written = await writeTouchLines(ctx, {
      campaignId: args.campaignId,
      eventIds: args.eventId ? [args.eventId] : undefined,
      overwrite: true,
    });
    if (written === 0) {
      throw new Error("The desk could not write them just now. Try again.");
    }
    return { written };
  },
});
