"use client";

import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSession } from "@/components/use-session";
import {
  CaretUpDownIcon,
  GearIcon,
  BuildingsIcon,
  SignOutIcon,
} from "@phosphor-icons/react";

/** Two letters for the avatar: initials where there are two words, else one. */
function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

/**
 * Who is signed in, and everything that used to sit in the sidebar as its own
 * row — settings, the way back to the platform, signing out.
 *
 * Folding them into this menu is most of the text the sidebar no longer
 * spends: three permanent rows become one, and the two that only an
 * administrator can use stop taking up space for everyone else.
 */
export function SidebarUser({ settingsHref }: { settingsHref: string }) {
  const { isMobile } = useSidebar();
  const session = useSession();

  const label = session.me?.label ?? "Signed in";
  const email = session.me?.email;
  const initials = initialsOf(label);

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
                // menu repeats the name and address at the top, so nothing is lost.
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="size-8 shrink-0 rounded-lg">
              <AvatarFallback className="rounded-lg text-xs font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{label}</span>
              {email ? (
                <span className="truncate text-xs text-muted-foreground">
                  {email}
                </span>
              ) : (
                <span className="truncate text-xs text-muted-foreground">
                  {session.isAdmin ? "Administrator" : "Workspace"}
                </span>
              )}
            </div>
            <CaretUpDownIcon className="ml-auto shrink-0" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56"
            align="end"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* Repeated inside the menu, as the reference does: in icon mode
                the trigger shows only the avatar, so this is the only place
                the name and address are legible. */}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Avatar className="size-8 shrink-0 rounded-lg">
                <AvatarFallback className="rounded-lg text-xs font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{label}</span>
                {email ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {email}
                  </span>
                ) : null}
              </div>
            </div>

            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={settingsHref} />}>
              <GearIcon />
              Workspace settings
            </DropdownMenuItem>
            {session.isAdmin ? (
              <DropdownMenuItem render={<Link href="/admin" />}>
                <BuildingsIcon />
                All workspaces
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void session.signOut()}
            >
              <SignOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
