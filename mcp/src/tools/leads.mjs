/**
 * Leads — the pipeline the follow-up desk files conversations into.
 *
 * The follow-up desk reads every conversation that has gone quiet, matches it
 * against each stage's description and files it at the one it has reached.
 * So the stage *descriptions* are the configuration that matters here: they
 * are what the desk decides against, and a vague one files leads at random.
 *
 * Stages are ordered by `position`, spaced in tens so one can be dropped
 * between two without renumbering. These tools take "after this stage" rather
 * than a number, and work the position out.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findLeadStage, pickByName } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const outcomeArg = z
  .enum(["open", "won", "lost"])
  .describe(
    "'open' for a stage still in progress. 'won' and 'lost' are terminal: the follow-up desk never nudges a lead filed there."
  );

const afterArg = z
  .string()
  .describe(
    "Put it after this stage (name or id), or 'start' to make it the first stage."
  );

const stageBrief = (stage, index) => ({
  id: stage._id,
  order: index + 1,
  name: stage.name,
  description: stage.description,
  outcome: stage.outcome,
  leads: stage.leadCount,
});

/**
 * The position that lands a stage right after `after`, among `stages` (sorted,
 * and without the stage being moved). Halfway to the next one, so nothing
 * else has to move.
 */
function positionAfter(stages, after) {
  if (stages.length === 0) return 10;
  if (after.trim().toLowerCase() === "start") {
    return stages[0].position - 10;
  }
  const anchor =
    stages.find((s) => s._id === after) ??
    pickByName(stages, after, "lead stage", ["name"]);
  const index = stages.indexOf(anchor);
  const next = stages[index + 1];
  return next ? (anchor.position + next.position) / 2 : anchor.position + 10;
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_lead_stages",
    {
      title: "List lead stages",
      description:
        "The workspace's lead pipeline in order: each stage's description (what the follow-up desk files a quiet conversation against), whether it is open or a terminal won/lost stage, and how many leads sit there now.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const stages = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });
      if (stages.length === 0) {
        return ok(
          "This workspace has no lead stages, so the follow-up desk files nothing. Call seed_default_lead_stages for the standard seven, or create_lead_stage to build your own."
        );
      }
      return ok(stages.map(stageBrief));
    })
  );

  server.registerTool(
    "seed_default_lead_stages",
    {
      title: "Seed the default lead stages",
      description:
        "Adds the standard seven-stage pipeline (New enquiry → Qualified → Details collected → Quoted → Negotiating → Won / Lost). Only acts on a workspace with no stages at all; one that already has any is left untouched.",
      inputSchema: { ...workspaceArg },
      annotations: { idempotentHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const { created } = await call.mutation(api.leads.ensureDefaultStages, {
        workspaceId: found._id,
      });
      const stages = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });
      return ok({
        created,
        note:
          created === 0
            ? "The workspace already had stages, so nothing was added."
            : `Added ${created} stages.`,
        stages: stages.map(stageBrief),
      });
    })
  );

  server.registerTool(
    "create_lead_stage",
    {
      title: "Create lead stage",
      description:
        "Add a stage to the pipeline. Write the description as a test the follow-up desk can apply to a transcript — 'a site visit has been booked for a date' — not a label, because that description is the only thing it matches conversations against.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().describe("Short, e.g. 'Site visit booked'"),
        description: z
          .string()
          .describe("What must be true of a conversation to belong here"),
        outcome: outcomeArg.optional().describe("Default 'open'"),
        after: afterArg
          .optional()
          .describe(
            "Put it after this stage (name or id), or 'start'. Omit to add it at the end."
          ),
      },
    },
    handler(async ({ workspace, name, description, outcome, after }) => {
      const found = await resolveWorkspace(workspace);
      const stages = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });
      const stageId = await call.mutation(api.leads.createStage, {
        workspaceId: found._id,
        name,
        description,
        outcome,
        position: after ? positionAfter(stages, after) : undefined,
      });
      const updated = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });
      return ok({ created: stageId, stages: updated.map(stageBrief) });
    })
  );

  server.registerTool(
    "update_lead_stage",
    {
      title: "Update lead stage",
      description:
        "Rename a stage, rewrite what belongs in it, change whether it is open/won/lost, or move it. Leads already filed there stay filed there.",
      inputSchema: {
        ...workspaceArg,
        stage: z.string().describe("Stage name or id"),
        name: z.string().optional(),
        description: z.string().optional(),
        outcome: outcomeArg.optional(),
        after: afterArg.optional().describe(
          "Move it after this stage (name or id), or 'start'."
        ),
      },
    },
    handler(async ({ workspace, stage, name, description, outcome, after }) => {
      const found = await resolveWorkspace(workspace);
      const { stage: target, stages } = await findLeadStage(found._id, stage);

      if (name !== undefined && !name.trim()) {
        throw new Error("A stage needs a name.");
      }
      if (description !== undefined && !description.trim()) {
        throw new Error(
          "A stage needs a description — it is what the follow-up desk matches a conversation against."
        );
      }
      if (
        name &&
        stages.some(
          (s) =>
            s._id !== target._id &&
            s.name.toLowerCase() === name.trim().toLowerCase()
        )
      ) {
        throw new Error(`There is already a stage called "${name.trim()}".`);
      }

      const others = stages.filter((s) => s._id !== target._id);
      await call.mutation(api.leads.updateStage, {
        stageId: target._id,
        name,
        description,
        outcome,
        position: after ? positionAfter(others, after) : undefined,
      });
      const updated = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });
      return ok(updated.map(stageBrief));
    })
  );

  server.registerTool(
    "reorder_lead_stages",
    {
      title: "Reorder lead stages",
      description:
        "Set the whole pipeline order at once. Pass every stage, first to last; a missing or repeated one is refused rather than guessed at.",
      inputSchema: {
        ...workspaceArg,
        order: z
          .array(z.string())
          .min(1)
          .describe("Every stage name (or id), in the order they should run"),
      },
      annotations: { idempotentHint: true },
    },
    handler(async ({ workspace, order }) => {
      const found = await resolveWorkspace(workspace);
      const stages = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });

      const picked = order.map(
        (wanted) =>
          stages.find((s) => s._id === wanted) ??
          pickByName(stages, wanted, "lead stage", ["name"])
      );
      const ids = new Set(picked.map((s) => s._id));
      if (ids.size !== picked.length) {
        throw new Error("A stage appears twice in the order.");
      }
      const missing = stages.filter((s) => !ids.has(s._id));
      if (missing.length > 0) {
        throw new Error(
          `Every stage has to be placed. Missing: ${missing
            .map((s) => s.name)
            .join(", ")}`
        );
      }

      // Back to clean tens. Only the ones that actually move are written.
      for (const [index, stage] of picked.entries()) {
        const position = (index + 1) * 10;
        if (stage.position === position) continue;
        await call.mutation(api.leads.updateStage, {
          stageId: stage._id,
          position,
        });
      }
      const updated = await call.query(api.leads.listStages, {
        workspaceId: found._id,
      });
      return ok(updated.map(stageBrief));
    })
  );

  server.registerTool(
    "delete_lead_stage",
    {
      title: "Delete lead stage",
      description:
        "Remove a stage. Leads filed there become unfiled — nothing is lost — and the follow-up desk refiles them the next time each conversation goes quiet. Cannot be undone.",
      inputSchema: {
        ...workspaceArg,
        stage: z.string().describe("Stage name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, stage }) => {
      const found = await resolveWorkspace(workspace);
      const { stage: target } = await findLeadStage(found._id, stage);
      const { cleared } = await call.mutation(api.leads.removeStage, {
        stageId: target._id,
      });
      return ok(
        `Deleted "${target.name}". ${cleared} lead(s) filed there are now unfiled.`
      );
    })
  );

  // ------------------------------------------------------------ the leads

  server.registerTool(
    "list_leads",
    {
      title: "List leads",
      description:
        "Conversations as leads: which stage each is filed at, the follow-up desk's reason, whether a person pinned it there by hand, and how many follow-ups it has been sent. Newest activity first.",
      inputSchema: {
        ...workspaceArg,
        stage: z
          .string()
          .optional()
          .describe("Only leads at this stage (name or id), or 'unfiled'"),
        limit: z.number().int().min(1).max(300).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, stage, limit }) => {
      const found = await resolveWorkspace(workspace);
      const [stages, rows] = await Promise.all([
        call.query(api.leads.listStages, { workspaceId: found._id }),
        call.query(api.leads.pipeline, {
          workspaceId: found._id,
          limit: limit ?? 100,
        }),
      ]);
      const names = new Map(stages.map((s) => [s._id, s.name]));

      let wanted;
      if (stage && stage.trim().toLowerCase() === "unfiled") wanted = null;
      else if (stage) {
        wanted = (
          stages.find((s) => s._id === stage) ??
          pickByName(stages, stage, "lead stage", ["name"])
        )._id;
      }

      return ok(
        rows
          .filter((row) => wanted === undefined || row.leadStageId === wanted)
          .map((row) => ({
            conversationId: row.conversationId,
            contact: row.contactLabel,
            company: row.contactCompany,
            stage: row.leadStageId ? (names.get(row.leadStageId) ?? null) : null,
            why: row.leadStageNote,
            pinnedByHand: row.leadStagePinned,
            followUpsSent: row.followUpCount,
            reviewedAt: row.reviewedAt
              ? new Date(row.reviewedAt).toISOString()
              : null,
            status: row.status,
            channel: row.channelType,
            heldBy: row.handledBy,
            lastMessageAt: new Date(row.lastMessageAt).toISOString(),
            preview: row.lastMessagePreview,
            remark: row.remark,
          }))
      );
    })
  );

  server.registerTool(
    "set_lead_stage",
    {
      title: "File a lead at a stage",
      description:
        "Move one conversation to a stage by hand. It is pinned there: the follow-up desk will not refile it on its next review. Pass stage 'none' to unfile it and hand the decision back to the desk.",
      inputSchema: {
        ...workspaceArg,
        conversationId: z.string().describe("From list_leads or list_conversations"),
        stage: z.string().describe("Stage name or id, or 'none' to unfile"),
        note: z
          .string()
          .optional()
          .describe("Why it belongs there — shown beside the lead"),
      },
      annotations: { idempotentHint: true },
    },
    handler(async ({ workspace, conversationId, stage, note }) => {
      const clearing = stage.trim().toLowerCase() === "none";
      let target = null;
      if (!clearing) {
        const found = await resolveWorkspace(workspace);
        ({ stage: target } = await findLeadStage(found._id, stage));
      }
      await call.mutation(api.leads.setStage, {
        conversationId,
        stageId: target?._id,
        note,
      });
      return ok(
        target
          ? `Filed at "${target.name}" and pinned — the follow-up desk will leave it there.`
          : "Unfiled. The follow-up desk will decide its stage the next time the conversation goes quiet."
      );
    })
  );
}
