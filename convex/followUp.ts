"use node";

/**
 * The follow-up desk.
 *
 * One per workspace, alongside the front desk, and the only agent that is not
 * part of a conversation. It reads threads that have gone quiet and decides two
 * things: which lead stage the conversation actually reached, and whether a
 * single follow-up message is worth sending.
 *
 * The loop, end to end:
 *
 *   customer goes quiet
 *     -> a cron sweep finds the thread an hour later (convex/crons.ts)
 *     -> review(): file it at a stage, and nudge if it is worth nudging
 *     -> customer replies, the ordinary engine answers, the thread lives again
 *     -> goes quiet again -> reviewed again, stage updated
 *
 * A thread is only ever due when the customer has spoken since the last
 * review, which is what stops the same silence being nudged twice.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateObject } from "ai";
import { z } from "zod";
import { aiGateway, gatewayModelId } from "./lib/gateway";
import {
  DEFAULT_CHAT_MODEL,
  WHATSAPP_FREE_FORM_WINDOW_HOURS,
} from "./lib/shared";

const reviewSchema = z.object({
  stage: z
    .string()
    .describe(
      "The name of the stage this conversation has reached, copied exactly from the list given"
    ),
  reason: z
    .string()
    .describe(
      "Why it belongs there, in at most twelve words. Name only what decided it — 'size and colour agreed, quantity still open'. Do not restate the stage name, do not reason aloud, do not write a sentence about the customer."
    ),
  sendFollowUp: z
    .boolean()
    .describe(
      "True only if a single message could plausibly move this forward. False when they got what they needed, said no, or are waiting on the team."
    ),
  // nullable as well as optional. A strict structured output expresses
  // "nothing here" as null, not by leaving the key out — the same thing
  // convex/ai.ts notes about its own draft schemas — and .optional() alone
  // rejects null, which failed every review of a finished conversation.
  followUpMessage: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The message to send, or null when sendFollowUp is false. One or two sentences, naming the specific thing left open."
    ),
});

/**
 * Finds what has gone quiet and schedules a review for each.
 *
 * Staggered rather than fired at once: a workspace that goes quiet all at
 * evening close would otherwise put its whole day through the gateway in the
 * same second.
 */
export const sweep = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const due: Array<{
      conversationId: Id<"conversations">;
      workspaceId: Id<"workspaces">;
    }> = await ctx.runQuery(internal.leads.dueForReview, {
      now: Date.now(),
      limit: args.limit ?? 25,
    });

    for (const [index, row] of due.entries()) {
      await ctx.scheduler.runAfter(index * 1500, internal.followUp.review, row);
    }
    return { scheduled: due.length };
  },
});

