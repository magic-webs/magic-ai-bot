const REASONS: Record<string, string> = {
  "131026": "Number can't receive WhatsApp messages",
  "131049": "Meta held it back to protect engagement",
  "130472": "Meta's marketing experiment held it back",
  "131050": "The person stopped marketing messages in WhatsApp",
  "131047": "Outside the 24-hour reply window",
  "131048": "Too many messages flagged as spam",
  "131056": "Sent too fast to the same number",
  "131051": "Message type not supported",
  "131053": "The media could not be uploaded",
  "131031": "The WhatsApp account is locked",
  "132000": "Template variables do not match",
  "132001": "Template does not exist in that language",
  "132005": "Template text is too long once filled in",
  "132007": "Template breaks a WhatsApp policy",
  "132012": "Template variables are in the wrong format",
  "132015": "Template is paused for low quality",
  "132016": "Template is disabled",
  "368": "The number is temporarily blocked for policy",
  "130429": "Sending faster than WhatsApp allows",
  "131000": "Something went wrong at WhatsApp",
};

export function failureCode(error: string | undefined): string {
  if (!error) return "unknown";
  const match = error.match(/\b(13\d{4}|368)\b/);
  if (match) return match[1];
  if (/HTTP 401|HTTP 403/.test(error)) return "auth";
  if (/HTTP 5\d\d|fetch|network|timed? ?out/i.test(error)) return "network";
  return "other";
}

export function failureLabel(code: string): string {
  if (REASONS[code]) return REASONS[code];
  if (code === "auth") return "The channel's access token was refused";
  if (code === "network") return "The provider could not be reached";
  if (code === "unknown") return "No reason given";
  return "Other error";
}
