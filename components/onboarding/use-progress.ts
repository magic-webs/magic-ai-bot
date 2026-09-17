"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { scoreWorkspace, type Progress } from "@/lib/onboarding";

/**
 * The whole setup, scored.
 *
 * Four list queries plus the workspace already in context. They are the same
 * queries the individual step pages open, and Convex dedupes identical
 * subscriptions on one client — so the rail scoring every step costs nothing
 * on top of the step that is open.
 *
 * `loading` is separate from the numbers rather than making them nullable: a
 * caller that wants a skeleton checks it, and a caller that only wants the
 * shape (the rail, which is about to be replaced by real numbers a tick later)
 * can render 0% without a null check on every field.
 */
export function useProgress(): { progress: Progress; loading: boolean } {
  const workspace = useWorkspace();
  const args = { workspaceId: workspace._id };

  const agents = useQuery(api.agents.listByWorkspace, args);
  const sources = useQuery(api.knowledge.listByWorkspace, args);
  const products = useQuery(api.products.listByWorkspace, args);
  const stages = useQuery(api.leads.listStages, args);

  return {
    progress: scoreWorkspace({
      workspace,
      agents,
      sources,
      products,
      stages,
    }),
    loading:
      agents === undefined ||
      sources === undefined ||
      products === undefined ||
      stages === undefined,
  };
}
