// Records — what an agent collects and files away.
//
// A workspace defines a *record book*: "Memberships", "Appointments",
// "Quotations", "Site visits". The book says what one of them is called, what
// details make one up, and what stages it moves through. Agents switched on for
// a book get tools named after it — `file_membership`, `find_membership`,
// `update_membership` — and every filed record lands in the same table,
// whatever the vertical.
//
// The alternative was a table per business. This is the same bet the catalogue
// already makes with product specs: the shape is data, not schema, so adding
// "Site visits" to a workspace is a form, not a deploy.
//
// No Convex imports here, so the dashboard can render the same labels, derive
// the same tool names and run the same validation the model is held to.

export type RecordFieldType = "text" | "number" | "select" | "boolean" | "date";

export type RecordField = {
  key: string;
  label: string;
  type: RecordFieldType;
  required: boolean;
  options?: string[];
  example?: string;
};

export const RECORD_FIELD_TYPES: Array<{
  value: RecordFieldType;
  label: string;
  hint: string;
}> = [
  { value: "text", label: "Text", hint: "A name, an address, a free answer." },
  { value: "number", label: "Number", hint: "A count, an amount, a duration." },
  { value: "select", label: "Choice", hint: "One of a fixed list you set." },
  { value: "boolean", label: "Yes / no", hint: "A straight yes or no." },
  { value: "date", label: "Date", hint: "A day, or a day and a time." },
];

// ---------------------------------------------------------------------------
// The three moments a record can announce
// ---------------------------------------------------------------------------

export type RecordEvent = "filed" | "updated" | "stage_changed";

export const RECORD_EVENTS: Array<{
  value: RecordEvent;
  label: string;
  hint: string;
}> = [
  {
    value: "filed",
    label: "Filed",
    hint: "A new record was collected and saved.",
  },
  {
    value: "updated",
    label: "Updated",
    hint: "Details on an existing record changed.",
  },
  {
    value: "stage_changed",
    label: "Stage changed",
    hint: "A record moved to a different stage.",
  },
];

/**
 * The name the outside world sees on the wire.
 *
 * Prefixed and flat like `order_created` and `escalation`, because an endpoint
 * that already switches on `event` should not have to learn a second shape.
 * Which book it came from rides in the payload rather than in the event name —
 * a receiver subscribed to "a record was filed" should not need rewriting every
 * time the workspace adds a book.
 */
export function wireEventName(event: RecordEvent): string {
  return `record_${event}`;
}

// ---------------------------------------------------------------------------
// Handles and tool names
// ---------------------------------------------------------------------------

/**
 * The model's handle for a book, derived from its name: "Site visit" becomes
 * `site_visit`, which makes the tool `file_site_visit`.
 *
 * Stored on the book rather than derived at call time, because renaming a book
 * from "Membership" to "Club membership" must not silently rename the tool the
 * agent's job description has been written around.
 */
export function toHandle(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  // A tool name has to start with a letter, and an empty one would collide
  // with every other unnamed book.
  if (!cleaned || !/^[a-z]/.test(cleaned)) return `record_${cleaned || "book"}`;
  return cleaned.slice(0, 40);
}

export type RecordToolNames = {
  file: string;
  find: string;
  update: string;
};

export function recordToolNames(handle: string): RecordToolNames {
  return {
    file: `file_${handle}`,
    find: `find_${handle}`,
    update: `update_${handle}`,
  };
}

/** Every tool name a book contributes, honouring its own switches. */
export function enabledToolNames(book: {
  handle: string;
  allowLookup: boolean;
  allowUpdate: boolean;
}): string[] {
  const names = recordToolNames(book.handle);
  return [
    names.file,
    book.allowLookup ? names.find : null,
    book.allowUpdate ? names.update : null,
  ].filter((name): name is string => name !== null);
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

// No I, O, 0 or 1 — a reference gets read down a phone line and written on a
// form, and those four are where it goes wrong.
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Suggested when a book is created: "Site visit" → "SV". */
export function suggestPrefix(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words
    .map((word) => word[0])
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 4);
  return (
    name
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 3)
      .toUpperCase() || "REC"
  );
}

/**
 * The reference a customer quotes back: "MEM-H4K82Q".
 *
 * Random rather than sequential on purpose. A running count needs a counter row
 * and a transaction to read it, and it tells every customer how many members
 * the business has.
 */
export function makeReference(prefix: string, randomChars: string): string {
  const clean = prefix.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "REC";
  return `${clean}-${randomChars}`;
}

export function referenceAlphabet(): string {
  return REFERENCE_ALPHABET;
}

// ---------------------------------------------------------------------------
// Validation
//
// Run on the way in from the model and on the way in from the dashboard form,
// so a record filed by an agent and one typed by the team are held to the same
// definition. The messages are written to be read back to the model: they say
// what to ask the customer, not what the validator thinks of its JSON.
// ---------------------------------------------------------------------------

