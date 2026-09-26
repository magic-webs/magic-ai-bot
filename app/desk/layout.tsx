import { RequireAuth } from "@/components/require-auth";

// Same gate as the workspace area: nothing below runs a query before the
// Convex client holds the human agent's access token.
export default function DeskLayout({ children }: LayoutProps<"/desk">) {
  return <RequireAuth>{children}</RequireAuth>;
}
