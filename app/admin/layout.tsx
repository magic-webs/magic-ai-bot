"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AiBrain01Icon,
  Building03Icon,
  Coins01Icon,
  CreditCardIcon,
  DashboardSpeed02Icon,
  Invoice01Icon,
  Key01Icon,
  PlugSocketIcon,
  Tag01Icon,
  UserAccountIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

// The platform's own sections, in the order an operator meets them: what the
// estate is doing, the tenants themselves, the connector each of them hands to
// an assistant, the models they all run on, what it costs, what it charges,
// and who may sign in.
//
// Flat rows rather than the workspace sidebar's collapsible sections — ten
// destinations still read as one list, and a section that opens onto one item
// is a control that does nothing.
//
// Models sits next to Tokens & cost because it is the other half of the same
// question: the catalogue sets the price, that page reports what it came to.
// Those two are what the platform pays; the three after them are what it
// charges. Plans & pricing sets the monthly fee, Subscriptions is who pays it
// and how, and Message billing is what each account pays per WhatsApp
// message out of its wallet.
const NAV: Array<{
  href: string;
  label: string;
  icon: IconSvgElement;
  team?: boolean;
}> = [
  { href: "", label: "Overview", icon: DashboardSpeed02Icon },
  { href: "/workspaces", label: "Workspaces", icon: Building03Icon, team: true },
  { href: "/mcp", label: "MCP connector", icon: PlugSocketIcon },
  { href: "/models", label: "AI models", icon: AiBrain01Icon },
  { href: "/usage", label: "Tokens & cost", icon: Coins01Icon },
  { href: "/plans", label: "Plans & pricing", icon: Tag01Icon },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCardIcon },
  { href: "/billing", label: "Message billing", icon: Invoice01Icon },
  { href: "/users", label: "Users", icon: UserAccountIcon },
  { href: "/team", label: "Team", icon: UserGroupIcon },
  { href: "/access", label: "Access", icon: Key01Icon, team: true },
];

function teamMayOpen(pathname: string): boolean {
  return NAV.some(
    (item) => item.team && pathname.startsWith(`/admin${item.href}`)
  );
}

/**
 * The platform shell.
 *
 * The administrator check lives here rather than on each page: every route
 * below it is admin-only, and the Convex guards refuse the queries anyway, so
 * one gate above the sidebar is both the smaller code and the earlier answer.
 */
function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const blocked = session.isStaff && !session.isAdmin && !teamMayOpen(pathname);

  useEffect(() => {
    if (blocked) router.replace("/admin/workspaces");
  }, [blocked, router]);

  if (session.isLoading || blocked) return <AdminShellSkeleton />;

  if (!session.isStaff) {
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
                {NAV.filter((item) => session.isAdmin || item.team).map((item) => {
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
            settingsLabel="Access & two-factor"
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

const NAV_SKELETON_WIDTHS = ["w-20", "w-24", "w-28", "w-20", "w-24", "w-28", "w-24", "w-20", "w-16", "w-14", "w-16"];

/** The shell with placeholders, so the first paint is the page's shape. */
function AdminShellSkeleton() {
  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 p-2">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_SKELETON_WIDTHS.map((width, i) => (
                  <SidebarMenuItem key={i}>
                    <div className="flex h-8 items-center gap-2 px-2">
                      <Skeleton className="size-4 shrink-0 rounded-md" />
                      <Skeleton
                        className={`h-3.5 ${width} group-data-[collapsible=icon]:hidden`}
                      />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 p-2">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6">
          <PageHeaderSkeleton />
          <TableSkeleton rows={6} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <RequireAuth fallback={<AdminShellSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </RequireAuth>
  );
}
