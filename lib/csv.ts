/**
 * RFC 4180 CSV — parse and serialize.
 *
 * Hand-rolled rather than a dependency because the catalogue importer needs
 * exactly two things, and both have to agree on quoting: read a file someone
 * saved out of Excel, and write a sample file that Excel opens cleanly.
 */

/**
 * Split CSV text into rows of cells.
 *
 * Handles quoted cells, `""` escapes, and commas/newlines inside quotes. Both
 * CRLF and LF terminate a row. A trailing newline does not invent a final
 * empty row.
 */
export function parseCsv(input: string): string[][] {
  // Excel writes a UTF-8 BOM; left in place the first header parses as
  // "﻿name" and every column lookup misses.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++; // consume the escape's second quote
      } else {
        quoted = false;
      }
      continue;
    }

    // A quote only opens a quoted cell at the start of one; mid-cell it is a
    // literal character, which is what spreadsheets emit for 24" x 36".
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize rows to CSV. CRLF line endings, because Excel. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/** Hands the browser a CSV to save. Client-only. */
export function downloadCsv(fileName: string, csv: string) {
  // The BOM is what makes Excel read the file as UTF-8 — without it, a name
  // like "Zoë" or "₹" opens as mojibake.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  // A detached anchor does not reliably start a blob download, so put it in
  // the document for the duration of the click.
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel a download that is still starting.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
