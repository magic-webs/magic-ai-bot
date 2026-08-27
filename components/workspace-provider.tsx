"use client";

import { createContext, useContext } from "react";
import type { Doc } from "@/convex/_generated/dataModel";

const WorkspaceContext = createContext<Doc<"workspaces"> | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Doc<"workspaces">;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// Only usable below app/w/[slug]/layout.tsx, which guarantees the workspace loaded.
export function useWorkspace(): Doc<"workspaces"> {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used inside a workspace route");
  }
  return workspace;
}