export const review = internalAction({
  args: {
    conversationId: v.id("conversations"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ reviewed: boolean; stage?: string; followedUp?: boolean; reason?: string }> => {
    const context = await ctx.runQuery(internal.leads.reviewContext, {
      conversationId: args.conversationId,
    });
    if (!context) return { reviewed: false, reason: "conversation_missing" };
    if (context.stages.length === 0) {
      // Nothing to file it at. Not an error: a workspace that has deleted every
      // stage has opted out of the pipeline.
      return { reviewed: false, reason: "no_stages" };
    }
    if (context.transcript.length === 0) {
      return { reviewed: false, reason: "nothing_said" };
    }

    const { workspace, deskAgent } = context;
    const now = Date.now();

    // --- Can a follow-up even be sent? ------------------------------------
    // Worked out before the model is asked, so the prompt can tell it not to
    // bother writing one it cannot send.
    const budgetLeft = context.followUpCount < context.maxFollowUps;
    const windowOpen =
      context.channelType !== "whatsapp" ||
      (context.lastInboundAt !== null &&
        now - context.lastInboundAt <
          WHATSAPP_FREE_FORM_WINDOW_HOURS * 60 * 60_000);
    const deliverable =
      budgetLeft &&
      windowOpen &&
      (context.channelType !== "whatsapp" ||
        (context.channelActive && Boolean(context.channelId)));

    const stageList = context.stages
      .map(
        (stage) =>
          `- ${stage.name} [${stage.outcome}]: ${stage.description}`
      )
      .join("\n");

    const system = [
      `You review finished conversations for ${workspace.name}${
        workspace.industry ? `, ${workspace.industry}` : ""
      }.`,
      workspace.description ? `About the company: ${workspace.description}` : "",
      "",
      deskAgent?.jobDescription ?? "",
      deskAgent?.rules?.length
        ? `Always:\n${deskAgent.rules.map((r) => `- ${r}`).join("\n")}`
        : "",
      deskAgent?.guardrails?.length
        ? `Never:\n${deskAgent.guardrails.map((r) => `- ${r}`).join("\n")}`
        : "",
      "",
      "The pipeline, in order. Judge against these descriptions and nothing else:",
      stageList,
      "",
      "Pick the furthest stage the conversation actually reached — not the one you hope it reaches, and not the next one along.",
      deliverable
        ? "If a follow-up is worth sending, write it as the company's assistant speaking to the customer directly. Reference what they actually said."
        : "A follow-up cannot be sent on this conversation, so set sendFollowUp to false and leave followUpMessage empty. Still file the stage.",
    ]
      .filter(Boolean)
      .join("\n");

    const transcript = context.transcript
      .map(
        (row) =>
          `${row.role === "user" ? context.contactName ?? "Customer" : "Assistant"}: ${row.text}`
      )
      .join("\n");

    const model = gatewayModelId(deskAgent?.model ?? DEFAULT_CHAT_MODEL);

    const prompt = [
      `This conversation has had no reply for ${Math.round(
        (now - (context.lastInboundAt ?? now)) / 60_000
      )} minutes.`,
      "",
      transcript,
    ].join("\n");

    let decision: z.infer<typeof reviewSchema>;
    try {
      // Twice, because a cheap fast model returns something unparseable often
      // enough to matter — about one review in five here — and almost always
      // parses on a second sample. The retry is blunter about the format and
      // hotter, so it is not simply the same generation again.
      let object: z.infer<typeof reviewSchema> | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let lastError: unknown = null;

      for (const attempt of [0, 1]) {
        try {
          const result = await generateObject({
            model: aiGateway()(model),
            schema: reviewSchema,
            system:
              attempt === 0
                ? system
                : `${system}\n\nReturn only the object. No preamble, no commentary outside the fields, and no markdown fence around it.`,
            prompt,
            temperature: attempt === 0 ? (deskAgent?.temperature ?? 0.2) : 0.5,
          });
          object = result.object;
          inputTokens += result.usage?.inputTokens ?? 0;
          outputTokens += result.usage?.outputTokens ?? 0;
          break;
        } catch (attemptError) {
          lastError = attemptError;
        }
      }

      // Recorded whether or not it parsed: the tokens were spent either way,
      // and a review that cost twice is exactly what a cost page should show.
      if (inputTokens > 0 || outputTokens > 0) {
        await ctx.runMutation(internal.usage.record, {
          workspaceId: args.workspaceId,
          agentId: deskAgent?._id,
          conversationId: args.conversationId,
          source: "review",
          channelType: context.channelType,
          model,
          kind: "chat",
          inputTokens,
          outputTokens,
        });
      }

      if (!object) throw lastError ?? new Error("No object generated.");
      decision = object;
    } catch (error) {
      // A failed review must not leave the thread due forever, or the sweep
      // retries it every fifteen minutes. It is stamped as read and picked up
      // again the next time the customer speaks.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[followUp] review failed", message);
      await ctx.runMutation(internal.leads.recordReview, {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        note: `Review failed: ${message}`,
        reviewedAt: now,
      });
      return { reviewed: false, reason: "model_failed" };
    }

    // --- File it ----------------------------------------------------------
    // Models paraphrase a name back: "new enquiries", "Quote sent",
    // "negotiation". Compared on letters and digits alone, and in both
    // directions, because a review that lands nowhere leaves the lead unfiled
    // and looks like the desk did nothing.
    const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wanted = key(decision.stage);
    const stage =
      context.stages.find((s) => key(s.name) === wanted) ??
      (wanted.length >= 4
        ? (context.stages.find((s) => key(s.name).includes(wanted)) ??
          context.stages.find((s) => wanted.includes(key(s.name))))
        : undefined) ??
      null;

    // Nothing is chased once it is won or lost, whatever the model wrote.
    const terminal = stage?.outcome !== "open";
    const followUpText = (decision.followUpMessage ?? "").trim();
    const shouldSend =
      deliverable && decision.sendFollowUp && !terminal && followUpText.length > 0;

    let followedUp = false;
    if (shouldSend) {
      if (context.channelType === "whatsapp" && context.channelId && context.externalId) {
        const sent: { ok: boolean; error?: string } = await ctx.runAction(
          internal.whatsapp.sendOutbound,
          {
            channelId: context.channelId,
            to: context.externalId,
            message: { kind: "text", body: followUpText },
          }
        );
        followedUp = sent.ok;
      } else {
        // On the web widget there is nothing to post to: recording the message
        // is the delivery, and the visitor's open subscription renders it.
        followedUp = true;
      }

      if (followedUp) {
        await ctx.runMutation(internal.leads.recordFollowUp, {
          workspaceId: args.workspaceId,
          conversationId: args.conversationId,
          agentId: deskAgent?._id,
          text: followUpText,
        });
      }
    }

    const outcomeLine = followedUp
      ? "Nudged."
      : decision.sendFollowUp && !deliverable
        ? budgetLeft
          ? "Not nudged: past the 24-hour WhatsApp window."
          : "Not nudged: both nudges already used."
        : decision.sendFollowUp && terminal
          ? "Not nudged: stage is closed."
          : "No nudge needed.";

    const reason = decision.reason.trim().replace(/\.$/, "");
    const note = [
      stage ? stage.name : `Unmatched ("${decision.stage}")`,
      reason ? `— ${reason}` : null,
      `· ${outcomeLine}`,
    ]
      .filter(Boolean)
      .join(" ");

    await ctx.runMutation(internal.leads.recordReview, {
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
      stageId: stage?.id,
      note,
      reviewedAt: now,
      followedUp,
    });

    if (followedUp && context.contactId) {
      await ctx.runMutation(internal.leads.setContactRemark, {
        contactId: context.contactId,
        remark: `Followed up ${
          stage ? `at ${stage.name}` : ""
        }: ${reason || "conversation had gone quiet"}.`.replace(/\s+/g, " "),
      });
    }

    return { reviewed: true, stage: stage?.name, followedUp };
  },
});
