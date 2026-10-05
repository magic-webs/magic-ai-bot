// Pure helpers for the marketing desk: the festival calendar, template
// variables and local-time arithmetic. No Convex imports, so the dashboard can
// read the same preset list and the same variable rules.

// ---------------------------------------------------------------------------
// Festivals
// ---------------------------------------------------------------------------

/**
 * The preset calendar a workspace can pick from.
 *
 * Fixed-date days are listed once and repeat every year. Lunar festivals move,
 * so each carries the dates it falls on per year — and only the years listed:
 * a festival past the end of the table simply stops being suggested rather than
 * being guessed. These are the commonly observed Indian dates; regional
 * observance can differ by a day, which is why an added festival is an
 * ordinary calendar entry whose date the owner can change.
 */
export type FestivalPreset = {
  key: string;
  name: string;
  /** "MM-DD" for a fixed day, repeated every year. */
  fixed?: string;
  /** "YYYY-MM-DD" per year, for festivals that move. */
  dates?: string[];
};

export const FESTIVALS: FestivalPreset[] = [
  { key: "new_year", name: "New Year", fixed: "01-01" },
  {
    key: "makar_sankranti",
    name: "Makar Sankranti / Pongal",
    dates: ["2026-01-14", "2027-01-15"],
  },
  { key: "republic_day", name: "Republic Day", fixed: "01-26" },
  { key: "valentines_day", name: "Valentine's Day", fixed: "02-14" },
  {
    key: "maha_shivaratri",
    name: "Maha Shivaratri",
    dates: ["2026-02-15", "2027-03-06"],
  },
  { key: "womens_day", name: "Women's Day", fixed: "03-08" },
  { key: "holi", name: "Holi", dates: ["2026-03-04", "2027-03-22"] },
  {
    key: "gudi_padwa",
    name: "Gudi Padwa / Ugadi",
    dates: ["2026-03-19", "2027-04-07"],
  },
  { key: "eid_al_fitr", name: "Eid al-Fitr", dates: ["2026-03-21", "2027-03-10"] },
  { key: "ram_navami", name: "Ram Navami", dates: ["2026-03-26", "2027-04-15"] },
  { key: "baisakhi", name: "Baisakhi", fixed: "04-14" },
  { key: "mothers_day", name: "Mother's Day", dates: ["2026-05-10", "2027-05-09"] },
  { key: "eid_al_adha", name: "Eid al-Adha", dates: ["2026-05-27", "2027-05-17"] },
  { key: "fathers_day", name: "Father's Day", dates: ["2026-06-21", "2027-06-20"] },
  { key: "independence_day", name: "Independence Day", fixed: "08-15" },
  {
    key: "raksha_bandhan",
    name: "Raksha Bandhan",
    dates: ["2026-08-28", "2027-08-17"],
  },
  { key: "janmashtami", name: "Janmashtami", dates: ["2026-09-04", "2027-08-25"] },
  {
    key: "ganesh_chaturthi",
    name: "Ganesh Chaturthi",
    dates: ["2026-09-14", "2027-09-04"],
  },
  { key: "navratri", name: "Navratri", dates: ["2026-10-11", "2027-09-30"] },
  { key: "dussehra", name: "Dussehra", dates: ["2026-10-20", "2027-10-09"] },
  { key: "dhanteras", name: "Dhanteras", dates: ["2026-11-06", "2027-10-27"] },
  { key: "diwali", name: "Diwali", dates: ["2026-11-08", "2027-10-29"] },
  {
    key: "guru_nanak_jayanti",
    name: "Guru Nanak Jayanti",
    dates: ["2026-11-24", "2027-11-14"],
  },
  { key: "christmas", name: "Christmas", fixed: "12-25" },
];

