"use client";

import { use, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { WorkspaceTheme } from "@/components/workspace-theme";
import { useSession } from "@/components/use-session";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { SidebarUser } from "@/components/sidebar-user";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  CaretRightIcon,
  ChatsIcon,
  FunnelIcon,
  GaugeIcon,
  GearIcon,
  RobotIcon,
  WarningIcon,
} from "@phosphor-icons/react";

// Five rows where there were sixteen. Sections that hold more than one page
// are collapsed behind their own name and open themselves when you are inside
// one, so the sidebar shows where you are rather than everything there is.
const NAV: Array<{
  label: string;
  icon: typeof GaugeIcon;
  /** A section's own page, or the destination when it has no children. */
  href?: string;
  items?: Array<{ href: string; label: string }>;
}> = [
  { label: "Dashboard", icon: GaugeIcon, href: "" },
  {
    label: "Build",
    icon: RobotIcon,
    items: [
      { href: "/agents", label: "Agents" },
      { href: "/knowledge", label: "Knowledge base" },
      { href: "/products", label: "Catalogue" },
      { href: "/tools", label: "Custom tools" },
    ],
  },
  {
    label: "Inbox",
    icon: ChatsIcon,
    items: [
      { href: "/conversations", label: "Conversations" },
      { href: "/channels", label: "Channels" },
    ],
  },
  {
    // In the order the work happens: a lead becomes a contact, then an order.
    label: "Sales",
    icon: FunnelIcon,
    items: [
      { href: "/leads", label: "Leads" },
      { href: "/contacts", label: "Contacts" },
      { href: "/orders", label: "Orders" },
    ],
  },
  { label: "Settings", icon: GearIcon, href: "/settings" },
];

/**
 * One collapsible sidebar section.
 *
 * Its own component so it can hold state: `defaultOpen` is read once at mount,
 * and these sections never unmount, so a section would stay shut when you
 * arrived inside it from a link elsewhere — the dashboard's setup rows go
 * straight to Agents and Channels.
 *
 * Open is therefore derived from the path, with a manual toggle that only
 * holds while you stay on that path. Written this way rather than as an effect
 * that opens the section, because setting state from an effect is what
 * `react-hooks/set-state-in-effect` forbids — and an effect would also fight
 * the reader every time it re-ran.
 */
function NavSection({
  label,
  icon: Icon,
  items,
  base,
  pathname,
}: {
  label: string;
  icon: typeof GaugeIcon;
  items: Array<{ href: string; label: string }>;
  base: string;
  pathname: string;
}) {
  const [manual, setManual] = useState<{ path: string; open: boolean } | null>(
    null
  );

  const holdsCurrent = items.some((item) =>
    pathname.startsWith(`${base}${item.href}`)
  );
  const open =
    manual && manual.path === pathname ? manual.open : holdsCurrent;

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setManual({ path: pathname, open: next })}
    >
      <SidebarMenuItem>
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              tooltip={label}
              // Marked active while closed too, so a shut section still shows
              // where you are.
              isActive={holdsCurrent}
              className="group/section"
            />
          }
        >
          <Icon />
          <span>{label}</span>
          <CaretRightIcon className="ml-auto transition-transform duration-200 group-data-panel-open/section:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => {
              const href = `${base}${item.href}`;
              return (
                <SidebarMenuSubItem key={item.href}>
                  <SidebarMenuSubButton
                    isActive={pathname.startsWith(href)}
                    render={<Link href={href} />}
                  >
                    <span>{item.label}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export default function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/w/[slug]">) {
  const { slug } = use(params);
  const pathname = usePathname();
  const session = useSession();
  // A company may only ever load its own workspace; skip the query rather than
  // firing one the server will refuse.
  const allowed =
    session.me?.role === "admin" || session.me?.workspaceSlug === slug;
  const workspace = useQuery(
    api.workspaces.getBySlug,
    allowed ? { slug } : "skip"
  );

  if (session.me && !allowed) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarningIcon />
            </EmptyMedia>
            <EmptyTitle>Not your workspace</EmptyTitle>
            <EmptyDescription>
              Your sign-in only grants access to{" "}
              <span className="font-mono">
                {session.me.workspaceSlug ?? "another workspace"}
              </span>
              .
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (workspace === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading workspace…
      </div>
    );
  }

  if (workspace === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarningIcon />
            </EmptyMedia>
            <EmptyTitle>Workspace not found</EmptyTitle>
            <EmptyDescription>
              No workspace exists at <span className="font-mono">/{slug}</span>.{" "}
              {/* Signs out rather than linking to /login: the session itself is
                  valid, so proxy.ts would send it straight back here. */}
              <button
                type="button"
                className="underline"
                onClick={() => void session.signOut()}
              >
                Sign in again
              </button>
              .
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const base = `/w/${workspace.slug}`;

  return (
    <WorkspaceProvider workspace={workspace}>
      <WorkspaceTheme theme={workspace.theme} />
      {/* The shell is pinned to the viewport so pages can own their own
          scrolling — without a hard height here, `flex-1` has nothing to
          resolve against and the chat playground's message list grows
          instead of scrolling. */}
      <SidebarProvider className="h-svh overflow-hidden">
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <WorkspaceSwitcher
              workspace={workspace}
              isAdmin={session.isAdmin}
            />
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map((section) => {
                    const Icon = section.icon;

                    // A leaf: Dashboard and Settings have no children, so they
                    // stay ordinary rows rather than sections that open onto
                    // one item.
                    if (!section.items) {
                      const href = `${base}${section.href ?? ""}`;
                      const isActive =
                        section.href === ""
                          ? pathname === base
                          : pathname.startsWith(href);
                      return (
                        <SidebarMenuItem key={section.label}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={section.label}
                            render={<Link href={href} />}
                          >
                            <Icon />
                            <span>{section.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    }

                    return (
                      <NavSection
                        key={section.label}
                        label={section.label}
                        icon={Icon}
                        items={section.items}
                        base={base}
                        pathname={pathname}
                      />
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarUser settingsHref={`${base}/settings`} />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          {/* Just the toggle. The name was already in the sidebar header a
              few pixels away, and every page below writes its own heading, so
              this bar was saying everything twice. Currency and locale moved
              to Settings, where they are edited. */}
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger />
          </header>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
