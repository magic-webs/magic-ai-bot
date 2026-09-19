/**
 * Records — what a workspace collects that is not an order.
 *
 * A *record book* is a kind of thing this business keeps: Memberships,
 * Appointments, Site visits, Quotations. Each one hands the agents switched on
 * for it tools named after itself — `file_membership`, `find_membership`,
 * `update_membership` — so the model picks a tool rather than a string
 * argument. Filed records can be sent on to another system as they happen.
 *
 * The distinction worth holding on to when configuring a workspace: `orders`
 * is for things sold out of the catalogue, with products and prices behind it.
 * Everything else a conversation produces — someone joining, someone booking,
 * someone asking for a price on work that is not a catalogue line — belongs in
 * a record book.
 */

import { z } from "zod";
import { kvArg, requirementFieldArg, workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findRecordBook, findRecordWebhook } from "../lookup.mjs";
import { handler, ok, recordBookBrief } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const RECORD_EVENTS = ["filed", "updated", "stage_changed"];

const eventsArg = z
  .array(z.enum(RECORD_EVENTS))
  .optional()
  .describe(
    "Which moments to send. 'filed' is a new record; 'updated' is a detail changing; 'stage_changed' is a move between stages. Defaults to ['filed'] on create."
  );

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  // -------------------------------------------------------------- the books

  server.registerTool(
    "list_record_books",
    {
      title: "List record books",
      description:
        "Every kind of record this workspace keeps — memberships, appointments, site visits — with how many have been filed and which tool names each one gives an agent. Only 'active' books are handed to agents; 'draft' is editable but collects nothing.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const books = await call.query(api.records.listBooks, {
        workspaceId: found._id,
      });
      return ok(books.map(recordBookBrief));
    })
  );

  server.registerTool(
    "create_record_book",
    {
      title: "Create record book",
      description:
        "Define something this business collects: a membership, an appointment, a quotation. Name it in the singular — the tool the agents get is named after it, so 'Membership' becomes file_membership. Starts as a draft; set status 'active' and switch it on for an agent with update_agent's `records` before anything is collected.",
      inputSchema: {
        ...workspaceArg,
        name: z
          .string()
          .describe("Singular, as one of them is spoken about: 'Membership'"),
        pluralName: z
          .string()
          .optional()
          .describe("For headings and the prompt. Defaults to name + 's'."),
        purpose: z
          .string()
          .optional()
          .describe(
            "Model-facing 'file one of these when…'. This is what decides when the tool gets called, so write it as an instruction."
          ),
        fields: z
          .array(requirementFieldArg)
          .optional()
          .describe(
            "The details to collect. Every required one must be answered before a record can be filed — the agent is told to go back and ask rather than invent."
          ),
        stages: z
          .array(z.string())
          .optional()
          .describe(
            "What one moves through after filing: ['Requested','Confirmed','Attended']. The first is where a new one starts. Omit for a thing that simply happened."
          ),
        referencePrefix: z
          .string()
          .optional()
          .describe("'MEM' makes references read MEM-H4K82Q. Derived from the name if omitted."),
        allowLookup: z
          .boolean()
          .optional()
          .describe("Agents get find_<name>, so a customer can ask about an existing one. Default true."),
        allowUpdate: z
          .boolean()
          .optional()
          .describe("Agents get update_<name>, for rescheduling and cancelling. Default true."),
        status: z.enum(["draft", "active", "archived"]).optional(),
      },
    },
    handler(async ({ workspace, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const created = await call.mutation(api.records.createBook, {
        workspaceId: found._id,
        ...fields,
      });
      return ok({
        bookId: created.bookId,
        handle: created.handle,
        toolsAgentsWillGet: [
          `file_${created.handle}`,
          `find_${created.handle}`,
          `update_${created.handle}`,
        ],
        next: "Set status 'active', then switch it on for an agent with update_agent's `records`. A book nobody files into collects nothing.",
      });
    })
  );

  server.registerTool(
    "update_record_book",
    {
      title: "Update record book",
      description:
        "Change what a record collects, what stages it moves through, or whether it is live. Renaming it does NOT rename the agents' tools — the handle is fixed at creation so a rename cannot retire a tool an agent's job description mentions.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
        name: z.string().optional(),
        pluralName: z.string().optional(),
        purpose: z.string().optional(),
        fields: z
          .array(requirementFieldArg)
          .optional()
          .describe("Replaces the whole list"),
        stages: z
          .array(z.string())
          .optional()
          .describe("Replaces the whole list. The first is where a new record starts."),
        referencePrefix: z.string().optional(),
        allowLookup: z.boolean().optional(),
        allowUpdate: z.boolean().optional(),
        status: z
          .enum(["draft", "active", "archived"])
          .optional()
          .describe("'active' collects; 'draft' is handed to no agent; 'archived' keeps the records readable and stops new ones."),
      },
    },
    handler(async ({ workspace, book, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      await call.mutation(api.records.updateBook, {
        bookId: target._id,
        ...fields,
      });
      return ok(`Updated ${target.pluralName}.`);
    })
  );

  server.registerTool(
    "delete_record_book",
    {
      title: "Delete record book",
      description:
        "Permanently delete a record book AND every record filed into it, its destinations and its delivery history. Agents lose the tools it gave them. Cannot be undone — archive it instead if the records still matter.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, book }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const result = await call.mutation(api.records.removeBook, {
        bookId: target._id,
      });
      return ok(
        `Deleted ${target.pluralName} and ${result.deletedRecords} filed record(s).`
      );
    })
  );

  // ------------------------------------------------------- what was filed

  server.registerTool(
    "list_records",
    {
      title: "List filed records",
      description:
        "What has actually been collected into one record book — the memberships registered, the appointments booked. Newest first.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
        stage: z.string().optional().describe("Only records at this stage"),
        search: z
          .string()
          .optional()
          .describe("Matches the reference, the person and any collected detail"),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, book, ...filters }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const rows = await call.query(api.records.listRecords, {
        bookId: target._id,
        ...filters,
      });
      return ok(
        rows.map((row) => ({
          id: row._id,
          reference: row.reference,
          stage: row.stage ?? null,
          person: row.person ?? null,
          details: Object.fromEntries(
            row.values.map((pair) => [pair.key, pair.value])
          ),
          notes: row.notes ?? null,
          source: row.source,
          filedBy: row.filedBy,
          filedAt: new Date(row.createdAt).toISOString(),
        }))
      );
    })
  );

  // ----------------------------------------------------- where they go next

  server.registerTool(
    "list_record_webhooks",
    {
      title: "List record destinations",
      description:
        "Where one record book's events are POSTed as they happen, and how the last delivery to each went. The workspace's own webhook receives every event too — these are additional destinations.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, book }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const hooks = await call.query(api.records.listWebhooks, {
        bookId: target._id,
      });
      return ok(
        hooks.map((hook) => ({
          id: hook._id,
          name: hook.name,
          url: hook.url,
          events: hook.events,
          enabled: hook.enabled,
          signed: Boolean(hook.secret),
          headers: hook.headers,
          lastStatus: hook.lastStatus ?? null,
          lastResponseStatus: hook.lastResponseStatus ?? null,
          lastError: hook.lastError ?? null,
          lastDeliveredAt: hook.lastDeliveredAt
            ? new Date(hook.lastDeliveredAt).toISOString()
            : null,
        }))
      );
    })
  );

  server.registerTool(
    "create_record_webhook",
    {
      title: "Send records somewhere",
      description:
        "POST this record book's events to another system as JSON — a membership system, Zapier, a Slack relay. With a secret set, each delivery carries an X-Magic-Signature HMAC of the body, the same scheme the workspace webhook uses.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
        name: z
          .string()
          .describe("What it is, for the team: 'Zapier', 'Membership system'"),
        url: z.string().describe("https:// endpoint to POST to"),
        secret: z
          .string()
          .optional()
          .describe("Signs the body as X-Magic-Signature: sha256=…"),
        headers: z
          .array(kvArg)
          .optional()
          .describe("Extra headers, for an endpoint wanting a bearer token or API key"),
        events: eventsArg,
      },
    },
    handler(async ({ workspace, book, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const created = await call.mutation(api.records.createWebhook, {
        bookId: target._id,
        ...fields,
      });
      return ok({
        webhookId: created.webhookId,
        next: "Use test_record_webhook to send a worked example, so the other end can map its fields before a real one arrives.",
      });
    })
  );

  server.registerTool(
    "update_record_webhook",
    {
      title: "Update record destination",
      description:
        "Change where a record book's events go, which events it gets, or switch it off without deleting it.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
        webhook: z.string().describe("Destination name or id"),
        name: z.string().optional(),
        url: z.string().optional(),
        secret: z
          .string()
          .optional()
          .describe("Pass an empty string to remove the signature"),
        headers: z.array(kvArg).optional().describe("Replaces the whole list"),
        events: eventsArg.describe("Replaces the whole list"),
        enabled: z.boolean().optional(),
      },
    },
    handler(async ({ workspace, book, webhook, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const hook = await findRecordWebhook(target._id, webhook);
      await call.mutation(api.records.updateWebhook, {
        webhookId: hook._id,
        ...fields,
      });
      return ok(`Updated ${hook.name}.`);
    })
  );

  server.registerTool(
    "delete_record_webhook",
    {
      title: "Delete record destination",
      description:
        "Stop sending this record book's events to one destination, permanently. Filed records are untouched.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
        webhook: z.string().describe("Destination name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, book, webhook }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const hook = await findRecordWebhook(target._id, webhook);
      await call.mutation(api.records.removeWebhook, { webhookId: hook._id });
      return ok(`Deleted ${hook.name}.`);
    })
  );

  server.registerTool(
    "test_record_webhook",
    {
      title: "Test a record destination",
      description:
        "Send one worked example to a destination now — a realistic record built from the book's own fields, flagged `test: true`. Reports what the endpoint answered.",
      inputSchema: {
        ...workspaceArg,
        book: z.string().describe("Record book name, plural name, handle or id"),
        webhook: z.string().describe("Destination name or id"),
      },
    },
    handler(async ({ workspace, book, webhook }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findRecordBook(found._id, book);
      const hook = await findRecordWebhook(target._id, webhook);
      const result = await call.action(api.records.sendTestWebhook, {
        webhookId: hook._id,
      });
      return ok(
        result.success
          ? `${hook.name} accepted it (HTTP ${result.responseStatus}).`
          : `${hook.name} did not accept it: ${result.error ?? "no response"}`
      );
    })
  );
}