/** Every preset occurrence between two local dates, inclusive, in date order. */
export function festivalsBetween(
  from: string,
  to: string
): Array<{ key: string; name: string; date: string }> {
  const out: Array<{ key: string; name: string; date: string }> = [];
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));

  for (const festival of FESTIVALS) {
    const candidates = festival.fixed
      ? Array.from(
          { length: lastYear - firstYear + 1 },
          (_, i) => `${firstYear + i}-${festival.fixed}`
        )
      : (festival.dates ?? []);
    for (const date of candidates) {
      if (date >= from && date <= to) {
        out.push({ key: festival.key, name: festival.name, date });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Template variables
// ---------------------------------------------------------------------------

/**
 * `date`, `venue` and `message` belong to an event: its day and time, where it
 * is, and the line the marketing desk writes for each reminder. A festival or
 * a birthday has no venue and no message, so a template that uses them only
 * sends for an event that fills them — see `missingVariables`.
 */
export const TEMPLATE_VARIABLES = [
  "name",
  "business",
  "event",
  "date",
  "venue",
  "message",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const VARIABLE = /\{\{\s*(name|business|event|date|venue|message)\s*\}\}/g;

/**
 * Fills a template for one contact.
 *
 * Returns the text as the customer reads it, for the transcript, and the
 * values in order of appearance — which is how Meta numbers them, so a body
 * reading "Hi {{name}}, from {{business}}" sends as {{1}} and {{2}}.
 */
export function renderTemplate(
  body: string,
  values: Record<TemplateVariable, string>
): { text: string; parameters: string[] } {
  const parameters: string[] = [];
  const text = body.replace(VARIABLE, (_, name: TemplateVariable) => {
    parameters.push(values[name]);
    return values[name];
  });
  return { text, parameters };
}

/**
 * The variables a body uses that have nothing to fill them. Meta refuses a
 * template send with an empty parameter, so this is checked before sending
 * rather than discovered once per contact.
 */
export function missingVariables(
  body: string,
  values: Record<TemplateVariable, string>
): TemplateVariable[] {
  const missing = new Set<TemplateVariable>();
  for (const match of body.matchAll(VARIABLE)) {
    const name = match[1] as TemplateVariable;
    if (!values[name]?.trim()) missing.add(name);
  }
  return [...missing];
}

/**
 * A template parameter as Meta accepts one: no line breaks, no tabs and no
 * run of more than three spaces. A reminder line the desk wrote across two
 * lines is joined into one rather than refused.
 */
export function asParameter(text: string): string {
  return text.replace(/\s*[\r\n\t]+\s*/g, " ").replace(/ {4,}/g, "   ").trim();
}

/** The body as it has to be written in Meta: {{1}}, {{2}}… in order. */
export function metaBody(body: string): string {
  let index = 0;
  return body.replace(VARIABLE, () => `{{${++index}}}`);
}

// ---------------------------------------------------------------------------
// Applying a template to Meta
// ---------------------------------------------------------------------------

/** Meta's name for a template: lowercase letters, digits and underscores. */
export function metaNameFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 480);
  return slug || "marketing_message";
}

/**
 * A realistic value for every variable — for Meta's review, and for a test
 * send of a template with no event behind it. The occasion is the one the
 * template is for, so a festival greeting's sample reads "Happy Diwali", not
 * "Happy Open studio day".
 */
export function sampleValues(
  business: string,
  occasion?: string
): Record<TemplateVariable, string> {
  return {
    name: "Asha",
    business: business || "our store",
    event:
      occasion === "festival"
        ? "Diwali"
        : occasion === "birthday"
          ? "your birthday"
          : occasion === "offer"
            ? "our festive sale"
            : "Open studio day",
    date: "Sat, 8 Nov, 11 am",
    venue: "our MG Road store",
    message: "Doors open at eleven, with tea and a first look at the new collection.",
  };
}

/**
 * The sample Meta reviews each variable with, in order of appearance. Meta
 * refuses a template with variables and no samples, and reads them to judge
 * what the message will say — so they are realistic, not "value1".
 */
export function exampleValues(body: string, business: string, occasion?: string): string[] {
  const samples = sampleValues(business, occasion);
  return [...body.matchAll(VARIABLE)].map((match) => samples[match[1] as TemplateVariable]);
}

/**
 * What Meta would turn the body down for, caught before it is sent to review
 * — a rejection takes a round trip and a day of waiting to hear about.
 */
export function templateProblems(body: string): string[] {
  const text = body.trim();
  const problems: string[] = [];
  if (!text) problems.push("Write the message first.");
  if (/^\{\{/.test(text)) problems.push("It cannot start with a variable — open with a word, like “Hi {{name}}”.");
  if (/\}\}$/.test(text)) problems.push("It cannot end with a variable — close with a word or two after it.");
  if (/\}\}\s*\{\{/.test(text)) problems.push("Two variables cannot sit side by side — put a word between them.");
  if (text.length > 1024) problems.push("Keep it under 1,024 characters.");
  return problems;
}

/**
 * Why a template cannot send right now, in words the owner can act on, or
 * null when it can. The sender and the page read the same answer.
 */
export function templateBlocker(template: {
  name: string;
  metaTemplateName?: string;
  metaStatus?: string;
  metaRejectedReason?: string;
}): string | null {
  const name = `“${template.name}”`;
  if (!template.metaTemplateName) return `${name} has not been applied to Meta yet.`;
  switch (template.metaStatus) {
    case undefined:
    case "APPROVED":
      return null;
    case "PENDING":
    case "IN_APPEAL":
      return `${name} is still waiting for Meta's approval.`;
    case "REJECTED":
      return `Meta rejected ${name}${
        template.metaRejectedReason ? ` (${template.metaRejectedReason.toLowerCase().replace(/_/g, " ")})` : ""
      }. Change it and apply it again.`;
    case "CHANGED":
      return `${name} was changed after it was applied. Apply the change to Meta first.`;
    default:
      return `${name} is ${template.metaStatus.toLowerCase()} in Meta and cannot send.`;
  }
}

/** A first name to greet, or a word that reads well in its place. */
export function greetingName(name: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && /\p{L}/u.test(first) ? first : "there";
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * The reminders an event can send, by how many days before (negative) or
 * after (positive) its date. Offered as a fixed set rather than any number,
 * because each one gets its own line from the desk and "4 days before" reads
 * no differently to a customer from 3.
 */
export const EVENT_TOUCHES = [
  { offset: -14, label: "2 weeks before", stage: "Announce" },
  { offset: -7, label: "1 week before", stage: "Announce" },
  { offset: -3, label: "3 days before", stage: "Remind" },
  { offset: -1, label: "1 day before", stage: "Remind" },
  { offset: 0, label: "On the day", stage: "Day of" },
  { offset: 1, label: "1 day after", stage: "Thank you" },
  { offset: 2, label: "2 days after", stage: "Feedback" },
  { offset: 7, label: "1 week after", stage: "Follow up" },
] as const;

export type GuestSegment = "everyone" | "not_declined" | "interested" | "attended" | "no_show";

export const GUEST_SEGMENTS: Array<{ value: GuestSegment; label: string }> = [
  { value: "everyone", label: "Everyone invited" },
  { value: "not_declined", label: "Everyone but those who said no" },
  { value: "interested", label: "Said yes or maybe" },
  { value: "attended", label: "Came" },
  { value: "no_show", label: "Said yes but didn't come" },
];

export function defaultSegment(offset: number): GuestSegment {
  return offset <= 0 ? "not_declined" : "everyone";
}

export const EVENT_TOUCH_OFFSETS: readonly number[] = EVENT_TOUCHES.map(
  (touch) => touch.offset
);

/** What a new event sends unless the owner picks otherwise. */
export const DEFAULT_EVENT_TOUCHES = [-3, -1, 0, 1];

export function touchLabel(offset: number): string {
  return (
    EVENT_TOUCHES.find((touch) => touch.offset === offset)?.label ??
    (offset < 0 ? `${-offset} days before` : `${offset} days after`)
  );
}

/** What each reminder is for, as the desk is briefed on it. */
export function touchBrief(offset: number, segment: GuestSegment = defaultSegment(offset)): string {
  if (segment === "no_show") {
    return "They said they would come but did not make it: say they were missed, share one highlight, and offer a way to catch up or come next time. Never scold.";
  }
  if (offset <= -7) {
    return "An early announcement: tell them it is coming and why it is worth marking in the diary, and ask them to reply to say if they can come.";
  }
  if (offset < -1) {
    return `A reminder ${-offset} days ahead: build a little anticipation, give them the one reason to come, and ask them to reply yes or no.`;
  }
  if (offset === -1) {
    return "The day before: a short, friendly nudge that it is tomorrow.";
  }
  if (offset === 0) {
    return "The morning of the day: it is today — make it easy to come along.";
  }
  if (segment === "attended") {
    if (offset >= 7) return "A week after, to people who came: a follow-up offer or next step that builds on the event.";
    if (offset >= 2) return "Two days after, to people who came: ask in one line how it was, and invite a quick reply.";
    return "The day after, to people who came: thank them warmly for coming.";
  }
  if (offset >= 7) {
    return "A week after: a follow-up offer or next step that keeps the momentum going. Do not assume they attended.";
  }
  if (offset >= 2) {
    return "Two days after: ask for a quick reply with their thoughts or questions. Do not assume they attended.";
  }
  return "The day after: thank everyone warmly, whether or not they came, and leave the door open for next time. Do not assume they attended.";
}

/** "YYYY-MM-DD" moved by whole days. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * An event's day, and its time when it has one, the way a customer reads it
 * in a message: "Sat, 8 Nov, 6:30 pm". Formatted through UTC on purpose — the
 * date is already the workspace's local one.
 */
export function eventDateLabel(
  date: string,
  startTime: string | undefined,
  locale: string
): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  const format = (tag: string) =>
    new Intl.DateTimeFormat(tag, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(at);
  let label: string;
  try {
    label = format(locale);
  } catch {
    label = format("en-IN");
  }
  if (!startTime || !isLocalTime(startTime)) return label;

  const [hours, minutes] = startTime.split(":").map(Number);
  const suffix = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${label}, ${twelve}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Birthdays
// ---------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Normalises whatever a customer or an operator wrote into "MM-DD", or null.
 *
 * Takes "MM-DD", "YYYY-MM-DD", "DD/MM", "DD/MM/YYYY" and "12 March" style.
 * Slashed dates are read day first, the way they are written in India and
 * the UK; a month-first reading is only taken when the first number cannot be
 * a month.
 */
export function normaliseBirthday(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  let month: number | undefined;
  let day: number | undefined;

  let match = raw.match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/);
  if (match) {
    month = Number(match[1]);
    day = Number(match[2]);
  }

  match = match ? null : raw.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.]\d{2,4})?$/);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    [day, month] = b > 12 && a <= 12 ? [b, a] : [a, b];
  }

  if (month === undefined) {
    const months = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    const named = raw.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)|([a-z]+)\s+(\d{1,2})/);
    if (named) {
      const word = (named[2] ?? named[3]).slice(0, 3);
      const index = months.indexOf(word);
      if (index >= 0) {
        month = index + 1;
        day = Number(named[1] ?? named[4]);
      }
    }
  }

  if (!month || !day || month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

/** The wall clock in a timezone at an instant. Falls back to UTC. */
export function zonedParts(
  instant: number,
  timeZone: string
): { date: string; hour: number; minute: number } {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone);
  } catch {
    // A workspace saved with a zone the runtime does not know should still
    // send, an hour or so off, rather than not at all.
    parts = format("UTC");
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/**
 * The instant a local date and hour fall at in a timezone.
 *
 * Takes the offset at a first guess and corrects by it, which is exact
 * everywhere except inside a daylight-saving jump — and there it lands within
 * the hour, which is as close as "send at 9" needs.
 */
export function zonedToInstant(date: string, hour: number, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour);
  const seen = zonedParts(guess, timeZone);
  const [sy, sm, sd] = seen.date.split("-").map(Number);
  const offset = Date.UTC(sy, sm - 1, sd, seen.hour, seen.minute) - guess;
  return guess - offset;
}

