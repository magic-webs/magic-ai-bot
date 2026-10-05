import { v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { refreshContactSearch } from "./lib/inbox";
import { DEFAULT_CATEGORIES } from "./lib/audience";
import { cleanContact, describeForSorting, type RawContact } from "./lib/contactClean";
import { choiceOf, evaluate, JEV_MODEL, probabilityOf } from "./lib/jev";
import { importCounts, importRowStatus } from "./schema/marketing";

const MAX_ROWS = 10_000;
const MAX_ADD = 500;
const SORT_BATCH = 40;
const SORT_PARALLEL = 8;
const SAVE_BATCH = 100;
const READY_CONFIDENCE = 0.8;
const JUNK_PROBABILITY = 0.5;
const FLAG_PROBABILITY = 0.8;
const INTEREST_CONFIDENCE = 0.6;

type Counts = Infer<typeof importCounts>;
type RowStatus = Infer<typeof importRowStatus>;

const EMPTY_COUNTS: Counts = {
  queued: 0,
  invalid: 0,
  duplicate: 0,
  check: 0,
  ready: 0,
  skipped: 0,
  saved: 0,
};

const rawContact = v.object({
  name: v.optional(v.string()),
  phone: v.string(),
  email: v.optional(v.string()),
  company: v.optional(v.string()),
  birthday: v.optional(v.string()),
  tags: v.optional(v.string()),
  notes: v.optional(v.string()),
});

async function requireImport(ctx: QueryCtx, importId: Id<"audienceImports">) {
  const row = await ctx.db.get("audienceImports", importId);
  if (!row) throw new Error("Import not found");
  await requireWorkspace(ctx, row.workspaceId);
  return row;
}

async function categoriesFor(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const settings = await ctx.db
    .query("marketingSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  return settings?.categories ?? DEFAULT_CATEGORIES;
}

function shift(counts: Counts, moves: Array<[RowStatus | null, RowStatus]>): Counts {
  const next = { ...counts };
  for (const [from, to] of moves) {
    if (from) next[from] = Math.max(0, next[from] - 1);
    next[to] += 1;
  }
  return next;
}

async function moveRows(
  ctx: MutationCtx,
  importDoc: Doc<"audienceImports">,
  moves: Array<[RowStatus | null, RowStatus]>,
  extra: Partial<Doc<"audienceImports">> = {}
) {
  const fresh = (await ctx.db.get("audienceImports", importDoc._id)) ?? importDoc;
  await ctx.db.patch("audienceImports", importDoc._id, {
    counts: shift(fresh.counts, moves),
    updatedAt: Date.now(),
    ...extra,
  });
}

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("audienceImports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(30);
    return rows.filter((row) => row.status !== "discarded");
  },
});

export const get = query({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    const importDoc = await requireImport(ctx, args.importId);
    return {
      ...importDoc,
      categories: await categoriesFor(ctx, importDoc.workspaceId),
    };
  },
});

