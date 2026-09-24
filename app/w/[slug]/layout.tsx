"use client";

import { use, useMemo, useState } from "react";
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
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight01Icon,
  Building06Icon,
  ChartUpIcon,
  ConnectIcon,
  DashboardSpeed02Icon,
  Folder01Icon,
  FolderLibraryIcon,
  FunnelIcon,
  InboxIcon,
  LibraryIcon,
  Megaphone01Icon,
  Package01Icon,
  ReceiptIcon,
  Robot01Icon,
  Settings01Icon,
  ToolboxIcon,
  UserGroupIcon,
  UserMultipleIcon,
  WhatsappIcon,
  WorkflowSquare01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

type NavItem = {
  href: string;
  label: string;
  icon: IconSvgElement;
  /**
   * Active only on the row's own path, not on anything below it. Needed where
   * one section owns a page and another owns its children: Build links
   * `/records`, the book rows under Leads link `/records/<id>`, and without
   * this both sections would light up on a book page.
   */
  exact?: boolean;
};

// Eight rows where there were sixteen. Sections that hold more than one page
// are collapsed behind their own name and open themselves when you are inside
// one, so the sidebar shows where you are rather than everything there is.
const NAV: Array<{
  label: string;
  icon: IconSvgElement;
  /** A section's own page, or the destination when it has no children. */
  href?: string;
  items?: NavItem[];
}> = [
  { label: "Dashboard", icon: DashboardSpeed02Icon, href: "" },
  // A row of its own rather than a child of Build: it is the whole roster,
  // agents and people on one page, and "who answers for us" is a question you
  // should not have to open a section to ask. Build keeps the agent editors.
  { label: "Team", icon: UserGroupIcon, href: "/team" },
  {
    // A section's own icon is never one of its children's: with the section
    // open the two sit a row apart, and the same glyph twice reads as a
    // mistake rather than a grouping.
    label: "Build",
    icon: ToolboxIcon,
    // Everything you set up before a conversation can happen, in the order it
    // has to exist: what the agents answer from, the shelves they file onto,
    // the agents themselves, then where customers reach them. Record books
    // and channels are defined here and read elsewhere — a book's filed
    // records show under Leads, its conversations under Inbox.
    items: [
      { href: "/company", label: "Company profile", icon: Building06Icon },
      { href: "/knowledge", label: "Knowledge base", icon: LibraryIcon },
      { href: "/products", label: "Catalogue", icon: Package01Icon },
      // Exact: the books themselves live under Leads, on /records/<id>.
      {
        href: "/records",
        label: "Record books",
        icon: FolderLibraryIcon,
        exact: true,
      },
      { href: "/agents", label: "Agents", icon: Robot01Icon },
      { href: "/agent-config", label: "Agent map", icon: WorkflowSquare01Icon },
      { href: "/tools", label: "Custom tools", icon: Wrench01Icon },
      { href: "/channels", label: "Channels", icon: WhatsappIcon },
    ],
  },
  // A leaf now that channels are set up under Build: a section that opens onto
  // one child is a row with an extra click in front of it.
  { label: "Inbox", icon: InboxIcon, href: "/conversations" },
  {
    // In the order the work happens: a lead becomes a contact, then an order —
    // and then whatever else the conversation produced. Each record book the
    // workspace has defined is appended to this list at render, so filing a
    // new kind of thing puts it on the sidebar under its own name.
    label: "Leads",
    icon: ChartUpIcon,
    items: [
      { href: "/leads", label: "Stages", icon: FunnelIcon },
      { href: "/contacts", label: "Contacts", icon: UserMultipleIcon },
      { href: "/orders", label: "Orders", icon: ReceiptIcon },
    ],
  },
  // After Leads: the customers a workspace has collected are who it markets
  // to, and the page is a calendar of what goes out to them — birthdays and
  // festivals — rather than anything set up before a conversation.
  { label: "Marketing", icon: Megaphone01Icon, href: "/marketing" },
  // Between the work and the settings: connecting Sheets or a calendar is
  // something you do once you have agents to give it to, and it is not a
  // setting — it changes what the agents can do.
  { label: "Integrations", icon: ConnectIcon, href: "/integrations" },
  { label: "Settings", icon: Settings01Icon, href: "/settings" },
];

/** Whether `pathname` is the row's page, or — unless `exact` — one below it. */
function isOn(pathname: string, base: string, item: NavItem): boolean {
  const href = `${base}${item.href}`;
  return item.exact ? pathname === href : pathname.startsWith(href);
}

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
  icon,
  items,
  base,
  pathname,
}: {
  label: string;
  icon: IconSvgElement;
  items: NavItem[];
  base: string;
  pathname: string;
}) {
  const [manual, setManual] = useState<{ path: string; open: boolean } | null>(
    null
  );

  const holdsCurrent = items.some((item) => isOn(pathname, base, item));
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
          <HugeiconsIcon icon={icon} strokeWidth={2} />
          <span>{label}</span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="ml-auto transition-transform duration-200 group-data-panel-open/section:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => {
              const href = `${base}${item.href}`;
              return (
                <SidebarMenuSubItem key={item.href}>
                  <SidebarMenuSubButton
                    isActive={isOn(pathname, base, item)}
                    render={<Link href={href} />}
                  >
                    {/* SidebarMenuSubButton already sizes a direct svg child,
                        so the icon needs no class of its own. */}
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} />
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

  // Every record book the workspace keeps, as its own row under Leads. A book
  // is a shelf this company invented — Memberships, Site visits — so the only
  // honest label for it is the name they gave it, which means the nav cannot
  // be a constant. Names only: `listBookLinks` skips the per-book record count
  // that the Record books page reads, since the sidebar renders everywhere.
  const books = useQuery(
    api.records.listBookLinks,
    workspace ? { workspaceId: workspace._id } : "skip"
  );

  const nav = useMemo(() => {
    if (!books?.length) return NAV;
    // Plural, because the row leads to the table of them, not to one.
    const rows: NavItem[] = books.map((book) => ({
      href: `/records/${book._id}`,
      label: book.pluralName,
      icon: Folder01Icon,
    }));
    return NAV.map((section) =>
      section.label === "Leads"
        ? { ...section, items: [...(section.items ?? []), ...rows] }
        : section
    );
  }, [books]);

  if (session.me && !allowed) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
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
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
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
                  {nav.map((section) => {
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
                            <HugeiconsIcon
                              icon={section.icon}
                              strokeWidth={2}
                            />
                            <span>{section.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    }

                    return (
                      <NavSection
                        key={section.label}
                        label={section.label}
                        icon={section.icon}
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
