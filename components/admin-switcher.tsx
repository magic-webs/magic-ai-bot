"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

/**
 * The header of the platform sidebar: what this area is, and the way into any
 * workspace from it.
 *
 * The mirror image of WorkspaceSwitcher — that one names a company and offers
 * the platform; this one names the platform and offers the companies. Only an
 * administrator ever sees it, so the list is never empty of choices in the way
 * a company's would be.
 */
export function AdminSwitcher() {
  const { isMobile } = useSidebar();
  const workspaces = useQuery(api.workspaces.list, {});

  // Same neutral tile as the workspace sidebar: the mark is a green outline on
  // transparency, so a filled brand tile would swallow it.
  const tile = (
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-card ring-1 ring-sidebar-border">
      <Logo className="h-4 w-auto" />
    </div>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              // No `tooltip`: SidebarMenuButton answers one by rendering
              // itself through a TooltipTrigger, and the two triggers would
              // then fight over the same node — the menu is what loses.
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            {tile}
            <div className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">Magic Agent</span>
              <span className="truncate text-xs text-muted-foreground">
                Platform console
              </span>
            </div>
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="ml-auto shrink-0"
            />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* The label has to sit inside a group: DropdownMenuLabel is Base
                UI's Menu.GroupLabel and reads MenuGroupContext. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Open a workspace</DropdownMenuLabel>
              {(workspaces ?? []).map((row) => (
                <DropdownMenuItem
                  key={row._id}
                  render={<Link href={`/w/${row.slug}`} />}
                >
                  <span className="truncate">{row.name}</span>
                </DropdownMenuItem>
              ))}
              {workspaces?.length === 0 ? (
                <DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
              ) : null}
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