export const rows = query({
  args: {
    importId: v.id("audienceImports"),
    status: importRowStatus,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireImport(ctx, args.importId);
    return await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_status", (q) =>
        q.eq("importId", args.importId).eq("status", args.status)
      )
      .paginate(args.paginationOpts);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    fileName: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const now = Date.now();
    return await ctx.db.insert("audienceImports", {
      workspaceId: args.workspaceId,
      name: args.name.trim().slice(0, 80) || "Imported contacts",
      fileName: args.fileName,
      countryCode: args.countryCode?.replace(/\D/g, "") || undefined,
      status: "uploading",
      total: 0,
      counts: { ...EMPTY_COUNTS },
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function cleanRow(
  ctx: MutationCtx,
  importDoc: Doc<"audienceImports">,
  raw: RawContact
) {
  const result = cleanContact(raw, importDoc.countryCode);
  const existing = result.clean.phone
    ? await ctx.db
        .query("contacts")
        .withIndex("by_workspace_external", (q) =>
          q.eq("workspaceId", importDoc.workspaceId).eq("externalId", result.clean.phone!)
        )
        .unique()
    : null;
  return { ...result, existing };
}

export const addRows = mutation({
  args: {
    importId: v.id("audienceImports"),
    firstLine: v.number(),
    rows: v.array(rawContact),
  },
  handler: async (ctx, args) => {
    const importDoc = await requireImport(ctx, args.importId);
    if (importDoc.status !== "uploading") throw new Error("This import is already being sorted.");
    if (args.rows.length > MAX_ADD) throw new Error(`Send at most ${MAX_ADD} rows at a time.`);
    if (importDoc.total + args.rows.length > MAX_ROWS) {
      throw new Error(`One import can hold at most ${MAX_ROWS.toLocaleString()} people.`);
    }

    const now = Date.now();
    const moves: Array<[RowStatus | null, RowStatus]> = [];
    for (const [index, raw] of args.rows.entries()) {
      const { clean, problem, fixes, existing } = await cleanRow(ctx, importDoc, raw);
      const first = clean.phone
        ? await ctx.db
            .query("audienceImportRows")
            .withIndex("by_importId_and_phone", (q) =>
              q.eq("importId", importDoc._id).eq("phone", clean.phone)
            )
            .first()
        : null;

      if (first) {
        const merged: Partial<Doc<"audienceImportRows">> = {};
        if (!first.name && clean.name) merged.name = clean.name;
        if (!first.email && clean.email) merged.email = clean.email;
        if (!first.company && clean.company) merged.company = clean.company;
        if (!first.birthday && clean.birthday) merged.birthday = clean.birthday;
        if (clean.tags.some((tag) => !first.tags.includes(tag))) {
          merged.tags = [...new Set([...first.tags, ...clean.tags])].slice(0, 10);
        }
        if (Object.keys(merged).length > 0) {
          await ctx.db.patch("audienceImportRows", first._id, { ...merged, updatedAt: now });
        }
      }

      const status: RowStatus = problem ? "invalid" : first ? "duplicate" : "queued";
      await ctx.db.insert("audienceImportRows", {
        workspaceId: importDoc.workspaceId,
        importId: importDoc._id,
        line: args.firstLine + index,
        raw,
        ...clean,
        problem,
        fixes,
        status,
        duplicateOfLine: first?.line,
        existingContactId: existing?._id,
        optedOut: existing?.optedOutAt ? true : undefined,
        updatedAt: now,
      });
      moves.push([null, status]);
    }

    const fresh = (await ctx.db.get("audienceImports", importDoc._id))!;
    await ctx.db.patch("audienceImports", importDoc._id, {
      total: fresh.total + args.rows.length,
      counts: shift(fresh.counts, moves),
      updatedAt: now,
    });
    return { added: args.rows.length };
  },
});

export const startSorting = mutation({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    const importDoc = await requireImport(ctx, args.importId);
    if (importDoc.status !== "uploading") return { success: true };
    if (importDoc.total === 0) throw new Error("There is nobody in this file to import.");
    await ctx.db.patch("audienceImports", importDoc._id, {
      status: importDoc.counts.queued > 0 ? "sorting" : "review",
      updatedAt: Date.now(),
    });
    if (importDoc.counts.queued > 0) {
      await ctx.scheduler.runAfter(0, internal.audienceImports.sortBatch, {
        importId: importDoc._id,
      });
    }
    return { success: true };
  },
});

export const sortContext = internalQuery({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    const importDoc = await ctx.db.get("audienceImports", args.importId);
    if (!importDoc || importDoc.status !== "sorting") return null;
    const workspace = await ctx.db.get("workspaces", importDoc.workspaceId);
    const queued = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_status", (q) =>
        q.eq("importId", args.importId).eq("status", "queued")
      )
      .take(SORT_BATCH);
    return {
      workspaceId: importDoc.workspaceId,
      business: workspace
        ? [workspace.name, workspace.industry, workspace.description]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 400)
        : "",
      categories: await categoriesFor(ctx, importDoc.workspaceId),
      rows: queued.map((row) => ({
        _id: row._id,
        name: row.name,
        company: row.company,
        email: row.email,
        tags: row.tags,
        notes: row.notes,
        hasNotes: Boolean(row.notes || row.tags.length > 0),
      })),
    };
  },
});

const sortedRow = v.object({
  rowId: v.id("audienceImportRows"),
  category: v.string(),
  confidence: v.optional(v.number()),
  junk: v.optional(v.number()),
  business: v.optional(v.boolean()),
  doNotContact: v.optional(v.boolean()),
  interest: v.optional(v.union(v.literal("cold"), v.literal("warm"), v.literal("hot"))),
  sortError: v.optional(v.string()),
});

