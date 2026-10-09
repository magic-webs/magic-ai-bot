// Magic Forms submissions — every one the connection has seen, and the record
// books they are filed into.
//
// Two ways in. The webhook (`apps.acceptResult`) stores each submission as it
// is made, whether or not an agent sent the link. `sync` reads the latest ones
// from Magic Forms' API, for those made before the connection existed or while
// this deployment could not be reached. Either way a submission is stored
// once, keyed by Magic Forms' own id.
//
// A form *saved to a record book* files each of its submissions there as a
// record, the form's fields becoming the book's. New ones are filed as they
// arrive; the ones already here are filed only when the book is made with
// "include past submissions", so switching a form on never quietly floods a
// book with history nobody asked for.

import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRecordBook, requireWorkspace } from "./lib/auth";
import { callApp } from "./lib/appClient";
import {
  formBookFields,
  personFromAnswers,
  readSubmissions,
  type AppSubmission,
} from "./lib/apps";
import { checkValues, type RecordField } from "./lib/records";
import {
  claimSerial,
  freshReference,
  insertBook,
  searchBlobFor,
} from "./records";

export const submissionShape = v.object({
  id: v.string(),
  formKey: v.string(),
  formTitle: v.string(),
  answers: v.array(
    v.object({ key: v.string(), label: v.string(), value: v.string() })
  ),
  viewUrl: v.optional(v.string()),
  whatsapp: v.optional(v.string()),
  ref: v.optional(v.string()),
  submittedAt: v.optional(v.number()),
});

/** The most Magic Forms' submissions endpoint returns in one call. */
const SYNC_LIMIT = 200;

/** Past this the page says "50+": an exact count would read every row. */
const COUNT_CAP = 50;

/** Records filed per run when a book takes in a form's past submissions. */
const BACKLOG_BATCH = 50;

type Link = {
  conversationId: Id<"conversations">;
  contactId: Id<"contacts">;
  agentId?: Id<"agents">;
};

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

async function formsConnection(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"appConnections"> | null> {
  return await ctx.db
    .query("appConnections")
    .withIndex("by_workspace_app", (q) =>
      q.eq("workspaceId", workspaceId).eq("app", "magic_forms")
    )
    .unique();
}

/** Every book a form in this account is saved to, by form key. */
async function booksByForm(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  accountId: string
): Promise<Map<string, Doc<"recordBooks">>> {
  const books = await ctx.db
    .query("recordBooks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const out = new Map<string, Doc<"recordBooks">>();
  for (const book of books) {
    if (book.formSource?.accountId === accountId) {
      out.set(book.formSource.formKey, book);
    }
  }
  return out;
}

/**
 * Files one submission as a record in the book its form is saved to.
 *
 * The answers go through the book's own validation, so a choice is stored as
 * the book spells it — but an answer the book would turn away is kept as it
 * was given rather than dropped. The book may have been edited since it was
 * made from the form, and the customer's answer is worth more than the rule.
 */
async function fileSubmission(
  ctx: MutationCtx,
  book: Doc<"recordBooks">,
  row: Doc<"formSubmissions">,
  push: boolean
): Promise<Id<"records">> {
  const input: Record<string, string> = {};
  for (const answer of row.answers) input[answer.key] = answer.value;
  const checked = checkValues(book.fields as RecordField[], input);
  const kept = new Set(checked.values.map((pair) => pair.key));
  const values = [
    ...checked.values,
    ...row.answers
      .filter((answer) => !kept.has(answer.key))
      .map((answer) => ({ key: answer.key, value: answer.value })),
  ];

  // What they typed on the form first, then what the conversation knows.
  const contact = row.contactId
    ? await ctx.db.get("contacts", row.contactId)
    : null;
  const guessed = personFromAnswers(row.answers, row.whatsapp);
  const candidate = {
    name: guessed.name ?? contact?.name,
    phone: guessed.phone ?? contact?.phone,
    email: guessed.email ?? contact?.email,
    company: guessed.company ?? contact?.company,
  };
  const person = Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value?.trim())
  ) as typeof candidate;
  const hasPerson = Object.keys(person).length > 0;

  const reference = await freshReference(
    ctx,
    book.workspaceId,
    book.referencePrefix
  );
  const serialNumber = await claimSerial(ctx, book._id);
  const recordId = await ctx.db.insert("records", {
    workspaceId: book.workspaceId,
    bookId: book._id,
    reference,
    serialNumber,
    agentId: row.agentId,
    conversationId: row.conversationId,
    contactId: row.contactId,
    person: hasPerson ? person : undefined,
    values,
    stage: book.stages[0],
    source: "form",
    searchBlob: searchBlobFor(reference, hasPerson ? person : undefined, values),
    // When it was submitted, not when it was filed: a book that takes in a
    // form's history should read in the order the answers came in.
    createdAt: row.submittedAt,
    updatedAt: Date.now(),
  });
  await ctx.db.patch(row._id, { recordId });

  await ctx.scheduler.runAfter(0, internal.records.announce, {
    recordId,
    event: "filed",
    // A new submission is news to the team's phones; a backlog is not.
    byAgent: push,
  });
  return recordId;
}

