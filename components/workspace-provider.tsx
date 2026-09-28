"use client";

import { createContext, useContext } from "react";
import type { Doc } from "@/convex/_generated/dataModel";

/**
 * The workspace document as `workspaces.getBySlug` returns it: the row, plus
 * the company logo resolved to something a browser can draw — a storage id
 * is not, and every page asking for its own URL would be a query per page.
 */
export type Workspace = Doc<"workspaces"> & { logoSrc: string | null };

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// Only usable below app/w/[slug]/layout.tsx, which guarantees the workspace loaded.
export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used inside a workspace route");
  }
  return workspace;
}