export const recordSorted = internalMutation({
  args: { importId: v.id("audienceImports"), results: v.array(sortedRow) },
  handler: async (ctx, args) => {
    const importDoc = await ctx.db.get("audienceImports", args.importId);
    if (!importDoc) return;
    const now = Date.now();
    const moves: Array<[RowStatus | null, RowStatus]> = [];
    for (const result of args.results) {
      const row = await ctx.db.get("audienceImportRows", result.rowId);
      if (!row || row.status !== "queued") continue;
      const sure =
        !result.sortError &&
        (result.confidence === undefined || result.confidence >= READY_CONFIDENCE) &&
        (result.junk ?? 0) < JUNK_PROBABILITY;
      const status: RowStatus = sure ? "ready" : "check";
      const fixes = [...row.fixes];
      let tags = row.tags;
      let company = row.company;
      if (result.business) {
        if (!company && row.name) {
          company = row.name;
          fixes.push("business_name");
        }
        tags = [...new Set([...tags, "business"])];
      }
      if (result.doNotContact) fixes.push("do_not_contact");
      if (result.interest) tags = [...new Set([...tags, result.interest])];
      await ctx.db.patch("audienceImportRows", row._id, {
        category: result.category,
        confidence: result.confidence,
        junk: result.junk,
        business: result.business,
        doNotContact: result.doNotContact,
        interest: result.interest,
        company,
        tags: tags.slice(0, 10),
        fixes,
        sortError: result.sortError,
        status,
        updatedAt: now,
      });
      moves.push(["queued", status]);
    }
    await moveRows(ctx, importDoc, moves);
  },
});

export const finishSorting = internalMutation({
  args: { importId: v.id("audienceImports"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const importDoc = await ctx.db.get("audienceImports", args.importId);
    if (!importDoc || importDoc.status !== "sorting") return;
    await ctx.db.patch("audienceImports", importDoc._id, {
      status: "review",
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});

async function inParallel<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    })
  );
  return results;
}

export const sortBatch = internalAction({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.audienceImports.sortContext, args);
    if (!context) return null;
    if (context.rows.length === 0) {
      await ctx.runMutation(internal.audienceImports.finishSorting, args);
      return null;
    }

    const fallback =
      context.categories.find((category) => category.key === "unknown")?.key ??
      context.categories[context.categories.length - 1].key;
    const criteria = Object.fromEntries(
      context.categories.map((category) => [
        category.key,
        `${category.label}: ${category.description}`,
      ])
    );

    let inputTokens = 0;
    let outputTokens = 0;
    let fatal: string | undefined;
    const results = await inParallel(context.rows, SORT_PARALLEL, async (row) => {
      const details = describeForSorting({ ...row, notes: row.notes });
      if (!details) return { rowId: row._id, category: fallback };
      try {
        const answer = await evaluate(
          `A contact from the address book of ${context.business || "a business"}.\n${details}`,
          {
            category: {
              type: "choice",
              instructions: "Which group does this contact belong to for the business",
              criteria,
            },
            junk: {
              type: "boolean",
              instructions:
                "The name is keyboard mashing, a placeholder such as test or xxx, or nonsense",
            },
            business: {
              type: "boolean",
              instructions: "The name is a shop, company or organisation rather than a person",
            },
            ...(row.hasNotes
              ? {
                  doNotContact: {
                    type: "boolean" as const,
                    instructions: "The notes say this person asked not to be contacted or messaged",
                  },
                  interest: {
                    type: "score" as const,
                    instructions: "How interested in buying is this contact",
                    criteria: [
                      "No interest or not interested",
                      "Some interest or unclear",
                      "Keen, asked for details or ready to buy",
                    ],
                  },
                }
              : {}),
          }
        );
        inputTokens += answer.inputTokens;
        outputTokens += answer.outputTokens;
        const choice = choiceOf(answer.answers.category);
        const interest = answer.answers.interest;
        return {
          rowId: row._id,
          category: choice && criteria[choice.choice] ? choice.choice : fallback,
          confidence: choice?.confidence,
          junk: probabilityOf(answer.answers.junk) ?? undefined,
          business: (probabilityOf(answer.answers.business) ?? 0) >= FLAG_PROBABILITY || undefined,
          doNotContact:
            (probabilityOf(answer.answers.doNotContact) ?? 0) >= FLAG_PROBABILITY || undefined,
          interest:
            interest?.type === "score" && interest.confidence >= INTEREST_CONFIDENCE
              ? interest.score >= 1.5
                ? ("hot" as const)
                : interest.score <= 0.5
                  ? ("cold" as const)
                  : ("warm" as const)
              : undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/AI_GATEWAY_API_KEY|401|403/.test(message)) fatal = message;
        return { rowId: row._id, category: fallback, sortError: message.slice(0, 200) };
      }
    });

    await ctx.runMutation(internal.audienceImports.recordSorted, {
      importId: args.importId,
      results,
    });
    if (inputTokens > 0) {
      await ctx.runMutation(internal.usage.record, {
        workspaceId: context.workspaceId,
        source: "sort_contacts",
        model: JEV_MODEL,
        kind: "chat",
        inputTokens,
        outputTokens,
      });
    }

    if (fatal) {
      await ctx.runMutation(internal.audienceImports.markQueuedForCheck, {
        importId: args.importId,
        error: "Sorting is unavailable right now, so every row needs a category picked by hand.",
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.audienceImports.sortBatch, args);
    return null;
  },
});

