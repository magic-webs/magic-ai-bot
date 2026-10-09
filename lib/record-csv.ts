import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toCsv } from "@/lib/csv";
import { phoneCell } from "@/lib/contact-csv";

export type ExportedRecord = FunctionReturnType<
  typeof api.records.exportPage
>["page"][number];

function timestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * One row per record, one column per field in the book's order. A value whose
 * key the book no longer defines still gets a column, after the defined ones,
 * so nothing filed is dropped from the file.
 */
export function recordsToCsv(
  book: Pick<Doc<"recordBooks">, "fields" | "stages">,
  records: ExportedRecord[]
): string {
  const fields = book.fields.map((field) => ({
    key: field.key,
    label: field.label,
  }));
  const known = new Set(fields.map((field) => field.key));
  for (const record of records) {
    for (const { key } of record.values) {
      if (known.has(key)) continue;
      known.add(key);
      fields.push({ key, label: key });
    }
  }
  const withStage = book.stages.length > 0;

  const header = [
    "Serial",
    "Reference",
    "Name",
    "Phone",
    "Email",
    "Company",
    ...fields.map((field) => field.label),
    ...(withStage ? ["Stage"] : []),
    "Notes",
    "Source",
    "Filed by",
    "Filed at",
    "Updated at",
  ];

  const rows = records.map((record) => {
    const values = new Map(record.values.map((pair) => [pair.key, pair.value]));
    const digits = record.person?.phone?.replace(/\D/g, "") ?? "";
    return [
      record.serialNumber?.toString() ?? "",
      record.reference,
      record.person?.name ?? "",
      digits ? phoneCell(digits) : "",
      record.person?.email ?? "",
      record.person?.company ?? "",
      ...fields.map((field) => values.get(field.key) ?? ""),
      ...(withStage ? [record.stage ?? ""] : []),
      record.notes ?? "",
      record.source,
      record.filedBy ?? "",
      timestamp(record.createdAt),
      timestamp(record.updatedAt),
    ];
  });

  return toCsv([header, ...rows]);
}
