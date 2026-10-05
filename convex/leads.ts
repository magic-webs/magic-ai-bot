/**
 * The lead pipeline: the stages a workspace files conversations into, and the
 * sweep that finds the ones which have gone quiet.
 *
 * The reading and the writing of a review live in convex/followUp.ts, which
 * runs in the Node runtime because it calls a model. Everything here is
 * database work, so it stays in the default runtime where queries are cheap.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { historyText, type Outbound } from "./lib/whatsappSend";
import { recordAgentReply } from "./lib/agentStats";
import { noteMessage } from "./lib/inbox";
import {
  DEFAULT_LEAD_STAGES,
  DORMANT_AFTER_MINUTES,
  MAX_FOLLOW_UPS,
} from "./lib/shared";
import {
  requireConversation,
  requireWorkspace,
} from "./lib/auth";
import { noteSent } from "./lib/delivery";

const outcome = v.union(v.literal("open"), v.literal("won"), v.literal("lost"));

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * Seed the default pipeline. Idempotent: a workspace that already has stages is
 * left alone, so this is safe to call on every workspace read and safe to call
 * again after someone has renamed everything.
 */
async function ensureStages(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<{ created: number }> {
  const existing = await ctx.db
    .query("leadStages")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(1);
  if (existing.length > 0) return { created: 0 };

  const now = Date.now();
  for (const [index, seed] of DEFAULT_LEAD_STAGES.entries()) {
    await ctx.db.insert("leadStages", {
      workspaceId,
      name: seed.name,
      description: seed.description,
      // Tens, so a stage can be dropped between two without renumbering.
      position: (index + 1) * 10,
      outcome: seed.outcome,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { created: DEFAULT_LEAD_STAGES.length };
}

export const ensureDefaultStages = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ensureStages(ctx, args.workspaceId);
  },
});

export const ensureDefaultStagesInternal = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => await ensureStages(ctx, args.workspaceId),
});

/** Just the stages' names, in pipeline order, for pickers. */
export const stageNames = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const stages = await ctx.db
      .query("leadStages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(100);
    return stages
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({ _id: stage._id, name: stage.name }));
  },
});

export const listStages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const stages = await ctx.db
      .query("leadStages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const counts = new Map<string, number>();
    for (const row of conversations) {
      if (!row.leadStageId) continue;
      counts.set(row.leadStageId, (counts.get(row.leadStageId) ?? 0) + 1);
    }

    return stages
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({ ...stage, leadCount: counts.get(stage._id) ?? 0 }));
  },
});

export const createStage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.string(),
    outcome: v.optional(outcome),
    /** Omit to add it at the end of the pipeline. */
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const name = args.name.trim();
    if (!name) throw new Error("A stage needs a name.");
    if (!args.description.trim()) {
      throw new Error(
        "A stage needs a description — it is what the follow-up desk matches a conversation against."
      );
    }

    const stages = await ctx.db
      .query("leadStages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    if (stages.some((stage) => stage.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`There is already a stage called "${name}".`);
    }

    const last = Math.max(0, ...stages.map((stage) => stage.position));
    const now = Date.now();
    return await ctx.db.insert("leadStages", {
      workspaceId: args.workspaceId,
      name,
      description: args.description.trim(),
      position: args.position ?? last + 10,
      outcome: args.outcome ?? "open",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStage = mutation({
  args: {
    stageId: v.id("leadStages"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    position: v.optional(v.number()),
    outcome: v.optional(outcome),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db.get("leadStages", args.stageId);
    if (!stage) throw new Error("Stage not found");
    await requireWorkspace(ctx, stage.workspaceId);

    const { stageId, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      patch[key] = typeof value === "string" ? value.trim() : value;
    }
    await ctx.db.patch(stageId, patch);
    return { success: true };
  },
});

export const removeStage = mutation({
  args: { stageId: v.id("leadStages") },
  handler: async (ctx, args) => {
    const stage = await ctx.db.get("leadStages", args.stageId);
    if (!stage) return { success: true, cleared: 0 };
    await requireWorkspace(ctx, stage.workspaceId);

    // Conversations filed here lose their stage rather than dangle. They fall
    // back to unfiled, and the next review picks them up again.
    const filed = await ctx.db
      .query("conversations")
      .withIndex("by_workspace_stage", (q) =>
        q.eq("workspaceId", stage.workspaceId).eq("leadStageId", args.stageId)
      )
      .collect();
    for (const row of filed) {
      await ctx.db.patch(row._id, {
        leadStageId: undefined,
        leadStageNote: undefined,
      });
    }

    await ctx.db.delete(args.stageId);
    return { success: true, cleared: filed.length };
  },
});

// ---------------------------------------------------------------------------
// The pipeline view
// ---------------------------------------------------------------------------

export const pipeline = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(args.limit ?? 300);

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const botNames = new Map(agents.map((a) => [a._id as string, a.botName]));

    const out = [];
    for (const row of rows) {
      const contact = await ctx.db.get("contacts", row.contactId);
      out.push({
        conversationId: row._id,
        leadStageId: row.leadStageId ?? null,
        leadStageNote: row.leadStageNote ?? null,
        leadStagePinned: row.leadStagePinned ?? false,
        reviewedAt: row.reviewedAt ?? null,
        followUpCount: row.followUpCount ?? 0,
        status: row.status,
        channelType: row.channelType,
        messageCount: row.messageCount,
        lastMessageAt: row.lastMessageAt,
        lastMessagePreview: row.lastMessagePreview ?? null,
        handledBy: botNames.get(row.activeAgentId ?? row.agentId) ?? null,
        contactLabel:
          contact?.name ?? contact?.phone ?? contact?.externalId ?? "Unknown",
        contactCompany: contact?.company ?? null,
        remark: contact?.remark ?? null,
      });
    }
    return out;
  },
});

