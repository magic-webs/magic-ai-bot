"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminSwitcher } from "@/components/admin-switcher";
import { RequireAuth } from "@/components/require-auth";
import { SidebarUser } from "@/components/sidebar-user";
import { useSession } from "@/components/use-session";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Building03Icon,
  Coins01Icon,
  DashboardSpeed02Icon,
  Key01Icon,
  PlugSocketIcon,
} from "@hugeicons/core-free-icons";

// The platform's own sections, in the order an operator meets them: what the
// estate is doing, the tenants themselves, the connector each of them hands to
// an assistant, what it all costs, and who may sign in.
//
// Flat rows rather than the workspace sidebar's collapsible sections — five
// destinations do not need grouping, and a section that opens onto one item is
// a control that does nothing.
const NAV: Array<{ href: string; label: string; icon: IconSvgElement }> = [
  { href: "", label: "Overview", icon: DashboardSpeed02Icon },
  { href: "/workspaces", label: "Workspaces", icon: Building03Icon },
  { href: "/mcp", label: "MCP connector", icon: PlugSocketIcon },
  { href: "/usage", label: "Tokens & cost", icon: Coins01Icon },
  { href: "/access", label: "Access", icon: Key01Icon },
];

/**
 * The platform shell.
 *
 * The administrator check lives here rather than on each page: every route
 * below it is admin-only, and the Convex guards refuse the queries anyway, so
 * one gate above the sidebar is both the smaller code and the earlier answer.
 */
function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();

  if (session.isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    );
  }

  if (!session.isAdmin) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>This area is for administrators</EmptyTitle>
            <EmptyDescription>
              You are signed in to a single workspace. Open it to manage its
              agents, knowledge and channels.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex gap-2">
              {session.me?.workspaceSlug ? (
                <Button
                  nativeButton={false}
                  render={<Link href={`/w/${session.me.workspaceSlug}`} />}
                >
                  Open my workspace
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void session.signOut()}>
                Sign out
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    // Pinned to the viewport, as the workspace shell is, so each page owns its
    // own scrolling instead of growing the document.
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <AdminSwitcher />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => {
                  const href = `/admin${item.href}`;
                  // Overview is the area's own page, so it matches exactly —
                  // a prefix test would light it up on every route below it.
                  const isActive =
                    item.href === ""
                      ? pathname === "/admin"
                      : pathname.startsWith(href);
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={<Link href={href} />}
                      >
                        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {/* No platform link in the menu: this is the platform. */}
          <SidebarUser
            settingsHref="/admin/access"
            settingsLabel="Access & administrators"
            showPlatformLink={false}
          />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <RequireAuth>
      <AdminShell>{children}</AdminShell>
    </RequireAuth>
  );
}
