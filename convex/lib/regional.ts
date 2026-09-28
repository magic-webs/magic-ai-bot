/**
 * The currencies, locales and timezones a workspace can be set to.
 *
 * One list, imported by every form that asks — the admin's new-workspace
 * dialog, onboarding and the company profile used to carry three lists of
 * their own, which is how Tanzania came to be missing from all three. Lives in
 * convex/lib so `workspaces.update` validates against the same thing the
 * pickers offer, and stays dependency-free because React imports it too.
 *
 * Not exhaustive on purpose for currencies and locales: a picker of every ISO
 * code is a haystack. A stored value that is not listed still renders — the
 * pickers append it — so nothing saved before a code was dropped goes blank.
 */

export type RegionalOption = { value: string; label: string };

export const CURRENCIES: RegionalOption[] = [
  { value: "USD", label: "US dollar" },
  { value: "EUR", label: "Euro" },
  { value: "GBP", label: "British pound" },
  { value: "INR", label: "Indian rupee" },
  { value: "AED", label: "UAE dirham" },
  { value: "SAR", label: "Saudi riyal" },
  { value: "QAR", label: "Qatari riyal" },
  { value: "KWD", label: "Kuwaiti dinar" },
  { value: "OMR", label: "Omani rial" },
  { value: "BHD", label: "Bahraini dinar" },
  { value: "TZS", label: "Tanzanian shilling" },
  { value: "KES", label: "Kenyan shilling" },
  { value: "UGX", label: "Ugandan shilling" },
  { value: "RWF", label: "Rwandan franc" },
  { value: "ETB", label: "Ethiopian birr" },
  { value: "ZAR", label: "South African rand" },
  { value: "NGN", label: "Nigerian naira" },
  { value: "GHS", label: "Ghanaian cedi" },
  { value: "EGP", label: "Egyptian pound" },
  { value: "MAD", label: "Moroccan dirham" },
  { value: "PKR", label: "Pakistani rupee" },
  { value: "BDT", label: "Bangladeshi taka" },
  { value: "LKR", label: "Sri Lankan rupee" },
  { value: "NPR", label: "Nepalese rupee" },
  { value: "SGD", label: "Singapore dollar" },
  { value: "MYR", label: "Malaysian ringgit" },
  { value: "IDR", label: "Indonesian rupiah" },
  { value: "PHP", label: "Philippine peso" },
  { value: "THB", label: "Thai baht" },
  { value: "CNY", label: "Chinese yuan" },
  { value: "JPY", label: "Japanese yen" },
  { value: "AUD", label: "Australian dollar" },
  { value: "NZD", label: "New Zealand dollar" },
  { value: "CAD", label: "Canadian dollar" },
  { value: "CHF", label: "Swiss franc" },
  { value: "BRL", label: "Brazilian real" },
  { value: "MXN", label: "Mexican peso" },
];

export const LOCALES: RegionalOption[] = [
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "en-AE", label: "English (UAE)" },
  { value: "ar-AE", label: "Arabic (UAE)" },
  { value: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { value: "en-TZ", label: "English (Tanzania)" },
  { value: "sw-TZ", label: "Swahili (Tanzania)" },
  { value: "en-KE", label: "English (Kenya)" },
  { value: "sw-KE", label: "Swahili (Kenya)" },
  { value: "en-UG", label: "English (Uganda)" },
  { value: "en-RW", label: "English (Rwanda)" },
  { value: "en-ZA", label: "English (South Africa)" },
  { value: "en-NG", label: "English (Nigeria)" },
  { value: "en-GH", label: "English (Ghana)" },
  { value: "en-PK", label: "English (Pakistan)" },
  { value: "en-SG", label: "English (Singapore)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
];

/**
 * The zones most workspaces are set to, for suggestion chips. The full picker
 * offers every zone the browser knows — see `allTimezones`.
 */
export const COMMON_TIMEZONES = [
  "Europe/London",
  "America/New_York",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Africa/Dar_es_Salaam",
  "Africa/Nairobi",
  "Australia/Sydney",
];

/**
 * Fallback when the runtime cannot enumerate its zones. Older Safari and some
 * server runtimes have no `Intl.supportedValuesOf`, and a picker that opens
 * onto nothing is worse than one that offers the regions we actually serve.
 */
const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Africa/Dar_es_Salaam",
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Kigali",
  "Africa/Addis_Ababa",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
];

/** Every IANA zone this runtime knows, UTC first. */
export function allTimezones(): string[] {
  const enumerate = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  const zones = enumerate ? enumerate("timeZone") : FALLBACK_TIMEZONES;
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
}

/** "Africa/Dar_es_Salaam" → "Dar es Salaam", for a label a person reads. */
export function timezoneCity(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/** "GMT+3", or null where the runtime cannot say. */
export function timezoneOffset(zone: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? null;
  } catch {
    return null;
  }
}

// --- Validation, for the mutations ---------------------------------------
// Loose on purpose: these accept any real code, not only the listed ones, so
// an administrator can still set a currency the picker does not offer through
// the MCP connector. What they refuse is the typo that breaks something — a
// timezone Intl cannot resolve sends every scheduled greeting at UTC.

export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export function isValidLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}