export const markQueuedForCheck = internalMutation({
  args: { importId: v.id("audienceImports"), error: v.string() },
  handler: async (ctx, args) => {
    const importDoc = await ctx.db.get("audienceImports", args.importId);
    if (!importDoc) return;
    const queued = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_status", (q) =>
        q.eq("importId", args.importId).eq("status", "queued")
      )
      .take(SAVE_BATCH * 5);
    const now = Date.now();
    for (const row of queued) {
      await ctx.db.patch("audienceImportRows", row._id, { status: "check", updatedAt: now });
    }
    await moveRows(
      ctx,
      importDoc,
      queued.map(() => ["queued", "check"] as [RowStatus, RowStatus])
    );
    if (queued.length === SAVE_BATCH * 5) {
      await ctx.scheduler.runAfter(0, internal.audienceImports.markQueuedForCheck, args);
      return;
    }
    await ctx.db.patch("audienceImports", importDoc._id, {
      status: "review",
      error: args.error,
      updatedAt: now,
    });
  },
});

async function requireRow(ctx: QueryCtx, rowId: Id<"audienceImportRows">) {
  const row = await ctx.db.get("audienceImportRows", rowId);
  if (!row) throw new Error("Row not found");
  const importDoc = await requireImport(ctx, row.importId);
  return { row, importDoc };
}

function reviewable(importDoc: Doc<"audienceImports">) {
  if (importDoc.status !== "review") {
    throw new Error("This import can only be changed while it is in review.");
  }
}

