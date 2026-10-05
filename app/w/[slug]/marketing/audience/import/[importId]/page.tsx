"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { ImportProgress } from "@/components/marketing/audience/import-flow";

export default function MarketingImportReviewPage({
  params,
}: {
  params: Promise<{ slug: string; importId: string }>;
}) {
  const { importId } = use(params);
  const workspace = useWorkspace();
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:p-6">
      <ImportProgress
        importId={importId as Id<"audienceImports">}
        onClose={() => router.push(`/w/${workspace.slug}/marketing/audience`)}
      />
    </div>
  );
}
