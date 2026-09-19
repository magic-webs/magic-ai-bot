// Record books, the records filed into them, and where those events go.
//
// The vocabulary, once: a *record book* is a kind of thing this company keeps —
// Memberships, Appointments, Site visits. A *record* is one filed instance of
// it. An agent switched on for a book gets tools named after it and files
// records by calling them. See `lib/records.ts` for why the shape is data
// rather than a table per vertical.

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair, requirementField } from "./schema";
import { buildSearchBlob } from "./lib/shared";
import {
  checkValues,
  makeReference,
  mergeValues,
  referenceAlphabet,
  suggestPrefix,
  toHandle,
  wireEventName,
  type RecordEvent,
  type RecordField,
} from "./lib/records";
import { postWebhook } from "./lib/webhookDelivery";
import {
  requireRecord,
  requireRecordBook,
  requireRecordWebhook,
  requireWorkspace,
} from "./lib/auth";

const recordEvent = v.union(
  v.literal("filed"),
  v.literal("updated"),
  v.literal("stage_changed")
);

const bookStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("archived")
);

const personShape = v.object({
  name: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  company: v.optional(v.string()),
});

type Person = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
};

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

function searchBlobFor(
  reference: string,
  person: Person | undefined,
  values: Array<{ key: string; value: string }>
): string {
  return buildSearchBlob([
    reference,
    person?.name,
    person?.phone,
    person?.email,
    person?.company,
    ...values.map((pair) => pair.value),
  ]);
}

/** Drops the keys a caller left empty, so they cannot overwrite a stored one. */
function stripBlank(person: Person): Person {
  const out: Person = {};
  for (const [key, value] of Object.entries(person)) {
    if (typeof value === "string" && value.trim()) {
      out[key as keyof Person] = value.trim();
    }
  }
  return out;
}

/**
 * The details as a plain object, which is what a receiving endpoint wants.
 *
 * Stored as pairs because the keys are the workspace's, but nobody writing a
 * Zapier step wants to iterate an array to find `plan`.
 */
function detailsObject(
  values: Array<{ key: string; value: string }>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of values) out[pair.key] = pair.value;
  return out;
}

/**
 * A reference nobody else in the workspace already has.
 *
 * Six random characters out of a 32-letter alphabet is a billion per prefix, so
 * a collision needs a workspace with millions of records — but "needs" is not
 * "cannot", and a duplicate reference is the one thing that would make the find
 * tool answer the wrong customer. Three tries, then a longer one.
 */
async function freshReference(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  prefix: string
): Promise<string> {
  const alphabet = referenceAlphabet();
  const draw = (length: number) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const byte of bytes) out += alphabet[byte % alphabet.length];
    return out;
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = makeReference(prefix, draw(6));
    const clash = await ctx.db
      .query("records")
      .withIndex("by_workspace_reference", (q) =>
        q.eq("workspaceId", workspaceId).eq("reference", candidate)
      )
      .first();
    if (!clash) return candidate;
  }
  return makeReference(prefix, draw(10));
}

// ---------------------------------------------------------------------------
// Books — the dashboard side
// ---------------------------------------------------------------------------

export const listBooks = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const books = await ctx.db
      .query("recordBooks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // The count is the whole reason to open this page, so it is worth the read
    // rather than making every row a second query from the client.
    const withCounts = await Promise.all(
      books.map(async (book) => {
        const rows = await ctx.db
          .query("records")
          .withIndex("by_book", (q) => q.eq("bookId", book._id))
          .take(501);
        const hooks = await ctx.db
          .query("recordWebhooks")
          .withIndex("by_book", (q) => q.eq("bookId", book._id))
          .collect();
        return {
          ...book,
          recordCount: rows.length,
          // Past 500 the exact figure stops being interesting and starts being
          // expensive. The page says "500+".
          recordCountExact: rows.length <= 500,
          webhookCount: hooks.filter((hook) => hook.enabled).length,
        };
      })
    );

    return withCounts.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getBook = query({
  args: { bookId: v.id("recordBooks") },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", book.workspaceId))
      .collect();
    return {
      book,
      // Who actually files into it. A book switched on for nobody collects
      // nothing, and that is worth saying on the page rather than leaving the
      // team to work out from the empty table.
      filedBy: agents
        .filter((agent) => (agent.recordBooks ?? []).includes(book._id))
        .map((agent) => ({
          _id: agent._id,
          botName: agent.botName,
          name: agent.name,
          status: agent.status,
        })),
    };
  },
});