export const updateRow = mutation({
  args: {
    rowId: v.id("audienceImportRows"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    category: v.optional(v.string()),
    undo: v.optional(v.union(v.literal("business_name"), v.literal("do_not_contact"))),
  },
  handler: async (ctx, args) => {
    const { row, importDoc } = await requireRow(ctx, args.rowId);
    reviewable(importDoc);
    const now = Date.now();

    if (args.undo) {
      const fixes = row.fixes.filter((fix) => fix !== args.undo);
      await ctx.db.patch(
        "audienceImportRows",
        row._id,
        args.undo === "business_name"
          ? {
              fixes,
              business: undefined,
              company: row.raw.company?.trim() || undefined,
              tags: row.tags.filter((tag) => tag !== "business"),
              updatedAt: now,
            }
          : { fixes, doNotContact: undefined, updatedAt: now }
      );
      return { status: row.status };
    }

    if (args.phone !== undefined || args.name !== undefined) {
      const raw = {
        ...row.raw,
        phone: args.phone ?? row.raw.phone,
        name: args.name ?? row.raw.name,
      };
      const { clean, problem, fixes, existing } = await cleanRow(ctx, importDoc, raw);
      const clash =
        clean.phone && clean.phone !== row.phone
          ? await ctx.db
              .query("audienceImportRows")
              .withIndex("by_importId_and_phone", (q) =>
                q.eq("importId", importDoc._id).eq("phone", clean.phone)
              )
              .first()
          : null;
      if (clash) throw new Error(`That number is already on line ${clash.line}.`);
      const status: RowStatus = problem ? "invalid" : "ready";
      await ctx.db.patch("audienceImportRows", row._id, {
        raw,
        name: clean.name,
        phone: clean.phone,
        fixes,
        problem,
        status,
        category: row.category ?? args.category ?? "unknown",
        existingContactId: existing?._id,
        optedOut: existing?.optedOutAt ? true : undefined,
        updatedAt: now,
      });
      if (status !== row.status) await moveRows(ctx, importDoc, [[row.status, status]]);
      return { status };
    }

    if (args.category !== undefined) {
      const categories = await categoriesFor(ctx, importDoc.workspaceId);
      if (!categories.some((category) => category.key === args.category)) {
        throw new Error("Unknown category");
      }
      const status: RowStatus = row.status === "check" ? "ready" : row.status;
      await ctx.db.patch("audienceImportRows", row._id, {
        category: args.category,
        status,
        updatedAt: now,
      });
      if (status !== row.status) await moveRows(ctx, importDoc, [[row.status, status]]);
      return { status };
    }
    return { status: row.status };
  },
});

export const setRowsStatus = mutation({
  args: {
    rowIds: v.array(v.id("audienceImportRows")),
    status: v.union(v.literal("ready"), v.literal("skipped")),
  },
  handler: async (ctx, args) => {
    if (args.rowIds.length > MAX_ADD) throw new Error(`Pick at most ${MAX_ADD} rows.`);
    const now = Date.now();
    const moves = new Map<Id<"audienceImports">, Array<[RowStatus, RowStatus]>>();
    let importDoc: Doc<"audienceImports"> | null = null;
    for (const rowId of args.rowIds) {
      const found = await requireRow(ctx, rowId);
      importDoc = found.importDoc;
      reviewable(importDoc);
      const { row } = found;
      if (row.status === args.status || row.status === "saved") continue;
      if (args.status === "ready" && (row.status === "invalid" || row.status === "duplicate")) {
        continue;
      }
      await ctx.db.patch("audienceImportRows", row._id, {
        status: args.status,
        category: row.category ?? "unknown",
        updatedAt: now,
      });
      const list = moves.get(row.importId) ?? [];
      list.push([row.status, args.status]);
      moves.set(row.importId, list);
    }
    for (const [importId, list] of moves) {
      const doc = await ctx.db.get("audienceImports", importId);
      if (doc) await moveRows(ctx, doc, list);
    }
    return { moved: [...moves.values()].reduce((sum, list) => sum + list.length, 0) };
  },
});

export const acceptAll = mutation({
  args: { importId: v.id("audienceImports"), from: v.union(v.literal("check"), v.literal("skipped")) },
  handler: async (ctx, args) => {
    const importDoc = await requireImport(ctx, args.importId);
    reviewable(importDoc);
    await ctx.scheduler.runAfter(0, internal.audienceImports.moveAll, {
      importId: args.importId,
      from: args.from,
      to: "ready",
    });
    return { success: true };
  },
});

export const moveAll = internalMutation({
  args: {
    importId: v.id("audienceImports"),
    from: importRowStatus,
    to: importRowStatus,
  },
  handler: async (ctx, args) => {
    const importDoc = await ctx.db.get("audienceImports", args.importId);
    if (!importDoc || importDoc.status !== "review") return;
    const batch = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_status", (q) =>
        q.eq("importId", args.importId).eq("status", args.from)
      )
      .take(SAVE_BATCH * 2);
    const now = Date.now();
    for (const row of batch) {
      await ctx.db.patch("audienceImportRows", row._id, {
        status: args.to,
        category: row.category ?? "unknown",
        updatedAt: now,
      });
    }
    await moveRows(
      ctx,
      importDoc,
      batch.map(() => [args.from, args.to] as [RowStatus, RowStatus])
    );
    if (batch.length === SAVE_BATCH * 2) {
      await ctx.scheduler.runAfter(0, internal.audienceImports.moveAll, args);
    }
  },
});