/**
 * Stores a submission the first time it is seen, and files it if its form is
 * saved to a book. Returns false when it was already here.
 *
 * `fromWebhook` is the difference between a submission that has just been made
 * — always filed — and one read back from the API, which is filed only if it
 * was made after the book was: older ones are what "include past submissions"
 * is for.
 */
export async function storeSubmission(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    accountId: string;
    submission: AppSubmission;
    link: Link | null;
    fromWebhook: boolean;
  }
): Promise<boolean> {
  const { submission } = args;
  const existing = await ctx.db
    .query("formSubmissions")
    .withIndex("by_submission", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("submissionId", submission.id)
    )
    .first();
  if (existing) return false;

  const now = Date.now();
  const rowId = await ctx.db.insert("formSubmissions", {
    workspaceId: args.workspaceId,
    accountId: args.accountId,
    submissionId: submission.id,
    formKey: submission.formKey,
    formTitle: submission.formTitle,
    answers: submission.answers,
    viewUrl: submission.viewUrl,
    whatsapp: submission.whatsapp,
    conversationId: args.link?.conversationId,
    contactId: args.link?.contactId,
    agentId: args.link?.agentId,
    submittedAt: submission.submittedAt ?? now,
    createdAt: now,
  });

  // Only while the book is collecting: its page's Paused switch stops forms
  // the same way it stops agents.
  const book = (
    await booksByForm(ctx, args.workspaceId, args.accountId)
  ).get(submission.formKey);
  if (!book || book.status !== "active") return true;

  const row = await ctx.db.get("formSubmissions", rowId);
  if (!row) return true;
  if (args.fromWebhook || row.submittedAt >= book.createdAt) {
    await fileSubmission(ctx, book, row, args.fromWebhook);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The connected account's forms, each with how many submissions are here and
 * the book it is saved to. Null when Magic Forms is not connected.
 */
export const forms = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const connection = await formsConnection(ctx, args.workspaceId);
    if (!connection) return null;
    const accountId = connection.account.id;
    const books = await booksByForm(ctx, args.workspaceId, accountId);

    const rows = await Promise.all(
      connection.items.map(async (item) => {
        const latest = await ctx.db
          .query("formSubmissions")
          .withIndex("by_account_form", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("accountId", accountId)
              .eq("formKey", item.key)
          )
          .order("desc")
          .take(COUNT_CAP + 1);
        const book = books.get(item.key);
        return {
          key: item.key,
          title: item.title,
          url: item.url ?? null,
          fieldCount: item.prefill?.length ?? 0,
          count: Math.min(latest.length, COUNT_CAP),
          countCapped: latest.length > COUNT_CAP,
          lastAt: latest[0]?.submittedAt ?? null,
          book: book
            ? {
                _id: book._id,
                name: book.name,
                pluralName: book.pluralName,
                status: book.status,
              }
            : null,
        };
      })
    );
    return { account: connection.account, forms: rows };
  },
});

