"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/components/workspace-provider";
import { OverviewTab } from "@/components/marketing/overview-tab";

export default function MarketingOverviewPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const base = `/w/${workspace.slug}/marketing`;
  const routes: Record<string, string> = {
    audience: `${base}/audience/import`,
    events: `${base}/events`,
    campaigns: `${base}/campaigns/new`,
  };
  const legacyTab = useSearchParams().get("tab");
  useEffect(() => {
    if (!legacyTab || legacyTab === "overview") return;
    const section = legacyTab === "contacts" ? "audience" : legacyTab;
    if (["audience", "campaigns", "events", "calendar", "templates"].includes(section)) {
      router.replace(`${base}/${section}`);
    }
  }, [legacyTab, router, base]);

  return <OverviewTab onGo={(section) => router.push(routes[section] ?? base)} />;
}
