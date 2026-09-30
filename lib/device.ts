// A short name for the browser a sign-in came from — "Chrome on Windows" —
// shown to whoever signs in next with the same login, so they can tell
// whether the session they are about to sign out is theirs.
//
// Deliberately coarse. It only has to be recognisable, and a full user-agent
// parser would be a dependency for one line of copy.

const BROWSERS: Array<[RegExp, string]> = [
  // Order matters: Edge and Opera also claim to be Chrome, and Chrome claims
  // to be Safari.
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(userAgent: string | null): string | undefined {
  if (!userAgent) return undefined;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "A web browser";
}
