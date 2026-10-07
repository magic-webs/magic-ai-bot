/**
 * Razorpay's REST API, from the default Convex runtime: fetch and Web Crypto,
 * no SDK — the same way convex/lib/appWebhooks.ts checks the Magic apps.
 *
 * Three secrets, all on the deployment rather than in `.env.local`, because
 * every call and every signature check happens inside Convex:
 *
 *   RAZORPAY_KEY_ID          public; also handed to Checkout in the browser
 *   RAZORPAY_KEY_SECRET      signs API calls, and Checkout's return signature
 *   RAZORPAY_WEBHOOK_SECRET  the secret typed into the dashboard's webhook
 *
 * Razorpay counts in paise and in Unix seconds; the rest of billing counts in
 * micros and milliseconds. Both conversions happen here and nowhere else.
 */

import { ConvexError } from "convex/values";

const API = "https://api.razorpay.com/v1";

export type RazorpayConfig = { keyId: string; keySecret: string };

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export function requireRazorpay(): RazorpayConfig {
  const config = razorpayConfig();
  if (!config) {
    throw new ConvexError(
      "Payments are not set up yet. The platform needs its Razorpay keys before it can take a payment."
    );
  }
  return config;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

/** One API call. Razorpay's own error description is what gets thrown. */
export async function razorpay<T>(
  config: RazorpayConfig,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${config.keyId}:${config.keySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON — kept as text for the error below.
  }
  if (!response.ok) {
    const error = (parsed as { error?: { description?: string; code?: string } })
      ?.error;
    throw new RazorpayError(
      error?.description || `Razorpay answered ${response.status}: ${text.slice(0, 200)}`,
      response.status,
      error?.code
    );
  }
  return parsed as T;
}

// --- Units -------------------------------------------------------------------

/** Razorpay's Unix seconds, as the milliseconds everything else stores. */
export function fromSeconds(value: number | null | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value * 1000 : undefined;
}

export function toSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

// --- Signatures ------------------------------------------------------------------

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
 * Checkout's return signature. The message is `order_id|payment_id` for an
 * order and `payment_id|subscription_id` for a subscription — the other way
 * round — and the ids must be the ones this deployment created, never the
 * ones the browser sent back beside the signature.
 */
export async function checkoutSignatureValid(
  config: RazorpayConfig,
  message: string,
  signature: string
): Promise<boolean> {
  return sameString(await hmacHex(config.keySecret, message), signature.trim());
}

/** `X-Razorpay-Signature`: HMAC-SHA256 of the raw body, hex. */
export async function webhookSignatureValid(
  secret: string,
  rawBody: string,
  signature: string
): Promise<boolean> {
  return sameString(await hmacHex(secret, rawBody), signature.trim());
}

// --- Entities --------------------------------------------------------------------
// Only the fields this deployment reads. Razorpay sends many more.

export type RazorpayPlan = { id: string };

export type RazorpaySubscription = {
  id: string;
  status: string;
  plan_id: string;
  customer_id?: string | null;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  paid_count?: number | null;
  short_url?: string | null;
};

export type RazorpayOrder = { id: string; amount: number; currency: string };

export type RazorpayPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  order_id?: string | null;
  invoice_id?: string | null;
  method?: string | null;
  customer_id?: string | null;
  token_id?: string | null;
  error_description?: string | null;
};

export type RazorpayCustomer = { id: string };

export type RazorpayToken = {
  id: string;
  method?: string | null;
  recurring_details?: { status?: string | null; failure_reason?: string | null } | null;
};

/** A subscription as the internal mutations take it — see razorpayEvents. */
export function subscriptionFields(entity: RazorpaySubscription) {
  return {
    razorpaySubscriptionId: entity.id,
    status: entity.status,
    currentStart: fromSeconds(entity.current_start),
    currentEnd: fromSeconds(entity.current_end),
    chargeAt: fromSeconds(entity.charge_at),
    startAt: fromSeconds(entity.start_at),
    paidCount: typeof entity.paid_count === "number" ? entity.paid_count : undefined,
    shortUrl: entity.short_url ?? undefined,
  };
}

/** A payment as the internal mutations take it. */
export function paymentFields(entity: RazorpayPayment) {
  return {
    razorpayPaymentId: entity.id,
    status: entity.status,
    amountPaise: entity.amount,
    currency: entity.currency,
    orderId: entity.order_id ?? undefined,
    invoiceId: entity.invoice_id ?? undefined,
    method: entity.method ?? undefined,
    customerId: entity.customer_id ?? undefined,
    tokenId: entity.token_id ?? undefined,
    error: entity.error_description ?? undefined,
  };
}