export const createBook = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    pluralName: v.optional(v.string()),
    purpose: v.optional(v.string()),
    fields: v.optional(v.array(requirementField)),
    stages: v.optional(v.array(v.string())),
    referencePrefix: v.optional(v.string()),
    allowLookup: v.optional(v.boolean()),
    allowUpdate: v.optional(v.boolean()),
    status: v.optional(bookStatus),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const name = args.name.trim();
    if (!name) throw new Error("Give the record a name, such as “Membership”.");

    // The handle is the model's tool name, so two books cannot share one —
    // `file_membership` can only mean one thing.
    const base = toHandle(name);
    const existing = await ctx.db
      .query("recordBooks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const taken = new Set(existing.map((book) => book.handle));
    let handle = base;
    let suffix = 2;
    while (taken.has(handle)) {
      handle = `${base}_${suffix}`;
      suffix += 1;
    }

    const now = Date.now();
    const bookId = await ctx.db.insert("recordBooks", {
      workspaceId: args.workspaceId,
      name,
      pluralName: args.pluralName?.trim() || `${name}s`,
      handle,
      purpose: args.purpose?.trim() || "",
      fields: args.fields ?? [],
      stages: (args.stages ?? []).map((stage) => stage.trim()).filter(Boolean),
      referencePrefix:
        args.referencePrefix?.trim().toUpperCase() || suggestPrefix(name),
      allowLookup: args.allowLookup ?? true,
      allowUpdate: args.allowUpdate ?? true,
      // Draft, so a half-written book is never handed to a live agent. The
      // page's own switch is what turns it on.
      status: args.status ?? "draft",
      createdAt: now,
      updatedAt: now,
    });

    return { bookId, handle };
  },
});

export const updateBook = mutation({
  args: {
    bookId: v.id("recordBooks"),
    name: v.optional(v.string()),
    pluralName: v.optional(v.string()),
    purpose: v.optional(v.string()),
    fields: v.optional(v.array(requirementField)),
    stages: v.optional(v.array(v.string())),
    referencePrefix: v.optional(v.string()),
    allowLookup: v.optional(v.boolean()),
    allowUpdate: v.optional(v.boolean()),
    status: v.optional(bookStatus),
  },
  handler: async (ctx, args) => {
    await requireRecordBook(ctx, args.bookId);
    const { bookId, ...rest } = args;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    if (typeof patch.name === "string") {
      const name = patch.name.trim();
      if (!name) throw new Error("A record book needs a name.");
      patch.name = name;
      // The handle is deliberately not recomputed: it is the model's tool name
      // and the agents' job descriptions are written around it, so a rename in
      // the dashboard must not silently retire `file_membership`.
    }
    if (typeof patch.referencePrefix === "string") {
      patch.referencePrefix =
        patch.referencePrefix.trim().toUpperCase() || undefined;
      if (!patch.referencePrefix) delete patch.referencePrefix;
    }
    if (Array.isArray(patch.stages)) {
      patch.stages = (patch.stages as string[])
        .map((stage) => stage.trim())
        .filter(Boolean);
    }

    await ctx.db.patch(bookId, patch);
    return { success: true };
  },
});