export const save = mutation({
  args: {
    importId: v.id("audienceImports"),
    audienceName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const importDoc = await requireImport(ctx, args.importId);
    reviewable(importDoc);
    if (importDoc.counts.ready === 0) throw new Error("Nobody is ready to save yet.");
    const now = Date.now();
    const name = args.audienceName?.trim().slice(0, 80);
    const audienceId = name
      ? await ctx.db.insert("audiences", {
          workspaceId: importDoc.workspaceId,
          name,
          description: `Imported ${new Date(now).toISOString().slice(0, 10)}`,
          source: "import",
          memberCount: 0,
          createdAt: now,
          updatedAt: now,
        })
      : undefined;
    await ctx.db.patch("audienceImports", importDoc._id, {
      status: "saving",
      audienceId,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.audienceImports.saveBatch, {
      importId: importDoc._id,
    });
    return { success: true };
  },
});

export const saveBatch = internalMutation({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    const importDoc = await ctx.db.get("audienceImports", args.importId);
    if (!importDoc || importDoc.status !== "saving") return;
    const batch = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_status", (q) =>
        q.eq("importId", args.importId).eq("status", "ready")
      )
      .take(SAVE_BATCH);
    const now = Date.now();
    let members = 0;

    for (const row of batch) {
      if (!row.phone) continue;
      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_external", (q) =>
          q.eq("workspaceId", importDoc.workspaceId).eq("externalId", row.phone!)
        )
        .unique();
      let contactId: Id<"contacts">;
      if (existing) {
        const patch: Partial<Doc<"contacts">> = {};
        if (!existing.name && row.name) patch.name = row.name;
        if (!existing.email && row.email) patch.email = row.email;
        if (!existing.company && row.company) patch.company = row.company;
        if (!existing.birthday && row.birthday) patch.birthday = row.birthday;
        if (row.category && (!existing.category || existing.category === "unknown")) {
          patch.category = row.category;
        }
        const tags = [...new Set([...(existing.tags ?? []), ...row.tags])].slice(0, 30);
        if (tags.length !== (existing.tags ?? []).length) patch.tags = tags;
        if (row.doNotContact && !existing.optedOutAt) {
          patch.optedOutAt = now;
          patch.optOutReason = "import";
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch("contacts", existing._id, patch);
          if (patch.name) await refreshContactSearch(ctx, existing._id);
        }
        contactId = existing._id;
      } else {
        contactId = await ctx.db.insert("contacts", {
          workspaceId: importDoc.workspaceId,
          externalId: row.phone,
          channelType: "whatsapp",
          name: row.name,
          phone: row.phone,
          email: row.email,
          company: row.company,
          birthday: row.birthday,
          category: row.category,
          tags: row.tags,
          attributes: [],
          source: "import",
          ...(row.doNotContact ? { optedOutAt: now, optOutReason: "import" as const } : {}),
          lastSeenAt: now,
          createdAt: now,
        });
      }

      if (importDoc.audienceId) {
        const audienceId = importDoc.audienceId;
        const member = await ctx.db
          .query("audienceMembers")
          .withIndex("by_audienceId_and_contactId", (q) =>
            q.eq("audienceId", audienceId).eq("contactId", contactId)
          )
          .unique();
        if (!member) {
          await ctx.db.insert("audienceMembers", {
            workspaceId: importDoc.workspaceId,
            audienceId,
            contactId,
            addedAt: now,
          });
          members++;
        }
      }
      await ctx.db.patch("audienceImportRows", row._id, { status: "saved", updatedAt: now });
    }

    if (importDoc.audienceId && members > 0) {
      const audience = await ctx.db.get("audiences", importDoc.audienceId);
      if (audience) {
        await ctx.db.patch("audiences", audience._id, {
          memberCount: audience.memberCount + members,
          updatedAt: now,
        });
      }
    }

    const done = batch.length < SAVE_BATCH;
    await moveRows(
      ctx,
      importDoc,
      batch.map(() => ["ready", "saved"] as [RowStatus, RowStatus]),
      done ? { status: "saved", finishedAt: now } : {}
    );
    if (!done) await ctx.scheduler.runAfter(0, internal.audienceImports.saveBatch, args);
  },
});

export const discard = mutation({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    const importDoc = await requireImport(ctx, args.importId);
    if (importDoc.status === "saving") throw new Error("This import is saving right now.");
    await ctx.db.patch("audienceImports", importDoc._id, {
      status: "discarded",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.audienceImports.purgeRows, { importId: importDoc._id });
    return { success: true };
  },
});

export const purgeRows = internalMutation({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_line", (q) => q.eq("importId", args.importId))
      .take(400);
    for (const row of rows) await ctx.db.delete("audienceImportRows", row._id);
    if (rows.length === 400) {
      await ctx.scheduler.runAfter(0, internal.audienceImports.purgeRows, args);
    }
  },
});
