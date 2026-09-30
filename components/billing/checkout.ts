"use client";

import type { CheckoutOptions } from "@/convex/razorpay";

/**
 * Razorpay Checkout, opened from what convex/razorpay.ts handed back.
 *
 * The script is loaded on first use rather than on every page: it is only
 * ever needed on Billing, and only once somebody presses pay. The promise
 * resolves with Checkout's success payload — which is then sent back to
 * Convex to be verified, never trusted as it stands — and rejects with
 * `CheckoutClosed` when the person closes the window.
 */

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export type CheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_signature: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
};
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

export class CheckoutClosed extends Error {
  constructor() {
    super("Checkout was closed before the payment finished.");
    this.name = "CheckoutClosed";
  }
}

let loading: Promise<RazorpayConstructor> | null = null;

function loadRazorpay(): Promise<RazorpayConstructor> {
  const existing = (window as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const loaded = (window as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded) resolve(loaded);
      else reject(new Error("Razorpay Checkout did not load."));
    };
    script.onerror = () => {
      // Let the next press try again rather than failing forever.
      loading = null;
      script.remove();
      reject(new Error("Razorpay Checkout could not be reached. Check the connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openCheckout(options: CheckoutOptions): Promise<CheckoutSuccess> {
  const Razorpay = await loadRazorpay();
  return await new Promise<CheckoutSuccess>((resolve, reject) => {
    const target =
      options.kind === "subscription"
        ? { subscription_id: options.subscriptionId }
        : {
            order_id: options.orderId,
            amount: options.amountPaise,
            currency: options.currency,
            ...(options.customerId ? { customer_id: options.customerId } : {}),
            ...(options.recurring ? { recurring: "1" } : {}),
          };

    const checkout = new Razorpay({
      key: options.keyId,
      name: options.name,
      description: options.description,
      prefill: options.prefill,
      ...target,
      handler: (response: CheckoutSuccess) => resolve(response),
      modal: { ondismiss: () => reject(new CheckoutClosed()) },
    });
    // A failed attempt keeps the window open for another try, so it is not
    // an outcome yet — closing the window is.
    checkout.on("payment.failed", () => undefined);
    checkout.open();
  });
}