/** Newest first, optionally for one form. */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    formKey: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const connection = await formsConnection(ctx, args.workspaceId);
    if (!connection) return { page: [], isDone: true, continueCursor: "" };
    const accountId = connection.account.id;
    const formKey = args.formKey;

    const result = formKey
      ? await ctx.db
          .query("formSubmissions")
          .withIndex("by_account_form", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("accountId", accountId)
              .eq("formKey", formKey)
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("formSubmissions")
          .withIndex("by_account", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("accountId", accountId)
          )
          .order("desc")
          .paginate(args.paginationOpts);

    const books = await booksByForm(ctx, args.workspaceId, accountId);
    const page = await Promise.all(
      result.page.map(async (row) => {
        // The record may have been deleted from the records page since.
        const record = row.recordId
          ? await ctx.db.get("records", row.recordId)
          : null;
        const person = personFromAnswers(row.answers, row.whatsapp);
        return {
          _id: row._id,
          formKey: row.formKey,
          formTitle: row.formTitle,
          answers: row.answers,
          viewUrl: row.viewUrl ?? null,
          submittedAt: row.submittedAt,
          conversationId: row.conversationId ?? null,
          who: person.name ?? person.phone ?? person.email ?? null,
          record: record
            ? { _id: record._id, reference: record.reference, bookId: record.bookId }
            : null,
          // Where "Save to record book" on this one would file it.
          book: books.get(row.formKey)?._id ?? null,
        };
      })
    );
    return { ...result, page };
  },
});

// ---------------------------------------------------------------------------
// Saving a form to a record book
// ---------------------------------------------------------------------------

export const saveToBook = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    formKey: v.string(),
    name: v.string(),
    includePast: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const connection = await formsConnection(ctx, args.workspaceId);
    if (!connection) throw new ConvexError("Magic Forms is not connected.");
    const item = connection.items.find((form) => form.key === args.formKey);
    if (!item) throw new ConvexError("That form is not published in Magic Forms.");

    const accountId = connection.account.id;
    const already = (await booksByForm(ctx, args.workspaceId, accountId)).get(
      item.key
    );
    if (already) {
      throw new ConvexError(`${item.title} is already saved to ${already.pluralName}.`);
    }

    const name = args.name.trim() || item.title;
    const { bookId } = await insertBook(ctx, {
      workspaceId: args.workspaceId,
      name,
      // A form's title is rarely a noun that takes an "s": "Contact us".
      pluralName: name,
      purpose: `A response to the “${item.title}” form in Magic Forms. Submissions are filed here on their own; file one yourself only when the customer gives these details in the chat instead.`,
      fields: formBookFields(item.prefill ?? []),
      // Complete as made, so nothing is left to finish before it is useful.
      // No agent has it switched on until someone does that on purpose.
      status: "active",
      formSource: { app: "magic_forms", accountId, formKey: item.key },
    });

    if (args.includePast) {
      await ctx.scheduler.runAfter(0, internal.formSubmissions.fileBacklog, {
        bookId,
      });
    }
    return { bookId };
  },
});