/** Filing a lead by hand. Pinned, so the next review will not overrule it. */
export const setStage = mutation({
  args: {
    conversationId: v.id("conversations"),
    stageId: v.optional(v.id("leadStages")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.conversationId);
    await ctx.db.patch(args.conversationId, {
      leadStageId: args.stageId,
      leadStageNote: args.note?.trim() || undefined,
      // A person overrode it, so the desk stops deciding this one. Clearing
      // the stage clears the pin too: that reads as "start judging it again".
      leadStagePinned: Boolean(args.stageId),
    });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Conversations that have gone quiet since anyone last looked at them.
 *
 * `reviewedAt < lastMessageAt` is the whole trick: a thread is due when the
 * customer has spoken since the last review, and stops being due the moment it
 * is reviewed. Without that comparison the same silence would be re-reviewed —
 * and re-nudged — on every sweep.
 */
export const dueForReview = internalQuery({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.now - DORMANT_AFTER_MINUTES * 60_000;

    // The most recently quiet conversations first, across the deployment, in
    // one index range — and capped: a sweep is a background job and must not
    // become a full table read. Threads the marketing desk opened that nobody
    // has answered (`marketingOnly`) sit outside the range altogether, so a
    // campaign opening thousands of them cannot crowd a real conversation out
    // of the window, nor have a greeting filed as a lead.
    //
    // It used to read the first 2,000 rows of by_workspace_lastMessageAt,
    // which is the first few workspaces by id: past 2,000 conversations the
    // rest were never reviewed at all.
    const candidates = await ctx.db
      .query("conversations")
      .withIndex("by_marketingOnly_and_lastMessageAt", (q) =>
        q.eq("marketingOnly", undefined).lte("lastMessageAt", cutoff)
      )
      .order("desc")
      .take(2000);

    const due: Array<{
      conversationId: Id<"conversations">;
      workspaceId: Id<"workspaces">;
    }> = [];

    for (const row of candidates) {
      if (due.length >= (args.limit ?? 25)) break;
      // Escalated belongs to a person and closed is finished; neither wants a
      // machine writing into it.
      if (row.status !== "open") continue;
      if (row.markedBot) continue;
      if ((row.reviewedAt ?? 0) >= row.lastMessageAt) continue;
      if (row.messageCount === 0) continue;
      due.push({ conversationId: row._id, workspaceId: row.workspaceId });
    }

    return due;
  },
});

/**
 * Everything a review needs, in one read: the transcript, the pipeline, the
 * desk, and the facts that decide whether a nudge is even allowed.
 */
export const reviewContext = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return null;

    const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
    if (!workspace) return null;

    const desk = await ctx.db
      .query("agents")
      .withIndex("by_workspace_kind", (q) =>
        q.eq("workspaceId", conversation.workspaceId).eq("kind", "follow_up")
      )
      .first();

    const stages = (
      await ctx.db
        .query("leadStages")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", conversation.workspaceId)
        )
        .collect()
    ).sort((a, b) => a.position - b.position);

    const rows = (
      await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", args.conversationId)
        )
        .order("desc")
        .take(80)
    ).reverse();

    const contact = await ctx.db.get("contacts", conversation.contactId);
    const channel = conversation.channelId
      ? await ctx.db.get("channels", conversation.channelId)
      : null;

    // The last thing the customer actually said. On WhatsApp the free-form
    // window is measured from that, not from the last message overall — our own
    // follow-up does not reopen it.
    const lastInboundAt = [...rows]
      .reverse()
      .find((row) => row.role === "user")?.createdAt;

    return {
      workspace,
      deskAgent: desk,
      stages: stages.map((stage) => ({
        id: stage._id,
        name: stage.name,
        description: stage.description,
        outcome: stage.outcome,
      })),
      transcript: rows
        .filter(
          (row) =>
            (row.kind === "text" || row.kind === "rich") &&
            (row.role === "user" || row.role === "assistant")
        )
        .map((row) => ({
          role: row.role as "user" | "assistant",
          // Clamped as well as cleaned: a long thread of long messages is both
          // dearer to review and likelier to come back malformed.
          text: (richText(row.kind, row.payload) ?? row.text ?? "").slice(0, 600),
        }))
        .filter((row) => row.text.length > 0)
        // The last forty turns are plenty to judge a stage on.
        .slice(-40),
      contactId: conversation.contactId,
      contactName: contact?.name ?? null,
      channelId: channel?._id ?? null,
      channelType: conversation.channelType,
      channelActive: channel?.status === "active",
      externalId: contact?.externalId ?? null,
      followUpCount: conversation.followUpCount ?? 0,
      maxFollowUps: MAX_FOLLOW_UPS,
      lastInboundAt: lastInboundAt ?? null,
      stagePinned: conversation.leadStagePinned ?? false,
      currentStageId: conversation.leadStageId ?? null,
    };
  },
});

