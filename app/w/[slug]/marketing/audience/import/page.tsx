"use client";

import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace-provider";
import { ImportUpload } from "@/components/marketing/audience/import-flow";

export default function MarketingImportPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const base = `/w/${workspace.slug}/marketing/audience`;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:p-6">
      <ImportUpload
        onStarted={(importId) => router.push(`${base}/import/${importId}`)}
        onClose={() => router.push(base)}
      />
    </div>
  );
}
