"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WorkspaceProvider } from "@/components/workspace-provider";
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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  GaugeIcon,
  RobotIcon,
  BooksIcon,
  PackageIcon,
  ReceiptIcon,
  WrenchIcon,
  WhatsappLogoIcon,
  ChatsIcon,
  GearIcon,
  ArrowLeftIcon,
  WarningIcon,
} from "@phosphor-icons/react";

const NAV = [
  { group: "Overview", items: [{ href: "", label: "Dashboard", icon: GaugeIcon }] },
  {
    group: "Build",
    items: [
      { href: "/agents", label: "Agents", icon: RobotIcon },
      { href: "/knowledge", label: "Knowledge base", icon: BooksIcon },
      { href: "/tools", label: "Custom tools", icon: WrenchIcon },
    ],
  },
  {
    group: "Business data",
    items: [
      { href: "/products", label: "Catalogue", icon: PackageIcon },
      { href: "/orders", label: "Orders", icon: ReceiptIcon },
    ],
  },
  {
    group: "Live",
    items: [
      { href: "/channels", label: "Channels", icon: WhatsappLogoIcon },
      { href: "/conversations", label: "Conversations", icon: ChatsIcon },
    ],
  },
  {
    group: "Workspace",
    items: [{ href: "/settings", label: "Settings", icon: GearIcon }],
  },
];

export default function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/w/[slug]">) {
  const { slug } = use(params);
  const pathname = usePathname();
  const workspace = useQuery(api.workspaces.getBySlug, { slug });

  if (workspace === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
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
              <Link href="/" className="underline">
                Back to all workspaces
              </Link>
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
      {/* The shell is pinned to the viewport so pages can own their own
          scrolling — without a hard height here, `flex-1` has nothing to
          resolve against and the chat playground's message list grows
          instead of scrolling. */}
      <SidebarProvider className="h-svh overflow-hidden">
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  tooltip={workspace.name}
                  render={<Link href={base} />}
                >
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <RobotIcon className="size-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {workspace.name}
                    </span>
                    <span className="truncate text-[0.625rem] text-muted-foreground">
                      {workspace.industry ?? workspace.locale}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            {NAV.map((section) => (
              <SidebarGroup key={section.group}>
                <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const href = `${base}${item.href}`;
                      const isActive =
                        item.href === ""
                          ? pathname === base
                          : pathname.startsWith(href);
                      const Icon = item.icon;
                      return (
                        <SidebarMenuItem key={item.label}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={item.label}
                            render={<Link href={href} />}
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="All workspaces"
                  render={<Link href="/" />}
                >
                  <ArrowLeftIcon />
                  <span>All workspaces</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="truncate text-xs font-medium">
              {workspace.name}
            </span>
            <Badge variant="secondary" className="font-mono text-[0.625rem]">
              {workspace.currency} · {workspace.locale}
            </Badge>
          </header>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
