import { parseCsv, toCsv } from "./csv";

/**
 * The catalogue CSV format.
 *
 * A product carries a nested list of spec questions, which a flat file cannot
 * hold in one row. Rather than inventing a delimiter language to cram them
 * into a single cell, the format is *long*: one row per spec question, and a
 * blank `name` continues the product on the row above. That is a shape people
 * can produce and edit in a spreadsheet without being taught anything.
 *
 *   name,category,field_label,field_type,field_required
 *   Business cards,Stationery,Quantity,number,yes
 *   ,,Paper stock,select,yes
 *   ,,Finish,select,no
 *   Roller banners,Large format,Quantity,number,yes
 *
 * A product with no spec questions is simply one row with the field_* columns
 * blank.
 */

export type RequirementFieldType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "date";

export type RequirementFieldInput = {
  key: string;
  label: string;
  type: RequirementFieldType;
  required: boolean;
  options?: string[];
  example?: string;
};

/** Exactly the shape `products.bulkImport` accepts. */
export type ProductImportInput = {
  name: string;
  sku?: string;
  category?: string;
  description?: string;
  price?: number;
  currency?: string;
  unit?: string;
  requirementFields?: RequirementFieldInput[];
  attributes?: { key: string; value: string }[];
  exampleSpec?: string;
  notes?: string;
  tags?: string[];
};

export type CsvIssue = {
  /** 1-based line in the file, so it matches what the spreadsheet shows. */
  line: number;
  column: string;
  message: string;
};

export type ParseResult = {
  products: ProductImportInput[];
  issues: CsvIssue[];
  /** Headers we did not recognise — ignored, but worth saying so. */
  unknownColumns: string[];
  /** Total spec questions across all products, for the summary line. */
  fieldCount: number;
};

// --- the column contract, documented once and reused by the UI + sample -----

export const CSV_COLUMNS: {
  name: string;
  required?: boolean;
  detail: string;
}[] = [
  {
    name: "name",
    required: true,
    detail:
      "Product name. Leave blank to add another spec question to the product on the row above.",
  },
  { name: "sku", detail: "Your own product code. Optional." },
  { name: "category", detail: "Grouping shown in the catalogue. Defaults to General." },
  { name: "description", detail: "What the product is, in the agent's words." },
  { name: "price", detail: "Number only — currency symbols and thousands separators are stripped. Leave blank and agents will not quote." },
  { name: "currency", detail: "ISO code, e.g. GBP." },
  { name: "unit", detail: 'What the price is per, e.g. "per 1000".' },
  { name: "tags", detail: "Separated by | (pipe)." },
  { name: "attributes", detail: "key=value pairs separated by | — e.g. finish=Matt|sides=Double." },
  { name: "example_spec", detail: "A filled-in example the agent can pattern-match." },
  { name: "notes", detail: "Internal notes. Never shown to customers." },
  { name: "field_label", detail: "The spec question, e.g. Quantity. Blank means this row adds no question." },
  { name: "field_key", detail: "Machine name. Derived from the label if blank." },
  { name: "field_type", detail: "text, number, select, boolean or date. Defaults to text." },
  { name: "field_required", detail: "yes / no. Defaults to no." },
  { name: "field_options", detail: "Choices for a select, separated by | (pipe)." },
  { name: "field_example", detail: "Example answer, e.g. 500." },
];

const HEADERS = CSV_COLUMNS.map((column) => column.name);
/** Columns that describe the product, not one of its spec questions. */
const PRODUCT_COLUMNS = HEADERS.filter(
  (name) => name !== "name" && !name.startsWith("field_")
);

/** Spelling variants worth accepting rather than rejecting. */
const ALIASES: Record<string, string> = {
  product: "name",
  product_name: "name",
  title: "name",
  code: "sku",
  desc: "description",
  descriptions: "description",
  example: "example_spec",
  spec_example: "example_spec",
  label: "field_label",
  key: "field_key",
  type: "field_type",
  required: "field_required",
  options: "field_options",
};

const FIELD_TYPES = new Set<RequirementFieldType>([
  "text",
  "number",
  "select",
  "boolean",
  "date",
]);
const TRUTHY = new Set(["true", "yes", "y", "1", "required"]);
const FALSY = new Set(["false", "no", "n", "0", "optional", ""]);

