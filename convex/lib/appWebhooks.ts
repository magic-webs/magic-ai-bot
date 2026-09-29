// Checking that a result really came from the app it claims to.
//
// Both apps sign the same way — HMAC-SHA256 over `<timestamp>.<raw body>` with
// the secret handed back when the webhook was registered — and differ only in
// the header names and the timestamp's unit. Web Crypto rather than node:crypto
// so this runs inside the HTTP action itself, before anything is scheduled.

import type { AppId } from "./apps";

/** How far a delivery's timestamp may be from now before it is refused. */
const TOLERANCE_MS = 15 * 60 * 1000;

const HEADERS: Record<
  AppId,
  { signature: string; timestamp: string; delivery: string; event: string }
> = {
  magic_forms: {
    signature: "x-magicforms-signature",
    timestamp: "x-magicforms-timestamp",
    delivery: "x-magicforms-delivery",
    event: "x-magicforms-event",
  },
  magic_reward: {
    signature: "x-magic-signature",
    timestamp: "x-magic-timestamp",
    delivery: "x-magic-delivery",
    event: "x-magic-event",
  },
};

export type SignedDelivery = {
  deliveryId: string;
  event: string;
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
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

/**
 * The delivery's id and event if the signature holds, or why it does not.
 *
 * Magic Forms sends its timestamp in seconds and Magic Reward in
 * milliseconds; anything past 10^12 is read as milliseconds, which is safe
 * for every date either could plausibly send.
 */
export async function verifyDelivery(
  app: AppId,
  headers: Headers,
  rawBody: string,
  secret: string,
  now: number
): Promise<{ ok: true; delivery: SignedDelivery } | { ok: false; error: string }> {
  const names = HEADERS[app];
  const signature = headers.get(names.signature)?.trim() ?? "";
  const timestamp = headers.get(names.timestamp)?.trim() ?? "";
  if (!signature || !timestamp) {
    return { ok: false, error: "Missing signature." };
  }

  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp)) return { ok: false, error: "Bad timestamp." };
  const sentAt = stamp > 1e12 ? stamp : stamp * 1000;
  if (Math.abs(now - sentAt) > TOLERANCE_MS) {
    return { ok: false, error: "Stale delivery." };
  }

  const expected = `sha256=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
  if (!sameString(expected, signature)) {
    return { ok: false, error: "Bad signature." };
  }

  return {
    ok: true,
    delivery: {
      deliveryId: headers.get(names.delivery)?.trim() || `${timestamp}:${signature.slice(-16)}`,
      event: headers.get(names.event)?.trim() ?? "",
    },
  };
}
