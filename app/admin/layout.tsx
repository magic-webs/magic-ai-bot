import { RequireAuth } from "@/components/require-auth";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <RequireAuth>{children}</RequireAuth>;
}