export const removeBook = mutation({
  args: { bookId: v.id("recordBooks") },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);

    // Everything hanging off the book goes with it: its records, its
    // destinations, its delivery log, and the switch on every agent that had
    // it on. A leftover id on an agent is invisible in the dashboard and would
    // sit in `recordBooks` forever.
    const records = await ctx.db
      .query("records")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .collect();
    for (const record of records) await ctx.db.delete(record._id);

    const hooks = await ctx.db
      .query("recordWebhooks")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .collect();
    for (const hook of hooks) await ctx.db.delete(hook._id);

    const deliveries = await ctx.db
      .query("webhookEvents")
      .withIndex("by_book", (q) => q.eq("recordBookId", args.bookId))
      .collect();
    for (const delivery of deliveries) await ctx.db.delete(delivery._id);

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", book.workspaceId))
      .collect();
    for (const agent of agents) {
      const enabled = agent.recordBooks ?? [];
      if (!enabled.includes(args.bookId)) continue;
      await ctx.db.patch(agent._id, {
        recordBooks: enabled.filter((id) => id !== args.bookId),
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete(args.bookId);
    return { success: true, deletedRecords: records.length };
  },
});

// ---------------------------------------------------------------------------
// Records — the dashboard side
// ---------------------------------------------------------------------------

export const listRecords = query({
  args: {
    bookId: v.id("recordBooks"),
    stage: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    const limit = args.limit ?? 100;

    const term = args.search?.trim();
    const rows = term
      ? await ctx.db
          .query("records")
          .withSearchIndex("search_records", (q) =>
            q.search("searchBlob", term.toLowerCase()).eq("bookId", args.bookId)
          )
          .take(limit)
      : args.stage
        ? await ctx.db
            .query("records")
            .withIndex("by_book_stage", (q) =>
              q.eq("bookId", args.bookId).eq("stage", args.stage)
            )
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("records")
            .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
            .order("desc")
            .take(limit);

    // A search index cannot also filter by stage, so that pass happens here.
    const filtered =
      term && args.stage
        ? rows.filter((row) => row.stage === args.stage)
        : rows;

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", book.workspaceId))
      .collect();
    const byId = new Map(agents.map((agent) => [agent._id, agent.botName]));

    return filtered.map((row) => ({
      ...row,
      filedBy: row.agentId ? (byId.get(row.agentId) ?? null) : null,
    }));
  },
});

export const getRecord = query({
  args: { recordId: v.id("records") },
  handler: async (ctx, args) => {
    const record = await requireRecord(ctx, args.recordId);
    const book = await ctx.db.get("recordBooks", record.bookId);
    const agent = record.agentId
      ? await ctx.db.get("agents", record.agentId)
      : null;
    const contact = record.contactId
      ? await ctx.db.get("contacts", record.contactId)
      : null;
    return {
      record,
      book,
      filedBy: agent?.botName ?? null,
      contactName: contact?.name ?? null,
    };
  },
});

/** Typed in by the team rather than collected — "someone rang the office". */
export const createRecord = mutation({
  args: {
    bookId: v.id("recordBooks"),
    person: v.optional(personShape),
    values: v.array(kvPair),
    stage: v.optional(v.string()),
    notes: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
  },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    if (book.status === "archived") {
      throw new Error(
        `${book.pluralName} is archived. Reopen it before adding records.`
      );
    }

    const checked = checkValues(
      book.fields as RecordField[],
      detailsObject(args.values)
    );
    if (checked.missing.length > 0) {
      throw new Error(`Still needed: ${checked.missing.join(", ")}.`);
    }
    if (checked.problems.length > 0) {
      throw new Error(checked.problems.join(" "));
    }

    const now = Date.now();
    const reference = await freshReference(
      ctx,
      book.workspaceId,
      book.referencePrefix
    );
    const stage = args.stage ?? book.stages[0];

    const recordId = await ctx.db.insert("records", {
      workspaceId: book.workspaceId,
      bookId: args.bookId,
      reference,
      contactId: args.contactId,
      person: args.person,
      values: checked.values,
      stage,
      notes: args.notes?.trim() || undefined,
      source: "manual",
      searchBlob: searchBlobFor(reference, args.person, checked.values),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.records.announce, {
      recordId,
      event: "filed",
      byAgent: false,
    });

    return { recordId, reference };
  },
});

export const updateRecord = mutation({
  args: {
    recordId: v.id("records"),
    person: v.optional(personShape),
    values: v.optional(v.array(kvPair)),
    stage: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await requireRecord(ctx, args.recordId);
    const book = await ctx.db.get("recordBooks", record.bookId);
    if (!book) throw new Error("Record book not found");

    const values = args.values
      ? checkValues(book.fields as RecordField[], detailsObject(args.values))
          .values
      : record.values;
    const person = args.person ?? record.person;
    const stageChanged =
      args.stage !== undefined && args.stage !== record.stage;

    await ctx.db.patch(args.recordId, {
      person,
      values,
      stage: args.stage ?? record.stage,
      notes:
        args.notes === undefined
          ? record.notes
          : args.notes.trim() || undefined,
      searchBlob: searchBlobFor(record.reference, person, values),
      updatedAt: Date.now(),
    });

    // A stage move is its own event: an endpoint that wants to know when a
    // site visit is booked should not have to diff two payloads to find out.
    await ctx.scheduler.runAfter(0, internal.records.announce, {
      recordId: args.recordId,
      event: stageChanged ? "stage_changed" : "updated",
      previousStage: stageChanged ? record.stage : undefined,
      byAgent: false,
    });

    return { success: true };
  },
});

export const removeRecord = mutation({
  args: { recordId: v.id("records") },
  handler: async (ctx, args) => {
    await requireRecord(ctx, args.recordId);
    await ctx.db.delete(args.recordId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Where a book's events go
// ---------------------------------------------------------------------------

export const listWebhooks = query({
  args: { bookId: v.id("recordBooks") },
  handler: async (ctx, args) => {
    await requireRecordBook(ctx, args.bookId);
    return await ctx.db
      .query("recordWebhooks")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .collect();
  },
});

/** The book's own delivery log — every destination, most recent first. */
export const listDeliveries = query({
  args: { bookId: v.id("recordBooks"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRecordBook(ctx, args.bookId);
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_book", (q) => q.eq("recordBookId", args.bookId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const createWebhook = mutation({
  args: {
    bookId: v.id("recordBooks"),
    name: v.string(),
    url: v.string(),
    secret: v.optional(v.string()),
    headers: v.optional(v.array(kvPair)),
    events: v.optional(v.array(recordEvent)),
  },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    const url = args.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("The address has to start with http:// or https://.");
    }

    const now = Date.now();
    const webhookId = await ctx.db.insert("recordWebhooks", {
      workspaceId: book.workspaceId,
      bookId: args.bookId,
      name: args.name.trim() || "Webhook",
      url,
      secret: args.secret?.trim() || undefined,
      headers: args.headers ?? [],
      // Filing is the event everyone wants; the other two are opt-in.
      events: args.events?.length ? args.events : ["filed"],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    return { webhookId };
  },
});

export const updateWebhook = mutation({
  args: {
    webhookId: v.id("recordWebhooks"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    secret: v.optional(v.string()),
    headers: v.optional(v.array(kvPair)),
    events: v.optional(v.array(recordEvent)),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRecordWebhook(ctx, args.webhookId);
    const { webhookId, ...rest } = args;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    if (typeof patch.url === "string") {
      const url = patch.url.trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("The address has to start with http:// or https://.");
      }
      patch.url = url;
    }
    // An empty box means "no secret", which is different from "leave it alone"
    // — the caller omits the argument for that.
    if (typeof patch.secret === "string" && !patch.secret.trim()) {
      patch.secret = undefined;
    }

    await ctx.db.patch(webhookId, patch);
    return { success: true };
  },
});

export const removeWebhook = mutation({
  args: { webhookId: v.id("recordWebhooks") },
  handler: async (ctx, args) => {
    await requireRecordWebhook(ctx, args.webhookId);
    await ctx.db.delete(args.webhookId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Everything `announce` needs, read in one go. */
export const deliveryContext = internalQuery({
  args: { recordId: v.id("records") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get("records", args.recordId);
    if (!record) return null;
    const book = await ctx.db.get("recordBooks", record.bookId);
    const workspace = await ctx.db.get("workspaces", record.workspaceId);
    if (!book || !workspace) return null;
    const agent = record.agentId
      ? await ctx.db.get("agents", record.agentId)
      : null;
    const hooks = await ctx.db
      .query("recordWebhooks")
      .withIndex("by_book", (q) => q.eq("bookId", record.bookId))
      .collect();

    return {
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
      },
      book: {
        _id: book._id,
        name: book.name,
        pluralName: book.pluralName,
        handle: book.handle,
      },
      record: {
        id: record._id,
        reference: record.reference,
        stage: record.stage ?? null,
        person: record.person ?? null,
        details: detailsObject(record.values),
        notes: record.notes ?? null,
        source: record.source,
        filedBy: agent?.botName ?? null,
        conversationId: record.conversationId ?? null,
        contactId: record.contactId ?? null,
        createdAt: new Date(record.createdAt).toISOString(),
        updatedAt: new Date(record.updatedAt).toISOString(),
      },
      hooks: hooks.map((hook) => ({
        _id: hook._id,
        name: hook.name,
        url: hook.url,
        secret: hook.secret,
        headers: hook.headers,
        events: hook.events,
        enabled: hook.enabled,
      })),
    };
  },
});

export const noteDelivery = internalMutation({
  args: {
    webhookId: v.id("recordWebhooks"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const hook = await ctx.db.get("recordWebhooks", args.webhookId);
    if (!hook) return;
    await ctx.db.patch(args.webhookId, {
      lastStatus: args.status,
      lastResponseStatus: args.responseStatus,
      lastError: args.error?.slice(0, 500),
      lastDeliveredAt: Date.now(),
    });
  },
});

/**
 * Tell everyone who asked to be told.
 *
 * Scheduled rather than awaited by the tool call that caused it, so a slow or
 * broken endpoint cannot hold up a customer waiting on a reply. That is the one
 * place this differs from `create_order`, which still blocks on its webhook.
 */
export const announce = internalAction({
  args: {
    recordId: v.id("records"),
    event: recordEvent,
    previousStage: v.optional(v.string()),
    /**
     * True when an agent did this, false when the team did it themselves from
     * the records page. Only the phone cares: a webhook wants both, but a push
     * about the edit you just made in another tab is how notifications get
     * switched off.
     */
    byAgent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.records.deliveryContext, {
      recordId: args.recordId,
    });
    if (!context) return;

    const wireName = wireEventName(args.event as RecordEvent);
    const data = {
      book: {
        name: context.book.name,
        plural: context.book.pluralName,
        handle: context.book.handle,
      },
      record: context.record,
      ...(args.previousStage ? { previousStage: args.previousStage } : {}),
    };

    // The workspace endpoint first, and unconditionally: it is the one that
    // also drives the push notification, and a workspace that set it up before
    // record books existed expects every platform event through it.
    await ctx.runAction(internal.webhooks.deliver, {
      workspaceId: context.workspace._id,
      event: wireName,
      data,
      recordBookId: context.book._id,
      push: args.byAgent,
    });

    const body = JSON.stringify({
      event: wireName,
      workspace: context.workspace,
      timestamp: new Date().toISOString(),
      data,
    });

    const subscribed = context.hooks.filter(
      (hook) => hook.enabled && hook.events.includes(args.event)
    );

    // In parallel: one endpoint taking its ten seconds must not decide how long
    // the next one waits.
    await Promise.all(
      subscribed.map(async (hook) => {
        const result = await postWebhook({
          url: hook.url,
          body,
          event: wireName,
          workspaceSlug: context.workspace.slug,
          secret: hook.secret,
          headers: hook.headers,
        });

        await ctx.runMutation(internal.records.noteDelivery, {
          webhookId: hook._id,
          status: result.ok ? "sent" : "failed",
          responseStatus: result.responseStatus,
          error: result.error,
        });
        await ctx.runMutation(internal.webhooks.logEvent, {
          workspaceId: context.workspace._id,
          event: wireName,
          payload: body,
          status: result.ok ? "sent" : "failed",
          responseStatus: result.responseStatus,
          error: result.error,
          recordBookId: context.book._id,
          destination: hook.name,
        });
      })
    );
  },
});

/** "Send test event" on one destination. */
export const sendTestWebhook = action({
  args: { webhookId: v.id("recordWebhooks") },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; responseStatus?: number; error?: string }> => {
    const hook = await ctx.runQuery(internal.records.webhookForTest, {
      webhookId: args.webhookId,
    });
    if (!hook) throw new Error("Webhook not found");

    const wireName = wireEventName("filed");
    const body = JSON.stringify({
      event: wireName,
      workspace: hook.workspace,
      timestamp: new Date().toISOString(),
      test: true,
      data: {
        book: {
          name: hook.book.name,
          plural: hook.book.pluralName,
          handle: hook.book.handle,
        },
        // A worked example rather than `{"test": true}`, so whoever is building
        // the other end can map their fields from the first delivery.
        record: {
          id: "test",
          reference: `${hook.book.referencePrefix}-TESTXX`,
          stage: hook.book.stages[0] ?? null,
          person: {
            name: "Test Person",
            phone: "+440000000000",
            email: "test@example.com",
          },
          details: Object.fromEntries(
            hook.book.fields.map((field) => [
              field.key,
              field.example || `Example ${field.label.toLowerCase()}`,
            ])
          ),
          notes: "This is a test delivery from Magic Agent.",
          source: "api",
          filedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const result = await postWebhook({
      url: hook.url,
      body,
      event: wireName,
      workspaceSlug: hook.workspace.slug,
      secret: hook.secret,
      headers: hook.headers,
    });

    await ctx.runMutation(internal.records.noteDelivery, {
      webhookId: args.webhookId,
      status: result.ok ? "sent" : "failed",
      responseStatus: result.responseStatus,
      error: result.error,
    });
    await ctx.runMutation(internal.webhooks.logEvent, {
      workspaceId: hook.workspace._id,
      event: wireName,
      payload: body,
      status: result.ok ? "sent" : "failed",
      responseStatus: result.responseStatus,
      error: result.error,
      recordBookId: hook.book._id,
      destination: `${hook.name} (test)`,
    });

    return {
      success: result.ok,
      responseStatus: result.responseStatus,
      error: result.error,
    };
  },
});

export const webhookForTest = internalQuery({
  args: { webhookId: v.id("recordWebhooks") },
  handler: async (ctx, args) => {
    // Guarded even though only `sendTestWebhook` calls it: an internal query
    // that reads a secret has to answer "who is asking" the same way the public
    // ones do.
    const hook = await requireRecordWebhook(ctx, args.webhookId);
    const book = await ctx.db.get("recordBooks", hook.bookId);
    const workspace = await ctx.db.get("workspaces", hook.workspaceId);
    if (!book || !workspace) return null;
    return {
      ...hook,
      book,
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Internal — backing the file_ / find_ / update_ tools
// ---------------------------------------------------------------------------

/** The books this agent may file into, ready to be turned into tools. */
export const booksForAgent = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) return [];
    const enabled = agent.recordBooks ?? [];
    if (enabled.length === 0) return [];

    const books = await Promise.all(
      enabled.map((bookId) => ctx.db.get("recordBooks", bookId))
    );
    return books.filter(
      (book): book is Doc<"recordBooks"> =>
        // A draft book is never handed to the model, and an archived one keeps
        // its records readable without collecting more. Same rule as tools.
        book !== null &&
        book.status === "active" &&
        book.workspaceId === agent.workspaceId
    );
  },
});

export const fileFromTool = internalMutation({
  args: {
    bookId: v.id("recordBooks"),
    agentId: v.id("agents"),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    source: v.union(v.literal("whatsapp"), v.literal("web"), v.literal("api")),
    person: v.optional(personShape),
    values: v.array(kvPair),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const book = await ctx.db.get("recordBooks", args.bookId);
    if (!book) throw new Error("Record book not found");

    const now = Date.now();
    const reference = await freshReference(
      ctx,
      book.workspaceId,
      book.referencePrefix
    );
    const stage = book.stages[0];

    const recordId = await ctx.db.insert("records", {
      workspaceId: book.workspaceId,
      bookId: args.bookId,
      reference,
      agentId: args.agentId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      person: args.person,
      values: args.values,
      stage,
      notes: args.notes,
      source: args.source,
      searchBlob: searchBlobFor(reference, args.person, args.values),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.records.announce, {
      recordId,
      event: "filed",
      byAgent: true,
    });

    return { recordId, reference, stage: stage ?? null };
  },
});

export const findForTool = internalQuery({
  args: {
    bookId: v.id("recordBooks"),
    workspaceId: v.id("workspaces"),
    reference: v.optional(v.string()),
    search: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 5, 20);

    // A reference is exact, so it answers on its own even when the record
    // belongs to somebody else in the same workspace — quoting it is how a
    // customer proves which one they mean.
    if (args.reference?.trim()) {
      const hit = await ctx.db
        .query("records")
        .withIndex("by_workspace_reference", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("reference", args.reference!.trim().toUpperCase())
        )
        .first();
      return hit && hit.bookId === args.bookId ? [hit] : [];
    }

    const term = args.search?.trim();
    if (term) {
      const hits = await ctx.db
        .query("records")
        .withSearchIndex("search_records", (q) =>
          q.search("searchBlob", term.toLowerCase()).eq("bookId", args.bookId)
        )
        .take(limit);
      return hits;
    }

    // Nothing to go on but who we are talking to. Better than nothing: "what's
    // my appointment" is the commonest question this tool answers.
    if (args.contactId) {
      const mine = await ctx.db
        .query("records")
        .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
        .order("desc")
        .take(50);
      return mine.filter((row) => row.bookId === args.bookId).slice(0, limit);
    }

    return [];
  },
});

export const updateFromTool = internalMutation({
  args: {
    recordId: v.id("records"),
    bookId: v.id("recordBooks"),
    person: v.optional(personShape),
    values: v.optional(v.array(kvPair)),
    stage: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get("records", args.recordId);
    if (!record) throw new Error("Record not found");
    // The tool resolves the record by reference, and a reference is only unique
    // within a workspace — so the book has to be checked here rather than
    // trusted from the lookup.
    if (record.bookId !== args.bookId) {
      throw new Error("That reference belongs to a different kind of record.");
    }

    const values = args.values
      ? mergeValues(record.values, args.values)
      : record.values;
    // Field by field, not wholesale: the model passes the one detail it is
    // correcting, and replacing the object would wipe the email because this
    // call was about the phone number.
    const person = args.person
      ? { ...record.person, ...stripBlank(args.person) }
      : record.person;
    const stageChanged =
      args.stage !== undefined && args.stage !== record.stage;

    await ctx.db.patch(args.recordId, {
      person,
      values,
      stage: args.stage ?? record.stage,
      notes: args.notes ?? record.notes,
      searchBlob: searchBlobFor(record.reference, person, values),
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.records.announce, {
      recordId: args.recordId,
      event: stageChanged ? "stage_changed" : "updated",
      previousStage: stageChanged ? record.stage : undefined,
      byAgent: true,
    });

    return { reference: record.reference, stage: args.stage ?? record.stage };
  },
});
