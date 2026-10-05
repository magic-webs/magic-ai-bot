const STOP_WORDS = new Set([
  "stop",
  "stop all",
  "stopall",
  "unsubscribe",
  "opt out",
  "optout",
  "opt-out",
  "no more messages",
  "बंद",
  "बंद करो",
  "रोकें",
]);

const START_WORDS = new Set(["start", "subscribe", "unstop", "resume", "opt in", "optin"]);

export type OptKeyword = "stop" | "start";

export function optKeyword(text: string): OptKeyword | null {
  const normalised = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,'"]+/g, "")
    .replace(/\s+/g, " ");
  if (STOP_WORDS.has(normalised)) return "stop";
  if (START_WORDS.has(normalised)) return "start";
  return null;
}

export function optOutReply(business: string): string {
  return `You're unsubscribed. ${business} won't send you offers or updates here any more. Reply START if you change your mind.`;
}

export function optInReply(business: string): string {
  return `You're subscribed again. ${business} will keep you posted here. Reply STOP any time to opt out.`;
}
