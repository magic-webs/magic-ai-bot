"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { Spinner } from "@/components/ui/spinner";

/**
 * Where the Orders page used to be.
 *
 * Orders are the workspace's Orders record book now — its fields and stages
 * edited like any other book's, its table under Leads in the sidebar. This
 * address is kept only so a bookmark or an old notification link lands on
 * that book instead of a 404.
 */
export default function OrdersRedirect() {
  const workspace = useWorkspace();
  const router = useRouter();
  const base = `/w/${workspace.slug}`;
  const bookId = useQuery(api.records.ordersBookId, {
    workspaceId: workspace._id,
  });

  useEffect(() => {
    if (bookId) router.replace(`${base}/records/${bookId}`);
  }, [base, bookId, router]);

  if (bookId === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Orders are kept in a record book now, and this workspace does not have
        its Orders book yet.{" "}
        <Link href={`${base}/records`} className="underline underline-offset-4">
          Open Record books
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
      <Spinner /> Opening Orders…
    </div>
  );
}
