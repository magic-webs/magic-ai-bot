"use client";

import { UsagePanel } from "@/components/usage-panel";

export default function AdminUsagePage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Tokens &amp; cost
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every model call the platform has made, priced and attributed to the
          workspace that caused it.
        </p>
      </header>

      <UsagePanel />
    </div>
  );
}
