"use client";

import { BillingPanel } from "@/components/billing/billing-panel";

export default function BillingPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Billing
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          What each WhatsApp message consumed, by conversation type, and what
          it all came to.
        </p>
      </header>

      <BillingPanel />
    </div>
  );
}
