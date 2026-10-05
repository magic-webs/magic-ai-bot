import { normaliseBirthday } from "./marketing";
import { normaliseEmail, normalisePhone } from "./notifications";

export type RawContact = {
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  birthday?: string;
  tags?: string;
  notes?: string;
};

export type CleanContact = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  birthday?: string;
  tags: string[];
  notes?: string;
};

export type ContactProblem = "phone_missing" | "phone_invalid" | "phone_not_mobile" | "phone_fake";

export type ContactFix =
  | "name_tidied"
  | "name_dropped"
  | "email_dropped"
  | "birthday_dropped"
  | "company_tidied"
  | "business_name"
  | "do_not_contact";

export const PROBLEM_LABELS: Record<ContactProblem, string> = {
  phone_missing: "No phone number",
  phone_invalid: "Not a valid phone number",
  phone_not_mobile: "Not a mobile number",
  phone_fake: "Looks like a made-up number",
};

export const FIX_LABELS: Record<ContactFix, string> = {
  name_tidied: "Name tidied",
  name_dropped: "Name was not a name",
  email_dropped: "Email was not valid",
  birthday_dropped: "Birthday could not be read",
  company_tidied: "Company tidied",
  business_name: "Business name moved to company",
  do_not_contact: "Asked not to be messaged",
};

const PLACEHOLDER_NAMES = new Set([
  "na", "n/a", "nil", "none", "null", "unknown", "test", "testing", "abc", "xyz",
  "customer", "user", "-", ".", "..", "?", "no name",
]);

function tidyText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, "")
    .replace(/[_|*#~^<>[\]{}=\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s'.-])(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase());
}

export function tidyName(raw: string | undefined): { value?: string; fix?: ContactFix } {
  if (!raw?.trim()) return {};
  const text = tidyText(raw);
  if (!/\p{L}/u.test(text) || PLACEHOLDER_NAMES.has(text.toLowerCase())) {
    return { fix: "name_dropped" };
  }
  const shouty = text === text.toUpperCase() || text === text.toLowerCase();
  const value = (shouty && /[a-z]/i.test(text) ? titleCase(text) : text).slice(0, 80);
  return { value, fix: value !== raw.trim() ? "name_tidied" : undefined };
}

function fakeDigits(local: string): boolean {
  if (/^(\d)\1+$/.test(local)) return true;
  return "01234567890".includes(local) || "09876543210".includes(local);
}

export function checkPhone(
  raw: string,
  countryCode: string | undefined
): { digits?: string; problem?: ContactProblem } {
  if (!raw.trim()) return { problem: "phone_missing" };
  const digits = normalisePhone(raw, countryCode);
  if (!digits) return { problem: "phone_invalid" };
  if (digits.startsWith("91")) {
    if (digits.length !== 12) return { problem: "phone_invalid" };
    if (!/^[6-9]/.test(digits.slice(2))) return { problem: "phone_not_mobile" };
  }
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (fakeDigits(local)) return { problem: "phone_fake" };
  return { digits };
}

export function splitTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;|]|:::/)
        .map((tag) =>
          tag
            .replace(/^\*\s*/, "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^\p{L}\p{N}\-_]/gu, "")
            .slice(0, 40)
        )
        .filter((tag) => tag && tag !== "mycontacts" && tag !== "starred")
    ),
  ].slice(0, 10);
}

export function cleanContact(
  raw: RawContact,
  countryCode: string | undefined
): { clean: CleanContact; problem?: ContactProblem; fixes: ContactFix[] } {
  const fixes: ContactFix[] = [];
  const phone = checkPhone(raw.phone, countryCode);

  const name = tidyName(raw.name);
  if (name.fix) fixes.push(name.fix);

  let email: string | undefined;
  if (raw.email?.trim()) {
    email = normaliseEmail(raw.email) ?? undefined;
    if (!email) fixes.push("email_dropped");
  }

  let birthday: string | undefined;
  if (raw.birthday?.trim()) {
    birthday = normaliseBirthday(raw.birthday) ?? undefined;
    if (!birthday) fixes.push("birthday_dropped");
  }

  let company: string | undefined;
  if (raw.company?.trim()) {
    company = tidyText(raw.company).slice(0, 80) || undefined;
    if (company !== raw.company.trim()) fixes.push("company_tidied");
  }

  const notes = raw.notes ? tidyText(raw.notes).slice(0, 600) || undefined : undefined;

  return {
    clean: {
      name: name.value,
      phone: phone.digits,
      email,
      company,
      birthday,
      tags: splitTags(raw.tags),
      notes,
    },
    problem: phone.problem,
    fixes,
  };
}

export function describeForSorting(contact: CleanContact): string | null {
  const parts = [
    contact.name && `Name: ${contact.name}`,
    contact.company && `Company: ${contact.company}`,
    contact.email && `Email: ${contact.email}`,
    contact.tags.length > 0 && `Labels: ${contact.tags.join(", ")}`,
    contact.notes && `Notes: ${contact.notes}`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join("\n");
}
