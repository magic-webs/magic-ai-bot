/**
 * Which currency an account is billed in. Pure, with no imports, so the
 * pricing code and React can both reach it without a cycle.
 */

type SettingsLike = {
  currency: string;
  currencies?: Array<{ currency: string }>;
};

/** The default currency first, then every other one with terms of its own. */
export function supportedCurrencies(settings: SettingsLike): string[] {
  const others = settings.currencies?.map((entry) => entry.currency) ?? ["USD"];
  return [...new Set([settings.currency, ...others])];
}

export function isIndian(workspace: {
  currency?: string;
  timezone?: string;
}): boolean {
  return (
    workspace.currency === "INR" ||
    workspace.timezone === "Asia/Kolkata" ||
    workspace.timezone === "Asia/Calcutta"
  );
}

/** INR for an Indian business, USD for anyone else, when both are sold. */
export function guessCurrency(
  settings: SettingsLike,
  workspace: { currency?: string; timezone?: string }
): string {
  const supported = supportedCurrencies(settings);
  const wanted = isIndian(workspace) ? "INR" : "USD";
  return supported.includes(wanted) ? wanted : settings.currency;
}

/**
 * The account's own currency; an account made before currencies were per
 * account stays on the default, since its wallet and plan are in it.
 */
export function currencyOf(
  settings: SettingsLike | null,
  account: { currency?: string } | null,
  workspace: { currency?: string; timezone?: string } | null
): string {
  if (account?.currency) return account.currency;
  if (account || !settings || !workspace) return settings?.currency ?? "INR";
  return guessCurrency(settings, workspace);
}
