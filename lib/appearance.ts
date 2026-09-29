/**
 * Light, dark, or whatever the device is set to — each person's own choice,
 * kept in this browser. The palette a workspace renders in is a separate axis
 * (`data-theme`, components/workspace-theme.tsx), chosen once for everyone.
 *
 * Light is the default rather than the device's setting, because it is what
 * the console has always been: nobody's screen changes until they pick.
 *
 * No React here, so the root layout can inline the same decision as a script
 * that runs before the first paint.
 */

export const APPEARANCES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

export type Appearance = (typeof APPEARANCES)[number]["value"];

export const APPEARANCE_KEY = "magic-agent.appearance";
export const DEFAULT_APPEARANCE: Appearance = "light";

/**
 * Where the choice applies: the console. The landing page and the legal pages
 * are designed light, and the website widget renders on customers' own sites,
 * where the operator's preference has no business — the same browser would
 * otherwise show a customer's widget dark because its owner likes dark.
 */
const THEMED_PREFIXES = ["/w/", "/admin", "/desk", "/login"];

export const isAppearance = (value: unknown): value is Appearance =>
  value === "light" || value === "dark" || value === "system";

export function isDark(
  appearance: Appearance,
  pathname: string,
  systemDark: boolean
): boolean {
  if (!THEMED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  return appearance === "dark" || (appearance === "system" && systemDark);
}

export function applyDark(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  // Scrollbars and native controls follow too, rather than staying white.
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * `isDark` and `applyDark` written out by hand, for <head>. It cannot import
 * anything, and it has to run before the body paints or a dark page opens
 * white and snaps. Change one, change the other.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var a=localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY
)});var p=location.pathname;var t=${JSON.stringify(
  THEMED_PREFIXES
)}.some(function(x){return p.indexOf(x)===0});var d=t&&(a==="dark"||(a==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches));var r=document.documentElement;if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