/** A rich row as the customer read it, without the transcript's bracketed options. */
function richText(kind: string, payload: string | undefined): string | null {
  if (kind !== "rich" || !payload) return null;
  try {
    return historyText(JSON.parse(payload) as Outbound);
  } catch {
    return null;
  }
}

/** Files the outcome of a review and logs why, on the conversation's timeline. */
export const recordReview = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    workspaceId: v.id("workspaces"),
    stageId: v.optional(v.id("leadStages")),
    note: v.string(),
    reviewedAt: v.number(),
    /** Set when a follow-up actually went out, so the cap can be enforced. */
    followedUp: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) return { success: false };

    await ctx.db.patch(args.conversationId, {
      // The nudge itself moved lastMessageAt past this review; without the max
      // the thread is due again an hour later and reviewed for nothing.
      reviewedAt: args.followedUp
        ? Math.max(args.reviewedAt, conversation.lastMessageAt)
        : args.reviewedAt,
      // A stage set by hand is left alone. The note still records what the desk
      // would have said, so a person can see where they disagree with it.
      ...(args.stageId && !conversation.leadStagePinned
        ? { leadStageId: args.stageId }
        : {}),
      leadStageNote: args.note.slice(0, 500),
      ...(args.followedUp
        ? {
            followUpCount: (conversation.followUpCount ?? 0) + 1,
            lastFollowUpAt: args.reviewedAt,
          }
        : {}),
    });

    // "note" is an existing internal message kind — never shown to the
    // customer — so a review joins the thread's history without joining the
    // conversation.
    await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "system",
      kind: "note",
      text: args.note.slice(0, 500),
      createdAt: args.reviewedAt,
    });

    return { success: true };
  },
});

/** Takes a thread the review skipped off the due list until the customer speaks. */
export const markReviewed = internalMutation({
  args: { conversationId: v.id("conversations"), reviewedAt: v.number() },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) {
      await ctx.db.patch(args.conversationId, { reviewedAt: args.reviewedAt });
    }
  },
});

/** Records the follow-up itself, so it reads as an ordinary outgoing message. */
export const recordFollowUp = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    agentId: v.optional(v.id("agents")),
    text: v.string(),
    whatsapp: v.optional(v.object({ wamid: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: "assistant",
      kind: "text",
      text: args.text,
      agentId: args.agentId,
      createdAt: now,
    });
    const delivery = await noteSent(ctx, messageId, args.whatsapp);
    await recordAgentReply(ctx, args.workspaceId, args.agentId, {
      at: now,
      text: args.text,
    });

    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation) {
      const desk = args.agentId ? await ctx.db.get("agents", args.agentId) : null;
      await noteMessage(ctx, conversation, {
        from: "agent",
        sender: desk?.botName,
        preview: args.text,
        at: now,
        delivery,
      });
    }
    return { success: true };
  },
});
