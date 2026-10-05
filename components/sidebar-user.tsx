"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CompanyLogo } from "@/components/company-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSession } from "@/components/use-session";
import { setAppearance, useAppearance } from "@/components/appearance";
import { APPEARANCES, isAppearance, type Appearance } from "@/lib/appearance";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Building03Icon,
  ComputerIcon,
  Logout01Icon,
  Moon02Icon,
  Settings01Icon,
  Sun03Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

const APPEARANCE_ICONS: Record<Appearance, typeof Sun03Icon> = {
  light: Sun03Icon,
  dark: Moon02Icon,
  system: ComputerIcon,
};

/** Two letters for the avatar: initials where there are two words, else one. */
function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

/**
 * Who is signed in, and everything that used to sit in the sidebar as its own
 * row — settings, the way back to the platform, signing out — plus light and
 * dark, which is each person's own and so belongs here rather than in settings.
 *
 * Folding them into this menu is most of the text the sidebar no longer
 * spends: three permanent rows become one, and the two that only an
 * administrator can use stop taking up space for everyone else.
 */
export function SidebarUser({
  settingsHref,
  settingsLabel = "Workspace settings",
  showPlatformLink = true,
}: {
  settingsHref: string;
  /** The platform console names its own settings; a workspace names theirs. */
  settingsLabel?: string;
  /** Off inside /admin, where "All workspaces" would point at the page you
      are already on. */
  showPlatformLink?: boolean;
}) {
  const { isMobile } = useSidebar();
  const session = useSession();
  const appearance = useAppearance();

  const isUser = session.me?.role === "user";
  const workspaces = useQuery(api.users.myWorkspaces, isUser ? {} : "skip");
  const segments = usePathname().split("/").filter(Boolean);
  const currentSlug = segments[0] === "w" ? segments[1] : undefined;
  const section = segments[0] === "w" && segments[2] ? `/${segments[2]}` : "";

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
                  {session.isAdmin
                    ? "Administrator"
                    : session.isStaff
                      ? "Team member"
                      : isUser
                        ? "User"
                        : "Workspace"}
                </span>
              )}
            </div>
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="ml-auto shrink-0"
            />
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
              <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
              {settingsLabel}
            </DropdownMenuItem>
            {session.isStaff && showPlatformLink ? (
              <DropdownMenuItem render={<Link href="/admin/workspaces" />}>
                <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
                All workspaces
              </DropdownMenuItem>
            ) : null}
            {isUser && (workspaces?.length ?? 0) > 1 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
                  Switch workspace
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52">
                  {(workspaces ?? []).map((workspace) => (
                    <DropdownMenuItem
                      key={workspace._id}
                      render={<Link href={`/w/${workspace.slug}${section}`} />}
                    >
                      <CompanyLogo src={workspace.logoSrc} className="size-5 rounded-md" />
                      <span className="truncate">{workspace.name}</span>
                      {workspace.slug === currentSlug ? (
                        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="ml-auto" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <HugeiconsIcon
                  icon={APPEARANCE_ICONS[appearance]}
                  strokeWidth={2}
                />
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-36">
                <DropdownMenuRadioGroup
                  value={appearance}
                  onValueChange={(value) => {
                    if (isAppearance(value)) setAppearance(value);
                  }}
                >
                  {APPEARANCES.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <HugeiconsIcon
                        icon={APPEARANCE_ICONS[option.value]}
                        strokeWidth={2}
                      />
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void session.signOut()}
            >
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
