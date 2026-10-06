/**
 * Meta's pricing markets: which rate a recipient's number is charged at.
 *
 * Meta prices a message by the country calling code of the number it goes to,
 * grouping most countries into regions. A market moved out of its region keeps
 * the region as `parent`, so a rate card imported before the move still
 * prices it. Pure, so React can label markets with it too.
 */

export type Market = {
  key: string;
  label: string;
  parent?: string;
  /** Calling codes, with the NANP area code where Meta splits +1. */
  dial: string[];
};

const REGIONS: Market[] = [
  { key: "north_america", label: "North America", dial: ["1"] },
  {
    key: "rest_of_africa",
    label: "Rest of Africa",
    dial: [
      "213", "244", "229", "267", "226", "257", "237", "235", "242", "291",
      "251", "241", "220", "233", "245", "225", "254", "266", "231", "218",
      "261", "265", "223", "222", "258", "264", "227", "250", "221", "232",
      "252", "211", "249", "268", "255", "228", "216", "256", "260", "263",
    ],
  },
  {
    key: "rest_of_asia_pacific",
    label: "Rest of Asia Pacific",
    dial: [
      "93", "61", "855", "86", "81", "856", "976", "64", "675", "63", "886",
      "992", "66", "993", "998", "84",
    ],
  },
  {
    key: "rest_of_central_eastern_europe",
    label: "Rest of Central & Eastern Europe",
    dial: [
      "355", "374", "994", "375", "359", "385", "420", "995", "30", "371",
      "370", "373", "389", "381", "421", "386",
    ],
  },
  {
    key: "rest_of_western_europe",
    label: "Rest of Western Europe",
    dial: ["43", "32", "45", "358", "353", "47", "351", "46", "41"],
  },
  {
    key: "rest_of_latin_america",
    label: "Rest of Latin America",
    dial: [
      "591", "506", "1809", "1829", "1849", "593", "503", "502", "509", "504",
      "1658", "1876", "505", "507", "595", "1787", "1939", "598", "58",
    ],
  },
  {
    key: "rest_of_middle_east",
    label: "Rest of Middle East",
    dial: ["973", "962", "961", "967"],
  },
  { key: "other", label: "Other", dial: [] },
];

const COUNTRIES: Market[] = [
  { key: "AR", label: "Argentina", dial: ["54"] },
  { key: "BR", label: "Brazil", dial: ["55"] },
  { key: "CL", label: "Chile", dial: ["56"] },
  { key: "CO", label: "Colombia", dial: ["57"] },
  { key: "EG", label: "Egypt", dial: ["20"] },
  { key: "FR", label: "France", dial: ["33"] },
  { key: "DE", label: "Germany", dial: ["49"] },
  { key: "HK", label: "Hong Kong", dial: ["852"] },
  { key: "HU", label: "Hungary", dial: ["36"] },
  { key: "IN", label: "India", dial: ["91"] },
  { key: "ID", label: "Indonesia", dial: ["62"] },
  { key: "IL", label: "Israel", dial: ["972"] },
  { key: "IT", label: "Italy", dial: ["39"] },
  { key: "MY", label: "Malaysia", dial: ["60"] },
  { key: "MX", label: "Mexico", dial: ["52"] },
  { key: "NL", label: "Netherlands", dial: ["31"] },
  { key: "NG", label: "Nigeria", dial: ["234"] },
  { key: "PK", label: "Pakistan", dial: ["92"] },
  { key: "PE", label: "Peru", dial: ["51"] },
  { key: "PL", label: "Poland", dial: ["48"] },
  { key: "QA", label: "Qatar", dial: ["974"] },
  { key: "RO", label: "Romania", dial: ["40"] },
  { key: "RU", label: "Russia", dial: ["7"] },
  { key: "SA", label: "Saudi Arabia", dial: ["966"] },
  { key: "SG", label: "Singapore", dial: ["65"] },
  { key: "ZA", label: "South Africa", dial: ["27"] },
  { key: "ES", label: "Spain", dial: ["34"] },
  { key: "TR", label: "Turkey", dial: ["90"] },
  { key: "AE", label: "United Arab Emirates", dial: ["971"] },
  { key: "GB", label: "United Kingdom", dial: ["44"] },
  // Standalone from 1 October 2026.
  { key: "BD", label: "Bangladesh", parent: "rest_of_asia_pacific", dial: ["880"] },
  { key: "NP", label: "Nepal", parent: "rest_of_asia_pacific", dial: ["977"] },
  { key: "LK", label: "Sri Lanka", parent: "rest_of_asia_pacific", dial: ["94"] },
  { key: "IQ", label: "Iraq", parent: "rest_of_middle_east", dial: ["964"] },
  { key: "KW", label: "Kuwait", parent: "rest_of_middle_east", dial: ["965"] },
  { key: "OM", label: "Oman", parent: "rest_of_middle_east", dial: ["968"] },
  { key: "MA", label: "Morocco", parent: "rest_of_africa", dial: ["212"] },
  { key: "UA", label: "Ukraine", parent: "rest_of_central_eastern_europe", dial: ["380"] },
  { key: "KZ", label: "Kazakhstan", parent: "other", dial: ["76", "77"] },
];

export const MARKETS: Market[] = [...COUNTRIES, ...REGIONS];

const BY_KEY = new Map(MARKETS.map((market) => [market.key, market]));

const BY_DIAL = new Map<string, string>();
for (const market of MARKETS) {
  for (const dial of market.dial) BY_DIAL.set(dial, market.key);
}
const LONGEST_DIAL = Math.max(...[...BY_DIAL.keys()].map((dial) => dial.length));

/** The market a number is priced in, by its longest matching calling code. */
export function marketOf(number: string): string {
  const digits = number.replace(/\D/g, "");
  for (let length = Math.min(LONGEST_DIAL, digits.length); length > 0; length--) {
    const key = BY_DIAL.get(digits.slice(0, length));
    if (key) return key;
  }
  return "other";
}

export function marketLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** The markets to try, in order, for a rate: itself, its old region, Other. */
export function marketChain(key: string): string[] {
  const chain = [key];
  const parent = BY_KEY.get(key)?.parent;
  if (parent) chain.push(parent);
  if (!chain.includes("other")) chain.push("other");
  return chain;
}

const normalise = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z]+/g, " ")
    .trim();

const ALIASES: Record<string, string> = {
  "rest of central and eastern europe": "rest_of_central_eastern_europe",
  "rest of central eastern europe": "rest_of_central_eastern_europe",
  "rest of cee": "rest_of_central_eastern_europe",
  "rest of apac": "rest_of_asia_pacific",
  "rest of asia": "rest_of_asia_pacific",
  "rest of latam": "rest_of_latin_america",
  "rest of me": "rest_of_middle_east",
  "uae": "AE",
  "uk": "GB",
  "turkiye": "TR",
  "russian federation": "RU",
  "hong kong sar": "HK",
  "all other countries": "other",
};

const BY_NAME = new Map<string, string>([
  ...MARKETS.map((market) => [normalise(market.label), market.key] as [string, string]),
  ...Object.entries(ALIASES),
]);

/** A market as a rate card names it — "India", "Rest of Africa" — or null. */
export function marketByName(name: string): string | null {
  return BY_NAME.get(normalise(name)) ?? null;
}
