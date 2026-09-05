"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateText } from "ai";
import { aiGateway, gatewayModelId } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";

/**
 * The agent, answering its owner rather than a customer.
 *
 * Deliberately not `engine.respondAsUser`. That posts a message *as the
 * customer* and runs the agent's real tool loop against a real conversation —
 * so asking "how did today go?" through it would write into someone's thread
 * and could trigger an order. This is a separate, read-only path: it gathers a
 * snapshot of the workspace and asks the model to report on it.
 *
 * Which also means the model here has no tools. It answers from the snapshot
 * or it says it cannot, and the prompt is explicit that inventing a figure is
 * worse than admitting the gap.
 */

export const ask = action({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    question: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ answer: string }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const question = args.question.trim();
    if (!question) throw new Error("Ask a question first.");

    const found = await ctx.runQuery(internal.agents.getInternal, {
      agentId: args.agentId,
    });
    if (!found) throw new Error("Agent not found");
    const { agent } = found;

    /* The question is stored before the model runs, not after. The screen
       renders this thread from a live query, so writing it here is what makes
       it appear the moment it is sent rather than when the reply lands — and
       a question whose answer fails stays on screen, which is what a failed
       send should look like. */
    await ctx.runMutation(internal.assistantDb.append, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      role: "user",
      text: question,
    });

    /* Context read from the thread rather than taken from the caller. Read
       after the write above, so the turn just stored is excluded by slicing it
       off — the model gets the prior turns plus the question, once each. */
    const prior = await ctx.runQuery(internal.assistantDb.recent, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
    });
    const history = prior.slice(0, -1);

    const data = await ctx.runQuery(internal.assistantDb.snapshot, {
      workspaceId: args.workspaceId,
      now: Date.now(),
    });
    if (!data) throw new Error("Workspace not found");

    const who = data.workspace.ownerName ?? data.workspace.name;

    const instructions = [
      `You are ${agent.botName}, ${agent.role} at ${data.workspace.name}.`,
      `You are speaking to ${who}, who runs this business — not to a customer.`,
      "Report on the workspace from the DATA below and nothing else.",
      "",
      "Rules:",
      "- Every number you give must come from the DATA. If it is not there, say so plainly and say what you would need.",
      "- Be brief. Two or three sentences, or a short list. This is read on a phone.",
      "- Lead with the answer, then the detail. No preamble and no sign-off.",
      "- Times in the data are 'minutes ago'. Convert to something readable: '20 minutes ago', 'about 3 hours ago'.",
      `- Money is in ${data.workspace.currency}.`,
      "- You are read-only here. If asked to change or send something, say it has to be done from the console or the conversation itself.",
      "",
      `DATA (as of now, timezone ${data.workspace.timezone}):`,
      JSON.stringify(data, null, 1),
    ].join("\n");

    const result = await generateText({
      model: aiGateway()(gatewayModelId(agent.model || DEFAULT_CHAT_MODEL)),
      instructions,
      messages: [
        ...history.map((turn) => ({
          role: turn.role,
          content: turn.text,
        })),
        { role: "user" as const, content: question },
      ],
      temperature: 0.3,
    });

    await ctx.runMutation(internal.usage.record, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      source: "assistant",
      model: agent.model,
      kind: "chat",
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    });

    const answer = result.text.trim();

    await ctx.runMutation(internal.assistantDb.append, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      role: "assistant",
      text: answer,
    });

    return { answer };
  },
});