export function isLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

export const MARKETING_DEFAULTS = {
  name: "Marketing desk",
  role: "Marketing desk",
  objective:
    "Keep the business in its customers' minds on the days that matter to them — their birthday and the festivals they celebrate — with messages that are warm, short and worth receiving.",
  jobDescription: [
    "You write the greetings the business sends on a schedule: birthday wishes, festival greetings and the occasional offer.",
    "Each message goes to many customers at once as an approved WhatsApp template, so it cannot mention anything specific to one person beyond their first name.",
    "Write as the business speaking to a customer it knows: one warm opening, one line that ties the occasion to the business, and an easy sign-off.",
  ].join(" "),
  rules: [
    "Keep a message under 60 words.",
    "Use {{name}} for the customer's first name and {{business}} for the company name; use {{event}} for the occasion's name when the message is for a festival or an event.",
    "For an event's reminders, write the one line that goes into {{message}} from the event's own details — its date, place and offer are only ever the ones you were given.",
    "Match the language and tone of the business.",
  ],
  guardrails: [
    "Never invent a discount, an offer, a price or a deadline that you were not given.",
    "Never write anything that would read as spam — no capitals for emphasis, no chains of emoji, no pressure to buy.",
    "Never reference a customer's age, purchase history or anything else a template cannot know.",
  ],
} as const;
