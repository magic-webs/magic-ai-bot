const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/;
const LINK_BOTS = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|Discordbot|bot\b|crawler|spider|preview/i;

export function linkCode(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "campaign";
}

export function withUtm(target: string, campaign: string): string {
  try {
    const url = new URL(target);
    if (!url.searchParams.has("utm_source")) url.searchParams.set("utm_source", "whatsapp");
    if (!url.searchParams.has("utm_medium")) url.searchParams.set("utm_medium", "marketing");
    if (!url.searchParams.has("utm_campaign")) url.searchParams.set("utm_campaign", campaign);
    return url.toString();
  } catch {
    return target;
  }
}

export function trackFirstLink(
  parameters: string[],
  text: string,
  base: string,
  campaign: string
): { parameters: string[]; text: string; code?: string; target?: string } {
  for (const [index, parameter] of parameters.entries()) {
    const match = parameter.match(URL_PATTERN);
    if (!match) continue;
    const code = linkCode();
    const tracked = `${base.replace(/\/$/, "")}/l/${code}`;
    const next = [...parameters];
    next[index] = parameter.replace(match[0], tracked);
    return {
      parameters: next,
      text: text.replace(match[0], tracked),
      code,
      target: withUtm(match[0], campaign),
    };
  }
  return { parameters, text };
}

export function isLinkBot(userAgent: string | null): boolean {
  return !userAgent || LINK_BOTS.test(userAgent);
}