/** Stops filing new submissions. The book and its records stay as they are. */
export const stopSaving = mutation({
  args: { bookId: v.id("recordBooks") },
  handler: async (ctx, args) => {
    await requireRecordBook(ctx, args.bookId);
    await ctx.db.patch(args.bookId, {
      formSource: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Files one submission its form's book does not have yet. */
export const fileOne = mutation({
  args: { submissionId: v.id("formSubmissions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("formSubmissions", args.submissionId);
    if (!row) throw new ConvexError("Submission not found");
    await requireWorkspace(ctx, row.workspaceId);

    const book = (await booksByForm(ctx, row.workspaceId, row.accountId)).get(
      row.formKey
    );
    if (!book) throw new ConvexError(`${row.formTitle} is not saved to a record book.`);
    if (book.status === "archived") {
      throw new ConvexError(`${book.pluralName} is archived. Reopen it first.`);
    }
    const existing = row.recordId ? await ctx.db.get("records", row.recordId) : null;
    if (existing?.bookId === book._id) {
      return { recordId: existing._id, reference: existing.reference };
    }
    const recordId = await fileSubmission(ctx, book, row, false);
    const record = await ctx.db.get("records", recordId);
    return { recordId, reference: record?.reference ?? "" };
  },
});

/**
 * Files every stored submission of a book's form that is not in it yet, a
 * batch at a time. One already filed in *another* book — saved, stopped, then
 * saved to a new one — is filed again here, and points at the new record.
 */
export const fileBacklog = internalMutation({
  args: { bookId: v.id("recordBooks"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const book = await ctx.db.get("recordBooks", args.bookId);
    const source = book?.formSource;
    if (!book || !source || book.status === "archived") return;

    const batch = await ctx.db
      .query("formSubmissions")
      .withIndex("by_account_form", (q) =>
        q
          .eq("workspaceId", book.workspaceId)
          .eq("accountId", source.accountId)
          .eq("formKey", source.formKey)
      )
      .order("asc")
      .paginate({ numItems: BACKLOG_BATCH, cursor: args.cursor ?? null });

    for (const row of batch.page) {
      const existing = row.recordId
        ? await ctx.db.get("records", row.recordId)
        : null;
      if (existing?.bookId === book._id) continue;
      await fileSubmission(ctx, book, row, false);
    }

    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, internal.formSubmissions.fileBacklog, {
        bookId: args.bookId,
        cursor: batch.continueCursor,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Reading history back from Magic Forms
// ---------------------------------------------------------------------------

/**
 * Pulls the latest submissions from Magic Forms and keeps the ones not here
 * yet — for the "Sync" button, and before a book takes in a form's past.
 */
export const sync = action({
  args: { workspaceId: v.id("workspaces"), formKey: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ fetched: number; added: number }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    const connection = await ctx.runQuery(internal.apps.connectionFor, {
      workspaceId: args.workspaceId,
      app: "magic_forms",
    });
    if (!connection) throw new ConvexError("Magic Forms is not connected.");

    const query = new URLSearchParams({ limit: String(SYNC_LIMIT) });
    if (args.formKey) query.set("form", args.formKey);
    const response = await callApp(
      connection,
      "GET",
      `/api/v1/submissions?${query.toString()}`
    );
    if (!response.ok) throw new ConvexError(response.error ?? "Unknown error.");

    const submissions = readSubmissions(response.body, connection.items);
    const added: number = await ctx.runMutation(
      internal.formSubmissions.storeImported,
      {
        workspaceId: args.workspaceId,
        accountId: connection.account.id,
        submissions,
      }
    );
    return { fetched: submissions.length, added };
  },
});

export const storeImported = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountId: v.string(),
    submissions: v.array(submissionShape),
  },
  handler: async (ctx, args): Promise<number> => {
    let added = 0;
    for (const submission of args.submissions) {
      // Came through a link an agent sent: tie it to that conversation, the
      // same as the webhook would have.
      const sent = submission.ref
        ? await ctx.db
            .query("appLinks")
            .withIndex("by_ref", (q) => q.eq("ref", submission.ref!))
            .unique()
        : null;
      const link =
        sent && sent.workspaceId === args.workspaceId
          ? {
              conversationId: sent.conversationId,
              contactId: sent.contactId,
              agentId: sent.agentId,
            }
          : null;
      const stored = await storeSubmission(ctx, {
        workspaceId: args.workspaceId,
        accountId: args.accountId,
        submission,
        link,
        fromWebhook: false,
      });
      if (stored) added += 1;
    }
    return added;
  },
});
