/**
 * Country dialling codes, for the widget's phone field.
 *
 * Plain data rather than a library: the whole need is "prefix the number the
 * visitor typed", and every phone-input package on npm brings a formatter, a
 * validator and a flag sprite sheet for it. The flags here are the regional
 * indicator pair, which every platform that matters renders itself.
 *
 * `iso` is the ISO 3166-1 alpha-2 code, which is what `navigator.language`
 * carries and so what `guessDialCode` matches on. Several countries share a
 * dial code (+1, +7, +44 dependencies), so the code alone is not a key — the
 * select is keyed on `iso`.
 */
export type DialCode = {
  iso: string;
  name: string;
  dial: string;
  flag: string;
};

export const DIAL_CODES: DialCode[] = [
  { iso: "AF", name: "Afghanistan", dial: "+93", flag: "🇦🇫" },
  { iso: "AL", name: "Albania", dial: "+355", flag: "🇦🇱" },
  { iso: "DZ", name: "Algeria", dial: "+213", flag: "🇩🇿" },
  { iso: "AR", name: "Argentina", dial: "+54", flag: "🇦🇷" },
  { iso: "AM", name: "Armenia", dial: "+374", flag: "🇦🇲" },
  { iso: "AU", name: "Australia", dial: "+61", flag: "🇦🇺" },
  { iso: "AT", name: "Austria", dial: "+43", flag: "🇦🇹" },
  { iso: "AZ", name: "Azerbaijan", dial: "+994", flag: "🇦🇿" },
  { iso: "BH", name: "Bahrain", dial: "+973", flag: "🇧🇭" },
  { iso: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩" },
  { iso: "BY", name: "Belarus", dial: "+375", flag: "🇧🇾" },
  { iso: "BE", name: "Belgium", dial: "+32", flag: "🇧🇪" },
  { iso: "BT", name: "Bhutan", dial: "+975", flag: "🇧🇹" },
  { iso: "BO", name: "Bolivia", dial: "+591", flag: "🇧🇴" },
  { iso: "BA", name: "Bosnia and Herzegovina", dial: "+387", flag: "🇧🇦" },
  { iso: "BW", name: "Botswana", dial: "+267", flag: "🇧🇼" },
  { iso: "BR", name: "Brazil", dial: "+55", flag: "🇧🇷" },
  { iso: "BN", name: "Brunei", dial: "+673", flag: "🇧🇳" },
  { iso: "BG", name: "Bulgaria", dial: "+359", flag: "🇧🇬" },
  { iso: "KH", name: "Cambodia", dial: "+855", flag: "🇰🇭" },
  { iso: "CM", name: "Cameroon", dial: "+237", flag: "🇨🇲" },
  { iso: "CA", name: "Canada", dial: "+1", flag: "🇨🇦" },
  { iso: "CL", name: "Chile", dial: "+56", flag: "🇨🇱" },
  { iso: "CN", name: "China", dial: "+86", flag: "🇨🇳" },
  { iso: "CO", name: "Colombia", dial: "+57", flag: "🇨🇴" },
  { iso: "CR", name: "Costa Rica", dial: "+506", flag: "🇨🇷" },
  { iso: "HR", name: "Croatia", dial: "+385", flag: "🇭🇷" },
  { iso: "CY", name: "Cyprus", dial: "+357", flag: "🇨🇾" },
  { iso: "CZ", name: "Czechia", dial: "+420", flag: "🇨🇿" },
  { iso: "DK", name: "Denmark", dial: "+45", flag: "🇩🇰" },
  { iso: "DO", name: "Dominican Republic", dial: "+1", flag: "🇩🇴" },
  { iso: "EC", name: "Ecuador", dial: "+593", flag: "🇪🇨" },
  { iso: "EG", name: "Egypt", dial: "+20", flag: "🇪🇬" },
  { iso: "SV", name: "El Salvador", dial: "+503", flag: "🇸🇻" },
  { iso: "EE", name: "Estonia", dial: "+372", flag: "🇪🇪" },
  { iso: "ET", name: "Ethiopia", dial: "+251", flag: "🇪🇹" },
  { iso: "FI", name: "Finland", dial: "+358", flag: "🇫🇮" },
  { iso: "FR", name: "France", dial: "+33", flag: "🇫🇷" },
  { iso: "GE", name: "Georgia", dial: "+995", flag: "🇬🇪" },
  { iso: "DE", name: "Germany", dial: "+49", flag: "🇩🇪" },
  { iso: "GH", name: "Ghana", dial: "+233", flag: "🇬🇭" },
  { iso: "GR", name: "Greece", dial: "+30", flag: "🇬🇷" },
  { iso: "GT", name: "Guatemala", dial: "+502", flag: "🇬🇹" },
  { iso: "HN", name: "Honduras", dial: "+504", flag: "🇭🇳" },
  { iso: "HK", name: "Hong Kong", dial: "+852", flag: "🇭🇰" },
  { iso: "HU", name: "Hungary", dial: "+36", flag: "🇭🇺" },
  { iso: "IS", name: "Iceland", dial: "+354", flag: "🇮🇸" },
  { iso: "IN", name: "India", dial: "+91", flag: "🇮🇳" },
  { iso: "ID", name: "Indonesia", dial: "+62", flag: "🇮🇩" },
  { iso: "IQ", name: "Iraq", dial: "+964", flag: "🇮🇶" },
  { iso: "IE", name: "Ireland", dial: "+353", flag: "🇮🇪" },
  { iso: "IL", name: "Israel", dial: "+972", flag: "🇮🇱" },
  { iso: "IT", name: "Italy", dial: "+39", flag: "🇮🇹" },
  { iso: "CI", name: "Ivory Coast", dial: "+225", flag: "🇨🇮" },
  { iso: "JM", name: "Jamaica", dial: "+1", flag: "🇯🇲" },
  { iso: "JP", name: "Japan", dial: "+81", flag: "🇯🇵" },
  { iso: "JO", name: "Jordan", dial: "+962", flag: "🇯🇴" },
  { iso: "KZ", name: "Kazakhstan", dial: "+7", flag: "🇰🇿" },
  { iso: "KE", name: "Kenya", dial: "+254", flag: "🇰🇪" },
  { iso: "KW", name: "Kuwait", dial: "+965", flag: "🇰🇼" },
  { iso: "KG", name: "Kyrgyzstan", dial: "+996", flag: "🇰🇬" },
  { iso: "LA", name: "Laos", dial: "+856", flag: "🇱🇦" },
  { iso: "LV", name: "Latvia", dial: "+371", flag: "🇱🇻" },
  { iso: "LB", name: "Lebanon", dial: "+961", flag: "🇱🇧" },
  { iso: "LY", name: "Libya", dial: "+218", flag: "🇱🇾" },
  { iso: "LT", name: "Lithuania", dial: "+370", flag: "🇱🇹" },
  { iso: "LU", name: "Luxembourg", dial: "+352", flag: "🇱🇺" },
  { iso: "MO", name: "Macau", dial: "+853", flag: "🇲🇴" },
  { iso: "MG", name: "Madagascar", dial: "+261", flag: "🇲🇬" },
  { iso: "MW", name: "Malawi", dial: "+265", flag: "🇲🇼" },
  { iso: "MY", name: "Malaysia", dial: "+60", flag: "🇲🇾" },
  { iso: "MV", name: "Maldives", dial: "+960", flag: "🇲🇻" },
  { iso: "MT", name: "Malta", dial: "+356", flag: "🇲🇹" },
  { iso: "MU", name: "Mauritius", dial: "+230", flag: "🇲🇺" },
  { iso: "MX", name: "Mexico", dial: "+52", flag: "🇲🇽" },
  { iso: "MD", name: "Moldova", dial: "+373", flag: "🇲🇩" },
  { iso: "MN", name: "Mongolia", dial: "+976", flag: "🇲🇳" },
  { iso: "ME", name: "Montenegro", dial: "+382", flag: "🇲🇪" },
  { iso: "MA", name: "Morocco", dial: "+212", flag: "🇲🇦" },
  { iso: "MZ", name: "Mozambique", dial: "+258", flag: "🇲🇿" },
  { iso: "MM", name: "Myanmar", dial: "+95", flag: "🇲🇲" },
  { iso: "NA", name: "Namibia", dial: "+264", flag: "🇳🇦" },
  { iso: "NP", name: "Nepal", dial: "+977", flag: "🇳🇵" },
  { iso: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱" },
  { iso: "NZ", name: "New Zealand", dial: "+64", flag: "🇳🇿" },
  { iso: "NI", name: "Nicaragua", dial: "+505", flag: "🇳🇮" },
  { iso: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬" },
  { iso: "MK", name: "North Macedonia", dial: "+389", flag: "🇲🇰" },
  { iso: "NO", name: "Norway", dial: "+47", flag: "🇳🇴" },
  { iso: "OM", name: "Oman", dial: "+968", flag: "🇴🇲" },
  { iso: "PK", name: "Pakistan", dial: "+92", flag: "🇵🇰" },
  { iso: "PS", name: "Palestine", dial: "+970", flag: "🇵🇸" },
  { iso: "PA", name: "Panama", dial: "+507", flag: "🇵🇦" },
  { iso: "PY", name: "Paraguay", dial: "+595", flag: "🇵🇾" },
  { iso: "PE", name: "Peru", dial: "+51", flag: "🇵🇪" },
  { iso: "PH", name: "Philippines", dial: "+63", flag: "🇵🇭" },
  { iso: "PL", name: "Poland", dial: "+48", flag: "🇵🇱" },
  { iso: "PT", name: "Portugal", dial: "+351", flag: "🇵🇹" },
  { iso: "PR", name: "Puerto Rico", dial: "+1", flag: "🇵🇷" },
  { iso: "QA", name: "Qatar", dial: "+974", flag: "🇶🇦" },
  { iso: "RO", name: "Romania", dial: "+40", flag: "🇷🇴" },
  { iso: "RU", name: "Russia", dial: "+7", flag: "🇷🇺" },
  { iso: "RW", name: "Rwanda", dial: "+250", flag: "🇷🇼" },
  { iso: "SA", name: "Saudi Arabia", dial: "+966", flag: "🇸🇦" },
  { iso: "SN", name: "Senegal", dial: "+221", flag: "🇸🇳" },
  { iso: "RS", name: "Serbia", dial: "+381", flag: "🇷🇸" },
  { iso: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬" },
  { iso: "SK", name: "Slovakia", dial: "+421", flag: "🇸🇰" },
  { iso: "SI", name: "Slovenia", dial: "+386", flag: "🇸🇮" },
  { iso: "ZA", name: "South Africa", dial: "+27", flag: "🇿🇦" },
  { iso: "KR", name: "South Korea", dial: "+82", flag: "🇰🇷" },
  { iso: "ES", name: "Spain", dial: "+34", flag: "🇪🇸" },
  { iso: "LK", name: "Sri Lanka", dial: "+94", flag: "🇱🇰" },
  { iso: "SE", name: "Sweden", dial: "+46", flag: "🇸🇪" },
  { iso: "CH", name: "Switzerland", dial: "+41", flag: "🇨🇭" },
  { iso: "TW", name: "Taiwan", dial: "+886", flag: "🇹🇼" },
  { iso: "TZ", name: "Tanzania", dial: "+255", flag: "🇹🇿" },
  { iso: "TH", name: "Thailand", dial: "+66", flag: "🇹🇭" },
  { iso: "TT", name: "Trinidad and Tobago", dial: "+1", flag: "🇹🇹" },
  { iso: "TN", name: "Tunisia", dial: "+216", flag: "🇹🇳" },
  { iso: "TR", name: "Türkiye", dial: "+90", flag: "🇹🇷" },
  { iso: "UG", name: "Uganda", dial: "+256", flag: "🇺🇬" },
  { iso: "UA", name: "Ukraine", dial: "+380", flag: "🇺🇦" },
  { iso: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪" },
  { iso: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧" },
  { iso: "US", name: "United States", dial: "+1", flag: "🇺🇸" },
  { iso: "UY", name: "Uruguay", dial: "+598", flag: "🇺🇾" },
  { iso: "UZ", name: "Uzbekistan", dial: "+998", flag: "🇺🇿" },
  { iso: "VE", name: "Venezuela", dial: "+58", flag: "🇻🇪" },
  { iso: "VN", name: "Vietnam", dial: "+84", flag: "🇻🇳" },
  { iso: "YE", name: "Yemen", dial: "+967", flag: "🇾🇪" },
  { iso: "ZM", name: "Zambia", dial: "+260", flag: "🇿🇲" },
  { iso: "ZW", name: "Zimbabwe", dial: "+263", flag: "🇿🇼" },
];

/**
 * How many digits a mobile number has after the country code, without a trunk
 * `0`. One number where the country has a single length, a range otherwise.
 */
const MOBILE_DIGITS: Record<string, number | [number, number]> = {
  AF: 9, AL: 9, DZ: 9, AR: [10, 11], AM: 8, AU: 9, AT: [10, 13], AZ: 9,
  BH: 8, BD: 10, BY: 9, BE: 9, BT: 8, BO: 8, BA: [8, 9], BW: 8, BR: [10, 11],
  BN: 7, BG: [8, 9], KH: [8, 9], CM: 9, CA: 10, CL: 9, CN: 11, CO: 10, CR: 8,
  HR: [8, 9], CY: 8, CZ: 9, DK: 8, DO: 10, EC: 9, EG: 10, SV: 8, EE: [7, 8],
  ET: 9, FI: [6, 10], FR: 9, GE: 9, DE: [10, 11], GH: 9, GR: 10, GT: 8, HN: 8,
  HK: 8, HU: 9, IS: 7, IN: 10, ID: [9, 12], IQ: 10, IE: 9, IL: 9, IT: [9, 10],
  CI: 10, JM: 10, JP: 10, JO: 9, KZ: 10, KE: 9, KW: 8, KG: 9, LA: [8, 10],
  LV: 8, LB: [7, 8], LY: 9, LT: 8, LU: 9, MO: 8, MG: 9, MW: 9, MY: [9, 10],
  MV: 7, MT: 8, MU: 8, MX: 10, MD: 8, MN: 8, ME: 8, MA: 9, MZ: 9, MM: [8, 10],
  NA: 9, NP: 10, NL: 9, NZ: [8, 10], NI: 8, NG: 10, MK: 8, NO: 8, OM: 8,
  PK: 10, PS: 9, PA: 8, PY: 9, PE: 9, PH: 10, PL: 9, PT: 9, PR: 10, QA: 8,
  RO: 9, RU: 10, RW: 9, SA: 9, SN: 9, RS: [8, 9], SG: 8, SK: 9, SI: 8, ZA: 9,
  KR: [9, 10], ES: 9, LK: 9, SE: [7, 9], CH: 9, TW: 9, TZ: 9, TH: [8, 9],
  TT: 10, TN: 8, TR: 10, UG: 9, UA: 9, AE: 9, GB: 10, US: 10, UY: 8, UZ: 9,
  VE: 10, VN: [9, 10], YE: 9, ZM: 9, ZW: 9,
};

/** Where the leading `0` is part of the number rather than a trunk prefix. */
const ZERO_IS_DIGIT = new Set(["IT", "CI"]);

export function mobileDigits(iso: string): { min: number; max: number } {
  const entry = MOBILE_DIGITS[iso] ?? [6, 15];
  return typeof entry === "number"
    ? { min: entry, max: entry }
    : { min: entry[0], max: entry[1] };
}

/** Digits only, capped at the country's length plus room for a trunk `0`. */
export function clampPhone(iso: string, raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const trunk = digits.startsWith("0") && !ZERO_IS_DIGIT.has(iso) ? 1 : 0;
  return digits.slice(0, mobileDigits(iso).max + trunk);
}

/** The number as it follows the country code, or null if its length is wrong. */
export function nationalNumber(iso: string, raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (!ZERO_IS_DIGIT.has(iso)) digits = digits.replace(/^0/, "");
  const { min, max } = mobileDigits(iso);
  return digits.length >= min && digits.length <= max ? digits : null;
}

/** The fallback, and the one most of this platform's traffic dials from. */
export const DEFAULT_ISO = "IN";

const BY_ISO = new Map(DIAL_CODES.map((entry) => [entry.iso, entry]));

export function dialCodeFor(iso: string): DialCode {
  return BY_ISO.get(iso) ?? BY_ISO.get(DEFAULT_ISO) ?? DIAL_CODES[0];
}

/**
 * The visitor's country, guessed from the browser locale's region subtag —
 * `en-IN` is India, `pt-BR` is Brazil.
 *
 * A guess, and named one: a locale is a language preference, not a location,
 * so a bare `en` or a German-speaking visitor in Dubai lands on the fallback.
 * It only sets where the select opens, which the visitor can change, so being
 * wrong costs a tap rather than a bad number.
 *
 * Returns the default on the server, so the first client render matches the
 * markup React hydrates into.
 */
export function guessIso(): string {
  if (typeof navigator === "undefined") return DEFAULT_ISO;
  try {
    for (const locale of navigator.languages ?? [navigator.language]) {
      const region = new Intl.Locale(locale).maximize().region;
      if (region && BY_ISO.has(region)) return region;
    }
  } catch {
    // An unparseable locale is not worth a broken form.
  }
  return DEFAULT_ISO;
}

/** The country a locale names outright — `en-IN` is India, a bare `en` is none. */
export function isoFromLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    const region = new Intl.Locale(locale).region;
    return region && BY_ISO.has(region) ? region : null;
  } catch {
    return null;
  }
}

/**
 * Split a number that already carries its country code, longest code first so
 * +91 is not read as +9. Anything that does not start with a `+` is returned
 * whole, on the default country.
 */
export function splitDialCode(raw: string): { iso: string; rest: string } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("+")) return { iso: DEFAULT_ISO, rest: trimmed };

  const match = [...DIAL_CODES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((entry) => trimmed.startsWith(entry.dial));

  return match
    ? { iso: match.iso, rest: trimmed.slice(match.dial.length).trim() }
    : { iso: DEFAULT_ISO, rest: trimmed };
}

/**
 * The national part of whatever the visitor typed into the number field.
 *
 * People paste numbers that already carry a code, and the field sits beside a
 * select that adds one, so without this a pasted "+919876543210" is stored as
 * "+91 +919876543210". Only a leading `+` is treated this way — a leading zero
 * is left alone, because it is part of the number in Italy and a trunk prefix
 * to drop in most of the rest of Europe, and this is not the place to know
 * which.
 */
export function stripDialCode(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("+") ? splitDialCode(trimmed).rest : trimmed;
}
