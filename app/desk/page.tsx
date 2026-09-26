"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { TeamAvatar } from "@/components/team-avatar";
import { useSession } from "@/components/use-session";
import {
  ConversationDetail,
  ConversationRow,
  isUnread,
} from "@/components/conversation-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ListSkeleton } from "@/components/skeletons";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MagnifyingGlassIcon,
  SignOutIcon,
  SirenIcon,
} from "@phosphor-icons/react";

/**
 * The escalations desk — the whole of what a human agent's own login opens.
 *
 * The inbox's Escalations tab, on its own page: the same list rows, the same
 * transcript and the same reply box (components/conversation-detail.tsx), for
 * somebody who answers the threads the agents hand to a person and has no
 * business with the rest of the dashboard. Replies go out under their name,
 * and Resolve hands the thread back to the agent and off the desk.
 */

const BUCKETS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
] as const;

export default function DeskPage() {
  const me = useQuery(api.desk.me);
  const escalations = useQuery(api.desk.escalations, {});
  const { signOut } = useSession();

  const [bucket, setBucket] = useState<"all" | "unread">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Id<"conversations"> | null>(null);

  if (me === undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Opening the desk…
      </div>
    );
  }
  if (me === null) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        This login is no longer attached to a workspace.
      </div>
    );
  }

  const term = search.trim().toLowerCase();
  const matching = (escalations ?? []).filter(
    (row) =>
      !term ||
      [row.contactLabel, row.contactExternalId ?? "", row.lastMessagePreview ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term)
  );
  const counts = {
    all: matching.length,
    unread: matching.filter(isUnread).length,
  };
  const rows = bucket === "unread" ? matching.filter(isUnread) : matching;

  // Same split as the inbox: side by side there is always a thread up, but on
  // a phone "nothing picked yet" is what gives the list the whole screen.
  const chosen = selected ? rows.find((row) => row._id === selected) : undefined;
  const active = chosen ?? rows[0];

  return (
    <div className="flex h-svh min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5 sm:px-6">
        <Logo className="h-5" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-semibold">
            Escalations desk
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {me.workspace.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TeamAvatar name={me.member.name} photo={me.member.photo} size={32} />
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-sm font-medium">{me.member.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {me.member.role}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut()}
          >
            <SignOutIcon />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col border-b lg:w-92 lg:shrink-0 lg:border-b-0 lg:border-r",
            chosen ? "hidden lg:flex" : "flex"
          )}
        >
          <div
            role="tablist"
            aria-label="Filter escalations"
            className="flex shrink-0 gap-1 px-3 pt-3 pb-2"
          >
            {BUCKETS.map((option) => {
              const isActive = bucket === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={cn(
                    "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setBucket(option.value)}
                >
                  {option.label}
                  <span
                    className={cn(
                      "rounded-md px-1 py-px text-[11px] tabular-nums",
                      isActive ? "bg-primary/15" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {escalations === undefined ? "—" : counts[option.value]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative shrink-0 px-3 pb-2">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              placeholder="Search contact or message…"
              className="pl-7"
              aria-label="Search escalations"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {escalations === undefined ? (
              <div className="px-3 pb-3">
                <ListSkeleton rows={6} />
              </div>
            ) : rows.length === 0 ? (
              <div className="px-3 pb-3">
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SirenIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {escalations.length === 0 ? "Nothing escalated" : "Nothing matches"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {escalations.length === 0
                        ? "When an agent hands a conversation to a person, it lands here for you to answer."
                        : "Try a different search term or filter."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : (
              <div className="divide-y">
                {rows.map((row) => (
                  <ConversationRow
                    key={row._id}
                    row={row}
                    active={row._id === active?._id}
                    showStatus={false}
                    onSelect={() => setSelected(row._id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            chosen ? "flex" : "hidden lg:flex"
          )}
        >
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {escalations === undefined
                ? null
                : "Pick an escalation to read the thread and reply."}
            </div>
          ) : (
            <ConversationDetail
              key={active._id}
              conversationId={active._id}
              workspaceId={me.workspace._id}
              agents={me.agents}
              replyingAs={{ name: me.member.name, role: me.member.role }}
              onDeleted={() => setSelected(null)}
              onBack={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
