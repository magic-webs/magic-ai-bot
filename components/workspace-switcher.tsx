"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Logo } from "@/components/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Building03Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

/**
 * The workspace this sidebar belongs to, and — for an administrator — the way
 * to any other.
 *
 * The caret and the menu appear only when there is somewhere to switch to. A
 * company has exactly one workspace, so for them this is a plain link home:
 * a switcher offering a single choice is a control that does nothing.
 */
export function WorkspaceSwitcher({
  workspace,
  isAdmin,
}: {
  workspace: Doc<"workspaces">;
  isAdmin: boolean;
}) {
  const { isMobile } = useSidebar();
  // Admin-only query, so it is skipped rather than refused for a company.
  const workspaces = useQuery(api.workspaces.list, isAdmin ? {} : "skip");
  const pathname = usePathname();

  /**
   * Which page of the console to open in the workspace being switched to.
   *
   * Switching company is a change of subject, not of task: somebody comparing
   * two catalogues wants the other catalogue, and being dropped on the
   * dashboard every time means navigating back to the same page on every
   * switch. So the section carries across.
   *
   * Only the section — `/w/<slug>/products`, never `/w/<slug>/agents/<id>`.
   * Everything below it names a record, and a record id from one workspace
   * resolves to nothing in another. Nothing dynamic sits at this depth, so
   * the first segment after the slug is always a real page.
   */
  const segments = pathname.split("/").filter(Boolean);
  const section =
    segments[0] === "w" && segments[2] ? `/${segments[2]}` : "";

  // A neutral tile, not the brand one the shadcn reference uses: the mark is
  // a green outline on transparency and `bg-sidebar-primary` is that same
  // green, so the reference's filled tile would have swallowed it — the point
  // components/logo.tsx makes about the tiles it replaced. Sized by height,
  // as that component asks, so the artwork keeps its ratio.
  const tile = (
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-card ring-1 ring-sidebar-border">
      <Logo className="h-4 w-auto" />
    </div>
  );
  const subtitle = workspace.industry ?? workspace.locale;
  const identity = (
    // min-w-0 is what lets the truncation actually happen: a grid child's
    // default min-width is auto, so without it the long industry line pushes
    // the caret off the end instead of ellipsing.
    <div className="grid min-w-0 flex-1 text-left leading-tight">
      <span className="truncate text-sm font-medium">{workspace.name}</span>
      {/* Titled, because an industry like "Influencer marketing platform" does
          not fit a 16rem sidebar and the ellipsis alone hides which one. */}
      <span className="truncate text-xs text-muted-foreground" title={subtitle}>
        {subtitle}
      </span>
    </div>
  );

  if (!isAdmin) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip={workspace.name}
            render={<Link href={`/w/${workspace.slug}`} />}
          >
            {tile}
            {identity}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                // No `tooltip` here on purpose, and none in shadcn's own
                // snippet either. SidebarMenuButton answers a tooltip by
                // returning a Tooltip root that renders the button through a
                // TooltipTrigger — so this menu trigger and that tooltip
                // trigger would both be claiming the same DOM node, and the
                // menu's click handler and anchor are what get dropped. The
                // menu names the workspace itself once open.
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            {tile}
            {identity}
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="ml-auto shrink-0"
            />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56"
            align="start"
            // Beside the sidebar on a desktop, below the trigger on a phone
            // where there is no room to the right of it.
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* The label has to be inside a group: DropdownMenuLabel is
                Base UI's Menu.GroupLabel, which reads MenuGroupContext and
                throws without one. It is not the free-standing heading the
                Radix component of the same name is. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {(workspaces ?? []).map((row) => (
                <DropdownMenuItem
                  key={row._id}
                  render={<Link href={`/w/${row.slug}${section}`} />}
                >
                  <span className="truncate">{row.name}</span>
                  {row.slug === workspace.slug ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      strokeWidth={2}
                      className="ml-auto"
                    />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/admin/workspaces" />}>
              <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
              All workspaces
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
