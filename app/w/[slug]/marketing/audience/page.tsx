"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { AddContactsDialog } from "@/components/marketing/add-contacts-dialog";
import { AudienceTab } from "@/components/marketing/audience/audience-tab";
import { BirthdaySettings } from "@/components/marketing/birthday-settings";
import { TableSkeleton } from "@/components/skeletons";

export default function MarketingAudiencePage() {
  const workspace = useWorkspace();
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const templates = useMemo(() => overview?.templates ?? [], [overview]);
  const [adding, setAdding] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  if (!overview) return <TableSkeleton rows={6} columns={4} />;

  return (
    <>
      <AudienceTab
        categories={overview.categories}
        weeklyCap={overview.weeklyCap}
        reachable={overview.audience.whatsapp}
        optedOut={overview.audience.optedOut}
        onAddByHand={() => {
          setAdding((n) => n + 1);
          setAddOpen(true);
        }}
        birthdays={
          <BirthdaySettings
            key={JSON.stringify(overview.settings)}
            settings={overview.settings}
            templates={templates}
            timezone={workspace.timezone}
            withBirthday={overview.audience.withBirthday}
          />
        }
      />
      <AddContactsDialog key={adding} open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
