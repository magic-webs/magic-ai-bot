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
