// Orders, as a record book.
//
// Orders used to be the one hard-coded shape in the platform — their own
// table, their own create_order tool, their own page. They are now an ordinary
// record book that every workspace has: "Orders", handle `order`, so agents
// switched on for it get `file_order` and `find_order`, and the team edits its
// fields and stages like any other book's.
//
// This file is the book's starting definition and the translation between a
// record in it and the order shape older readers still ask for — the mobile
// app's Orders tab, the dashboard's by-status chart, list_orders over MCP.
//
// Pure helpers first; the two database helpers at the bottom are shared by
// every mutation that needs the book to exist.

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { RecordField } from "./records";

/** The handle that makes a book the workspace's Orders book. */
export const ORDERS_HANDLE = "order";

/**
 * The stages a new book starts with. Named after the statuses orders always
 * had, so a migrated order keeps its place and the dashboard's chart reads the
 * same. The team may rename, add or remove them — anything unrecognised
 * simply counts as "new" in the old-shape readers.
 */
export const ORDER_STAGES = [
  "New",
  "Quoted",
  "Confirmed",
  "In progress",
  "Completed",
  "Cancelled",
];

export const ORDER_STATUSES = [
  "new",
  "quoted",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDERS_BOOK: {
  name: string;
  pluralName: string;
  handle: string;
  purpose: string;
  fields: RecordField[];
  stages: string[];
  referencePrefix: string;
  allowLookup: boolean;
  allowUpdate: boolean;
} = {
  name: "Order",
  pluralName: "Orders",
  handle: ORDERS_HANDLE,
  purpose: [
    "File an order once the customer has picked what they want from the catalogue, every detail each product needs has been collected, and they have confirmed the summary back to you.",
    "Put each product on its own line in items, as quantity × product (options).",
    "Give a total only when you read every price from the catalogue in this conversation.",
  ].join(" "),
  fields: [
    {
      key: "items",
      label: "What they are ordering",
      type: "text",
      required: true,
      example: "2 × Classic tee (M, black) — one line per product",
    },
    {
      key: "delivery",
      label: "Delivery address or pickup, and when it is needed",
      type: "text",
      required: false,
      example: "12 MG Road, Pune — by Friday",
    },
    {
      key: "total",
      label: "Total, priced from the catalogue",
      type: "number",
      required: false,
    },
  ],
  stages: ORDER_STAGES,
  referencePrefix: "ORD",
  allowLookup: true,
  // The team moves an order along; an agent that could would be one message
  // away from marking something completed that nobody has made.
  allowUpdate: false,
};

const slug = (text: string) =>
  text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** The old status a stage stands for. Unknown stages read as "new". */
export function statusForStage(stage: string | undefined | null): OrderStatus {
  const key = slug(stage ?? "");
  return (ORDER_STATUSES as readonly string[]).includes(key)
    ? (key as OrderStatus)
    : "new";
}

/** The stage an old status becomes, in a book that has the default stages. */
export function stageForStatus(status: string, stages: string[]): string | undefined {
  return stages.find((stage) => slug(stage) === status) ?? stages[0];
}

/**
 * "2 × Classic tee (M, black)" per line, back into lines. The separator is a
 * new line or a semicolon — never a comma, which options are full of.
 */
export function parseItems(
  text: string | undefined
): Array<{ productName: string; quantity: string }> {
  return (text ?? "")
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|\*)\s*(.+)$/i);
      return match
        ? { quantity: match[1], productName: match[2].trim() }
        : { quantity: "1", productName: line };
    });
}

/** An old order's lines as the book's `items` text. */
export function itemsText(
  items: Array<{
    productName: string;
    quantity: string;
    specs: Array<{ key: string; value: string }>;
  }>
): string {
  return items
    .map((item) => {
      const specs = item.specs
        .filter((spec) => spec.key.trim() && spec.value.trim())
        .map((spec) => `${spec.key}: ${spec.value}`)
        .join(", ");
      return `${item.quantity} × ${item.productName}${specs ? ` (${specs})` : ""}`;
    })
    .join("\n");
}