export type CheckedValues = {
  values: Array<{ key: string; value: string }>;
  missing: string[];
  problems: string[];
};

function asText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw).trim();
}

export function checkValues(
  fields: RecordField[],
  input: Record<string, unknown>
): CheckedValues {
  const values: Array<{ key: string; value: string }> = [];
  const missing: string[] = [];
  const problems: string[] = [];

  for (const field of fields) {
    const given = asText(input[field.key]);

    if (!given) {
      if (field.required) missing.push(field.label);
      continue;
    }

    if (field.type === "number" && Number.isNaN(Number(given))) {
      problems.push(`"${field.label}" has to be a number, not "${given}".`);
      continue;
    }

    if (field.type === "select" && field.options?.length) {
      const match = field.options.find(
        (option) => option.toLowerCase() === given.toLowerCase()
      );
      if (!match) {
        problems.push(
          `"${field.label}" has to be one of: ${field.options.join(", ")}.`
        );
        continue;
      }
      // Stored as the workspace spelt it, so the table reads consistently
      // however the customer typed it.
      values.push({ key: field.key, value: match });
      continue;
    }

    if (field.type === "boolean") {
      const yes = /^(yes|y|true|1)$/i.test(given);
      const no = /^(no|n|false|0)$/i.test(given);
      if (!yes && !no) {
        problems.push(`"${field.label}" has to be yes or no.`);
        continue;
      }
      values.push({ key: field.key, value: yes ? "Yes" : "No" });
      continue;
    }

    values.push({ key: field.key, value: given });
  }

  // Anything volunteered that the book does not define. Kept rather than
  // dropped: a detail the customer gave is worth more in the record than a tidy
  // column list, and the dashboard shows it as an extra.
  const known = new Set(fields.map((field) => field.key));
  for (const [key, raw] of Object.entries(input)) {
    if (known.has(key)) continue;
    const given = asText(raw);
    if (given) values.push({ key, value: given });
  }

  return { values, missing, problems };
}

/** Merges a partial update over what is already filed, keeping field order. */
export function mergeValues(
  existing: Array<{ key: string; value: string }>,
  incoming: Array<{ key: string; value: string }>
): Array<{ key: string; value: string }> {
  const merged = existing.map((pair) => ({ ...pair }));
  for (const pair of incoming) {
    const at = merged.findIndex((current) => current.key === pair.key);
    if (at === -1) merged.push({ ...pair });
    else merged[at] = { ...pair };
  }
  return merged;
}

// ---------------------------------------------------------------------------
// What the model is told
// ---------------------------------------------------------------------------

export type BookShape = {
  name: string;
  pluralName: string;
  handle: string;
  purpose: string;
  fields: RecordField[];
  stages: string[];
  allowLookup: boolean;
  allowUpdate: boolean;
};

/** The block compiled into the system prompt for one book. */
export function describeBook(book: BookShape): string {
  const tools = recordToolNames(book.handle);
  const lines: string[] = [
    `### ${book.pluralName}`,
    book.purpose.trim() || `Records of type "${book.name}".`,
    "",
    `Collect these before calling ${tools.file}:`,
  ];

  for (const field of book.fields) {
    lines.push(
      [
        `- ${field.key} — ${field.label}`,
        field.required ? " (required)" : " (optional)",
        field.type === "select" && field.options?.length
          ? `. One of: ${field.options.join(", ")}`
          : "",
        field.type === "boolean" ? ". Answer yes or no" : "",
        field.type === "date" ? ". A date, as YYYY-MM-DD where you can" : "",
        field.example ? `. For example: ${field.example}` : "",
      ].join("")
    );
  }

  if (book.fields.length === 0) {
    lines.push("- Nothing fixed — record whatever the customer tells you.");
  }

  if (book.stages.length > 0) {
    lines.push(
      `A new one starts at "${book.stages[0]}". The stages are: ${book.stages.join(" → ")}.`
    );
  }
  if (book.allowLookup) {
    lines.push(
      `Check with ${tools.find} before assuming there is no existing one — the customer may already have it.`
    );
  }
  if (book.allowUpdate) {
    lines.push(
      `Change an existing one with ${tools.update} rather than filing a second.`
    );
  }

  return lines.join("\n");
}

export function describeBooks(books: BookShape[]): string | null {
  if (books.length === 0) return null;
  return [
    "Part of your job is collecting information and filing it. Each heading below is something this company keeps records of, and the tools named under it are how you record one.",
    "",
    "Rules for all of them:",
    "- Ask for the details conversationally, a couple at a time. Never read the list below out to the customer as a form.",
    "- File only once you have every required detail and the customer has confirmed your summary back to you. A record full of invented or placeholder details is worse than no record.",
    "- Give the customer the reference the tool hands back, and say what happens next.",
    "",
    ...books.map(describeBook),
  ].join("\n");
}
