import { normaliseBirthday } from "@/convex/lib/marketing";
import { parseCsv, toCsv } from "./csv";

/**
 * The contacts CSV: what the Marketing page imports and exports.
 *
 *   name,phone,birthday,email,company
 *   Asha Rao,+91 98765 43210,25 Dec,asha@example.com,
 *
 * Only `phone` is needed. Columns are found by their header rather than their
 * position, and the headers Google Contacts and most spreadsheets write are
 * understood too — "Mobile", "Phone 1 - Value", "First Name" and "Last Name",
 * "Organization Name" — so an export from somewhere else imports as it is.
 * A file with no header row at all is read cell by cell instead: the number is
 * the cell that looks like one.
 */

/** One person, in the shape `contacts.addMany` accepts. */
export type ContactRow = {
  name?: string;
  phone: string;
  birthday?: string;
  email?: string;
  company?: string;
  tags?: string;
  notes?: string;
};

export type ContactParse = {
  rows: ContactRow[];
  /** Line numbers, as a spreadsheet counts them, that had no number. */
  missingPhone: number[];
  /** Whether the first line was read as column names. */
  hasHeader: boolean;
};

export const CONTACT_CSV_COLUMNS = ["name", "phone", "birthday", "email", "company"] as const;

type Field =
  | "name"
  | "first"
  | "last"
  | "phone"
  | "birthday"
  | "email"
  | "company"
  | "tags";

/** "Phone 1 - Value" → "phone 1 value". */
const clean = (header: string) =>
  header.toLowerCase().replace(/[_\-.:]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Which field a header names, if any. A column that describes another —
 * "Phone 1 - Type", "E-mail 1 - Label" — names none.
 */
function fieldOf(header: string): Field | null {
  const text = clean(header);
  if (!text || /\b(type|label)\b/.test(text)) return null;
  if (/^(tags?|labels|groups?|segments?|categor(y|ies))$/.test(text)) return "tags";
  if (/^(first|given) name$/.test(text)) return "first";
  if (/^(last|family|sur) ?name$/.test(text)) return "last";
  if (/\b(phone|mobile|whatsapp|cell|tel|telephone|contact number)\b/.test(text) || text === "number") {
    return "phone";
  }
  if (/\be ?mail\b/.test(text)) return "email";
  if (/\b(birthday|birth date|date of birth|dob)\b/.test(text)) return "birthday";
  if (/\b(company|organi[sz]ation|business|firm)\b/.test(text) && !/\btitle\b/.test(text)) {
    return "company";
  }
  // A bare "Contact" is left out on purpose: in half the sheets it holds the
  // number and in the other half the name, and the cell-by-cell reading
  // below gets both right.
  if (/^(name|full name|display name|customer|customer name|contact name)$/.test(text)) {
    return "name";
  }
  return null;
}

/** A cell that reads as a phone number: mostly digits, and enough of them. */
export const looksLikePhone = (cell: string) =>
  /^[+\d\s().-]+$/.test(cell.trim()) && (cell.match(/\d/g) ?? []).length >= 8;

/**
 * One person from cells in no known order: the number is the cell that looks
 * like one, a birthday is a cell that reads as a day of the year, an email has
 * an @, and the name is the first thing left with letters in it.
 */
export function rowFromCells(cells: string[]): ContactRow | null {
  const values = cells.map((cell) => cell.trim()).filter(Boolean);
  const phone = values.find(looksLikePhone);
  if (!phone) return null;
  const rest = values.filter((cell) => cell !== phone);
  const email = rest.find((cell) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell));
  const birthday = rest.find((cell) => cell !== email && normaliseBirthday(cell) !== null);
  const name = rest.find(
    (cell) => cell !== email && cell !== birthday && /\p{L}/u.test(cell)
  );
  const notes = rest.filter((cell) => cell !== email && cell !== birthday && cell !== name);
  return { phone, name, birthday, email, notes: notes.join("; ") || undefined };
}

export function parseContactCsv(text: string): ContactParse {
  const table = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  if (table.length === 0) return { rows: [], missingPhone: [], hasHeader: false };

  const fields = table[0].map(fieldOf);
  const hasHeader = fields.includes("phone");
  const rows: ContactRow[] = [];
  const missingPhone: number[] = [];

  table.slice(hasHeader ? 1 : 0).forEach((cells, index) => {
    const line = index + (hasHeader ? 2 : 1);
    if (!hasHeader) {
      const row = rowFromCells(cells);
      if (row) rows.push(row);
      // A first line with no number in a file whose headers were not
      // recognised is a header row all the same — "Name, Contact" — not a
      // person missing their number.
      else if (index > 0) missingPhone.push(line);
      return;
    }

    // The first column of each kind wins: a Google export has "Phone 1" and
    // "Phone 2", and the first is the one people mean.
    const pick = (field: Field) => {
      for (let i = 0; i < fields.length; i++) {
        if (fields[i] === field && cells[i]?.trim()) return cells[i].trim();
      }
      return undefined;
    };
    // Google writes several numbers into one cell as "a ::: b".
    const phone = pick("phone")?.split(":::")[0].trim();
    if (!phone) {
      missingPhone.push(line);
      return;
    }
    const joined = [pick("first"), pick("last")].filter(Boolean).join(" ");
    const notes = table[0]
      .map((header, i) =>
        fields[i] === null && header.trim() && cells[i]?.trim()
          ? `${header.trim()}: ${cells[i].trim()}`
          : null
      )
      .filter(Boolean)
      .join("; ");
    rows.push({
      phone,
      name: pick("name") ?? (joined || undefined),
      birthday: pick("birthday"),
      email: pick("email"),
      company: pick("company"),
      tags: pick("tags"),
      notes: notes || undefined,
    });
  });

  return { rows, missingPhone, hasHeader };
}

/** A file to fill in, showing each column the way it can be written. */
export function sampleContactCsv(): string {
  return toCsv([
    [...CONTACT_CSV_COLUMNS],
    ["Asha Rao", "+91 98765 43210", "25 Dec", "asha@example.com", ""],
    ["Vikram Singh", "91234 56789", "14/03", "", ""],
    ["Meera", "98111 22233", "", "", "Meera Boutique"],
  ]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A stored number as a spreadsheet should keep it. An Indian number is
 * spaced the way it is written, which also stops Excel reading twelve digits
 * as 9.19877E+11 and losing them on the next save.
 */
export function phoneCell(digits: string): string {
  if (/^91\d{10}$/.test(digits)) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

export function contactsToCsv(
  contacts: Array<{
    name?: string | null;
    phone: string;
    birthday?: string | null;
    email?: string | null;
    company?: string | null;
  }>
): string {
  return toCsv([
    [...CONTACT_CSV_COLUMNS],
    ...contacts.map((contact) => [
      contact.name ?? "",
      phoneCell(contact.phone.replace(/\D/g, "")),
      // "MM-DD" stored; "25 Dec" written, which reads well and imports back.
      contact.birthday
        ? `${Number(contact.birthday.slice(3))} ${MONTHS[Number(contact.birthday.slice(0, 2)) - 1]}`
        : "",
      contact.email ?? "",
      contact.company ?? "",
    ]),
  ]);
}
