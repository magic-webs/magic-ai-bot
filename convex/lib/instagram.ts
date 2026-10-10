import type { Outbound } from "./whatsappSend";

export const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_GRAPH = "https://graph.instagram.com";
export const INSTAGRAM_API_VERSION = "v23.0";
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
];
export const INSTAGRAM_TEXT_LIMIT = 1000;

const CAP = {
  quickReplies: 13,
  quickReplyTitle: 20,
  buttonText: 640,
  buttonTitle: 20,
} as const;

export function instagramRedirectUri(siteUrl: string): string {
  return `${siteUrl}/instagram/callback`;
}

export function graphUrl(path: string): string {
  return `${INSTAGRAM_GRAPH}/${INSTAGRAM_API_VERSION}/${path.replace(/^\//, "")}`;
}

type Json = Record<string, unknown>;

/**
 * The Send API `message` for an outbound, or null when Instagram has nothing
 * that can carry it — the caller tells the model to write it out as text.
 */
export function instagramMessage(message: Outbound): Json | null {
  switch (message.kind) {
    case "text":
      return { text: message.body.slice(0, INSTAGRAM_TEXT_LIMIT) };
    case "media": {
      if (!("link" in message.source)) return null;
      const type = message.media === "document" ? "file" : message.media;
      return { attachment: { type, payload: { url: message.source.link } } };
    }
    case "buttons":
      return quickReplies(
        message.body,
        message.buttons.map((button) => ({ id: button.id, title: button.title }))
      );
    case "list":
      return quickReplies(
        message.body,
        message.sections.flatMap((section) => section.rows)
      );
    case "cta_url":
      return {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: message.body.slice(0, CAP.buttonText),
            buttons: [
              {
                type: "web_url",
                url: message.url,
                title: message.displayText.slice(0, CAP.buttonTitle),
              },
            ],
          },
        },
      };
    default:
      return null;
  }
}

function quickReplies(
  body: string,
  options: Array<{ id: string; title: string }>
): Json | null {
  if (options.length === 0 || options.length > CAP.quickReplies) return null;
  return {
    text: body.slice(0, INSTAGRAM_TEXT_LIMIT),
    quick_replies: options.map((option) => ({
      content_type: "text",
      title: option.title.trim().slice(0, CAP.quickReplyTitle),
      payload: option.id,
    })),
  };
}

export function splitForInstagram(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > INSTAGRAM_TEXT_LIMIT) {
    const window = remaining.slice(0, INSTAGRAM_TEXT_LIMIT);
    let cut = window.lastIndexOf("\n\n");
    if (cut < INSTAGRAM_TEXT_LIMIT * 0.5) cut = window.lastIndexOf(". ") + 1;
    if (cut < INSTAGRAM_TEXT_LIMIT * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = INSTAGRAM_TEXT_LIMIT;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `X-Hub-Signature-256` over the raw body, exactly as Meta sent it. */
export async function validSignature(
  secret: string,
  rawBody: string,
  header: string | null
): Promise<boolean> {
  if (!header) return false;
  const expected = await hmacHex(secret, rawBody);
  return sameString(header.replace(/^sha256=/, ""), expected);
}

function base64UrlBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** Meta's deauthorize and data-deletion callbacks: `<sig>.<payload>`. */
export async function parseSignedRequest(
  secret: string,
  signedRequest: string
): Promise<{ user_id?: string } | null> {
  const [signature, payload] = signedRequest.split(".", 2);
  if (!signature || !payload) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  );
  const given = base64UrlBytes(signature);
  if (
    given.length !== expected.length ||
    given.reduce((diff, byte, i) => diff | (byte ^ expected[i]), 0) !== 0
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlBytes(payload))
    ) as { user_id?: unknown };
    return {
      user_id: parsed.user_id === undefined ? undefined : String(parsed.user_id),
    };
  } catch {
    return null;
  }
}
