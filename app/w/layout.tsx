import { RequireAuth } from "@/components/require-auth";

// Gates every workspace route so no hook below runs before the Convex client
// holds an access token.
export default function WorkspaceAreaLayout({ children }: LayoutProps<"/w">) {
  return <RequireAuth>{children}</RequireAuth>;
}
