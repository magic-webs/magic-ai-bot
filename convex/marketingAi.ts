"use node";

/**
 * The marketing desk writing a template.
 *
 * Only drafts: the text comes back to the screen to be read, edited and saved,
 * and then approved in Meta before anything can send. Nothing here reaches a
 * customer, which is why it is a public action the owner calls directly.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateText, Output } from "ai";
import { z } from "zod";
import { aiGateway, gatewayModelId } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";

const draftSchema = z.object({
  name: z
    .string()
    .describe("A short name for the template, two to four words — 'Diwali wishes'."),
  body: z
    .string()
    .describe(
      "The message. Uses {{name}} for the customer's first name and {{business}} for the company, and {{event}} for the occasion when it is a festival. Under 60 words."
    ),
});

const OCCASION_BRIEF: Record<string, string> = {
  birthday: "A birthday wish, sent on the customer's birthday.",
  festival: "A festival greeting, sent to every customer on the day.",
  offer: "A short offer announcement. Only mention what the owner's notes give you.",
  general: "A general message to every customer.",
};

export const draft = action({
  args: {
    workspaceId: v.id("workspaces"),
    occasion: v.union(
      v.literal("birthday"),
      v.literal("festival"),
      v.literal("offer"),
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
      "The message becomes a WhatsApp template, so write the variables literally as {{name}}, {{business}} and {{event}} — never fill them in.",
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
