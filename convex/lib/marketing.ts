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

export const TEMPLATE_VARIABLES = ["name", "business", "event"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const VARIABLE = /\{\{\s*(name|business|event)\s*\}\}/g;

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

/** The body as it has to be written in Meta: {{1}}, {{2}}… in order. */
export function metaBody(body: string): string {
  let index = 0;
  return body.replace(VARIABLE, () => `{{${++index}}}`);
}

/** A first name to greet, or a word that reads well in its place. */
export function greetingName(name: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && /\p{L}/u.test(first) ? first : "there";
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
    "Use {{name}} for the customer's first name and {{business}} for the company name; use {{event}} for the occasion's name when the message is for a festival.",
    "Match the language and tone of the business.",
  ],
  guardrails: [
    "Never invent a discount, an offer, a price or a deadline that you were not given.",
    "Never write anything that would read as spam — no capitals for emphasis, no chains of emoji, no pressure to buy.",
    "Never reference a customer's age, purchase history or anything else a template cannot know.",
  ],
} as const;
