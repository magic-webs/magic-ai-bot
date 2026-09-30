"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BillingPanel } from "@/components/billing/billing-panel";
import { PlanTab } from "@/components/billing/plan-tab";
import { WalletTab } from "@/components/billing/wallet-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartBarIcon, ReceiptIcon, WalletIcon } from "@phosphor-icons/react";

const TABS = ["plan", "wallet", "usage"] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab =>
  TABS.includes(value as Tab);

export default function BillingPage() {
  // The tab lives in the URL rather than in state: the low-balance banner
  // links straight to ?tab=wallet, and the wallet tab sends people to
  // ?tab=plan for their billing details — both have to land on the right
  // tab, including when the page is already open.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab: Tab = isTab(requested) ? requested : "plan";

  const switchTab = (next: string) => {
    // Everything else in the query string is somebody else's, so it stays.
    const query = new URLSearchParams(params.toString());
    query.set("tab", next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Billing
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Your plan and what it costs each month, the wallet WhatsApp messages
          are paid from, and what each message consumed.
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => switchTab(String(next))}
        className="min-w-0 gap-4"
      >
        <TabsList>
          <TabsTrigger value="plan">
            <ReceiptIcon /> Plan
          </TabsTrigger>
          <TabsTrigger value="wallet">
            <WalletIcon /> Wallet
          </TabsTrigger>
          <TabsTrigger value="usage">
            <ChartBarIcon /> Message usage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <PlanTab />
        </TabsContent>
        <TabsContent value="wallet">
          <WalletTab />
        </TabsContent>
        <TabsContent value="usage">
          <BillingPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