function normalizeHeader(header: string): string {
  const cleaned = header.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIASES[cleaned] ?? cleaned;
}

/** snake_case machine name, derived from a human label. */
export function toFieldKey(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

function splitList(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------

/**
 * Turn catalogue CSV into `bulkImport` arguments.
 *
 * Never throws: every problem comes back as an issue carrying the file line, so
 * the dialog can list them all at once instead of surfacing them one per
 * attempt.
 */
export function parseProductCsv(text: string): ParseResult {
  // Blank rows are skipped, but every issue still has to name the line the
  // spreadsheet shows — so the original line number travels with each row.
  const rows = parseCsv(text)
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
  const issues: CsvIssue[] = [];

  if (rows.length === 0) {
    return {
      products: [],
      issues: [{ line: 1, column: "", message: "The file is empty." }],
      unknownColumns: [],
      fieldCount: 0,
    };
  }

  const header = rows[0].cells.map(normalizeHeader);
  if (!header.includes("name")) {
    return {
      products: [],
      issues: [
        {
          line: 1,
          column: "name",
          message:
            "No `name` column. The first row must be a header row — download the sample to see the expected columns.",
        },
      ],
      unknownColumns: [],
      fieldCount: 0,
    };
  }
  const unknownColumns = header.filter(
    (column) => column !== "" && !HEADERS.includes(column)
  );

  // Insertion-ordered, so the summary reads in the file's own order.
  const byKey = new Map<string, ProductImportInput>();
  let current: ProductImportInput | null = null;
  let fieldCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const { cells: row, line } = rows[r];
    const cell = (column: string): string => {
      const index = header.indexOf(column);
      return index === -1 ? "" : (row[index] ?? "").trim();
    };
    const fail = (column: string, message: string) =>
      issues.push({ line, column, message });

    const name = cell("name");

    if (name) {
      const key = name.toLowerCase();
      // A name repeated later in the file merges into the same product rather
      // than importing twice, where the second would overwrite the first and
      // silently drop its spec questions.
      const existing = byKey.get(key);
      current = existing ?? { name };
      if (!existing) byKey.set(key, current);

      // Later non-blank values win, so a correction further down the file takes
      // effect; blanks never erase what an earlier row set.
      const sku = cell("sku");
      if (sku) current.sku = sku;
      const category = cell("category");
      if (category) current.category = category;
      const description = cell("description");
      if (description) current.description = description;
      const currency = cell("currency");
      if (currency) current.currency = currency.toUpperCase();
      const unit = cell("unit");
      if (unit) current.unit = unit;
      const exampleSpec = cell("example_spec");
      if (exampleSpec) current.exampleSpec = exampleSpec;
      const notes = cell("notes");
      if (notes) current.notes = notes;

      const price = cell("price");
      if (price) {
        // "£1,250.00" is a perfectly ordinary thing to find in a spreadsheet.
        const cleaned = price.replace(/[^0-9.-]/g, "");
        const value = Number(cleaned);
        if (!cleaned || !Number.isFinite(value)) {
          fail("price", `"${price}" is not a number.`);
        } else {
          current.price = value;
        }
      }

      const tags = cell("tags");
      if (tags) current.tags = splitList(tags);

      const attributes = cell("attributes");
      if (attributes) {
        const pairs: { key: string; value: string }[] = [];
        for (const pair of splitList(attributes)) {
          const equals = pair.indexOf("=");
          if (equals < 1) {
            fail(
              "attributes",
              `"${pair}" is not a key=value pair. Separate pairs with | — e.g. finish=Matt|sides=Double.`
            );
            continue;
          }
          pairs.push({
            key: pair.slice(0, equals).trim(),
            value: pair.slice(equals + 1).trim(),
          });
        }
        if (pairs.length) current.attributes = pairs;
      }
    }

    if (!name) {
      // Product columns are only read from the row that names the product.
      // Filling them on a continuation row would otherwise be dropped in
      // silence, which is the worst possible outcome for an importer.
      const stray = PRODUCT_COLUMNS.filter((column) => cell(column) !== "");
      if (stray.length) {
        fail(
          stray[0],
          `${stray.join(", ")} ${stray.length === 1 ? "is" : "are"} only read from the row that names the product. Repeat the name on this row, or move the value up.`
        );
      }
    }

    // --- the spec question on this row, if any ---
    const label = cell("field_label");
    const rawKey = cell("field_key");
    if (!label && !rawKey) {
      if (!name) {
        fail(
          "name",
          "No product name and no spec question — a continuation row needs a field_label."
        );
      }
      continue;
    }

    if (!current) {
      fail(
        "name",
        "This row has a spec question but no product. The first data row must name a product."
      );
      continue;
    }

    const rawType = cell("field_type").toLowerCase();
    const type = (rawType || "text") as RequirementFieldType;
    if (!FIELD_TYPES.has(type)) {
      fail(
        "field_type",
        `"${rawType}" is not a field type. Use one of: ${[...FIELD_TYPES].join(", ")}.`
      );
      continue;
    }

    const rawRequired = cell("field_required").toLowerCase();
    if (!TRUTHY.has(rawRequired) && !FALSY.has(rawRequired)) {
      fail("field_required", `"${rawRequired}" is not yes or no.`);
      continue;
    }

    const options = splitList(cell("field_options"));
    if (type === "select" && options.length === 0) {
      fail(
        "field_options",
        `"${label || rawKey}" is a select but lists no options.`
      );
      continue;
    }

    const field: RequirementFieldInput = {
      key: rawKey ? toFieldKey(rawKey) : toFieldKey(label),
      label: label || rawKey,
      type,
      required: TRUTHY.has(rawRequired),
    };
    if (options.length) field.options = options;
    const example = cell("field_example");
    if (example) field.example = example;

    current.requirementFields = current.requirementFields ?? [];
    // A repeated key would produce two questions the agent asks twice.
    const clash = current.requirementFields.find(
      (existing) => existing.key === field.key
    );
    if (clash) {
      fail(
        "field_key",
        `"${field.key}" is already a spec question on ${current.name}.`
      );
      continue;
    }
    current.requirementFields.push(field);
    fieldCount++;
  }

  return {
    products: [...byKey.values()],
    issues,
    unknownColumns,
    fieldCount,
  };
}

// --- the downloadable sample -----------------------------------------------

const SAMPLE: string[][] = [
  HEADERS,
  [
    "Business cards",
    "BC-450-DS",
    "Stationery",
    "Printed both sides on 450gsm silk with optional matt lamination.",
    "45.00",
    "GBP",
    "per 1000",
    "stationery|litho",
    "sides=Double|stock=450gsm silk",
    "1000, double sided, matt laminated, standard 85x55mm",
    "Our best seller — quote from the litho grid, not the digital one.",
    "Quantity",
    "quantity",
    "number",
    "yes",
    "",
    "1000",
  ],
  // Continuation rows: blank name, so these questions attach to the product
  // above. This is the pattern the format is built around.
  ["", "", "", "", "", "", "", "", "", "", "", "Finish", "finish", "select", "yes", "Matt laminate|Gloss laminate|Uncoated", "Matt laminate"],
  ["", "", "", "", "", "", "", "", "", "", "", "Artwork supplied", "artwork_supplied", "boolean", "no", "", "yes"],
  [
    "Roller banners",
    "RB-850",
    "Large format",
    "850mm pull-up banner, printed on 510gsm blockout PVC, cassette included.",
    "89.00",
    "GBP",
    "each",
    "large-format|exhibition",
    "width=850mm|hardware=Cassette",
    "2 banners, 850mm, artwork supplied as PDF",
    "",
    "Quantity",
    "quantity",
    "number",
    "yes",
    "",
    "2",
  ],
  ["", "", "", "", "", "", "", "", "", "", "", "Deadline", "deadline", "date", "no", "", "2026-09-14"],
  // A product with no spec questions at all — one row, field_* blank.
  [
    "Presentation folders",
    "",
    "Packaging",
    "A4 capacity folders, glued and creased, 350gsm board.",
    "",
    "",
    "",
    "packaging",
    "",
    "",
    "Price on application — always hand to the sales team.",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
];

/** The sample file offered in the import dialog. */
export function sampleProductCsv(): string {
  return toCsv(SAMPLE);
}