/** An old order's delivery block as the book's `delivery` text. */
export function deliveryText(
  delivery: Doc<"orders">["delivery"]
): string | undefined {
  if (!delivery) return undefined;
  const where = [
    delivery.address,
    delivery.city,
    delivery.postcode,
    delivery.country,
  ]
    .filter((part) => part?.trim())
    .join(", ");
  const when = delivery.requiredDate?.trim();
  const text = [where, when ? `needed by ${when}` : ""].filter(Boolean).join(" — ");
  return text || undefined;
}

/**
 * A record in the Orders book, in the shape an order always had.
 *
 * For the readers that predate the move: the mobile app's Orders tab and
 * list_orders over MCP. The id is the record's — those readers only ever key
 * on it.
 */
export function recordAsOrder(record: Doc<"records">, currency: string) {
  const value = (key: string) =>
    record.values.find((pair) => pair.key === key)?.value;
  const total = Number(value("total"));
  const known = new Set(["items", "delivery", "total"]);
  const extras = record.values.filter(
    (pair) => !known.has(pair.key) && pair.value.trim()
  );
  const lines = parseItems(value("items"));

  return {
    _id: record._id,
    orderNumber: record.reference,
    customer: {
      name: record.person?.name ?? "Customer",
      phone: record.person?.phone,
      email: record.person?.email,
      company: record.person?.company,
    },
    items: lines.map((line, index) => ({
      productName: line.productName,
      quantity: line.quantity,
      // Details the book holds beyond the three it starts with ride on the
      // first line, so they are still shown somewhere.
      specs: index === 0 ? extras : [],
    })),
    delivery: value("delivery") ? { address: value("delivery") } : undefined,
    notes: record.notes,
    total: Number.isFinite(total) && value("total") ? total : undefined,
    currency: Number.isFinite(total) && value("total") ? currency : undefined,
    source:
      record.source === "manual" || record.source === "form"
        ? ("api" as const)
        : record.source,
    status: statusForStage(record.stage),
    stage: record.stage ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// The book itself
// ---------------------------------------------------------------------------

export async function findOrdersBook(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"recordBooks"> | null> {
  return await ctx.db
    .query("recordBooks")
    .withIndex("by_workspace_handle", (q) =>
      q.eq("workspaceId", workspaceId).eq("handle", ORDERS_HANDLE)
    )
    .first();
}

/**
 * The workspace's Orders book, created on first need. A workspace that already
 * made a book called "Order" keeps it — that is its Orders book.
 */
export async function ensureOrdersBook(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<Id<"recordBooks">> {
  const existing = await findOrdersBook(ctx, workspaceId);
  if (existing) return existing._id;

  const now = Date.now();
  return await ctx.db.insert("recordBooks", {
    workspaceId,
    name: ORDERS_BOOK.name,
    pluralName: ORDERS_BOOK.pluralName,
    handle: ORDERS_BOOK.handle,
    purpose: ORDERS_BOOK.purpose,
    fields: ORDERS_BOOK.fields,
    stages: ORDERS_BOOK.stages,
    referencePrefix: ORDERS_BOOK.referencePrefix,
    allowLookup: ORDERS_BOOK.allowLookup,
    allowUpdate: ORDERS_BOOK.allowUpdate,
    // Active from the start, unlike a book the team drafts: agents were
    // taking orders before this book existed and must not stop.
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

/** The book's records, newest first, for the readers that count orders. */
export async function orderRecords(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  limit: number
): Promise<Doc<"records">[]> {
  const book = await findOrdersBook(ctx, workspaceId);
  if (!book) return [];
  return await ctx.db
    .query("records")
    .withIndex("by_book", (q) => q.eq("bookId", book._id))
    .order("desc")
    .take(limit);
}
