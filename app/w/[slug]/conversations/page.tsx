"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import {
  ConversationDetail,
  ConversationRow,
  STATUS_OPTIONS,
  isUnread,
} from "@/components/conversation-detail";
import { NewConversationDialog } from "@/components/new-conversation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ListSkeleton } from "@/components/skeletons";
import {
  ChatsIcon,
  MagnifyingGlassIcon,
  FunnelSimpleIcon,
  SirenIcon,
} from "@phosphor-icons/react";

/**
 * The four buckets across the top of the list.
 *
 * "Unread" is not a status — it is the customer having the last word, which is
 * the only one of the four that says something needs doing. It sits beside the
 * statuses because that is where somebody triaging an inbox looks for it.
 */
const BUCKETS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "unread", label: "Unread" },
  { value: "closed", label: "Closed" },
] as const;

/**
 * The two views of the inbox. Same list, same transcript, same composer —
 * Escalations is only the threads an agent has handed to a person, which are
 * the ones somebody on the team owes an answer. They stay in Conversations
 * too, badged, so the everything view still means everything.
 */
type View = "conversations" | "escalations";

// Every row on the Escalations tab is escalated, so the status buckets have
// nothing to split; only "has the customer written since" still does.
const ESCALATION_BUCKETS = BUCKETS.filter(
  (bucket) => bucket.value === "all" || bucket.value === "unread"
);

// ---------------------------------------------------------------------------

export default function ConversationsPage() {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  // ?c=<id> opens straight onto one thread — the Contacts table links here.
  // Read once, as the initial selection: after that the list owns the choice, so
  // clicking another thread is not fighting the URL.
  const params = useSearchParams();
  const requested = params.get("c");
  // ?view=escalations is the Escalations tab. Read from the URL on every
  // render rather than once, because the sidebar's Escalations row links here
  // — and clicking it while already on the inbox has to switch the tab.
  const view: View =
    params.get("view") === "escalations" ? "escalations" : "conversations";
  const router = useRouter();
  const pathname = usePathname();

  const [agentFilter, setAgentFilter] = useState("all");
  const [pickedStatus, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [handlingFilter, setHandlingFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Id<"conversations"> | null>(
    requested ? (requested as Id<"conversations">) : null
  );

  const agentId =
    agentFilter === "all" ? undefined : (agentFilter as Id<"agents">);
  const everything = useQuery(api.conversations.listByWorkspace, {
    workspaceId: workspace._id,
    agentId,
    limit: 200,
  });
  // Its own query rather than a filter over the list above: that one is the
  // newest two hundred threads, and an escalation older than those is still
  // waiting on somebody. Subscribed on both tabs, for the count on the tab.
  const escalations = useQuery(api.conversations.listByWorkspace, {
    workspaceId: workspace._id,
    agentId,
    status: "escalated",
    limit: 200,
  });
  const conversations = view === "escalations" ? escalations : everything;
  const buckets = view === "escalations" ? ESCALATION_BUCKETS : BUCKETS;
  // A status bucket picked on one tab means nothing on the other, and the tab
  // can change from the sidebar without going through switchView — so an
  // Open or Closed picked on Conversations reads as All on Escalations.
  const statusFilter =
    view === "conversations" || pickedStatus === "unread" ? pickedStatus : "all";

  const switchView = (next: View) => {
    setStatusFilter("all");
    router.replace(next === "escalations" ? `${pathname}?view=escalations` : pathname);
  };

  const term = search.trim().toLowerCase();
  // Everything but the bucket, so the counts on the buckets are counts of what
  // picking one would actually show.
  const matching = (conversations ?? []).filter((row) => {
    if (channelFilter !== "all" && row.channelType !== channelFilter) {
      return false;
    }
    if (handlingFilter === "you" && !row.humanHandling) return false;
    if (handlingFilter === "agent" && row.humanHandling) return false;
    if (!term) return true;
    return [
      row.contactLabel,
      row.contactExternalId ?? "",
      row.agentName,
      row.activeAgentName,
      row.lastMessagePreview ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  const counts = {
    all: matching.length,
    open: matching.filter((row) => row.status === "open").length,
    unread: matching.filter(isUnread).length,
    closed: matching.filter((row) => row.status === "closed").length,
  };

  const rows = matching.filter((row) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "unread") return isUnread(row);
    return row.status === statusFilter;
  });

  const narrowed = channelFilter !== "all" || handlingFilter !== "all";

  // What the reader actually picked, or nothing. Kept separate from `active`
  // because the two layouts want different answers: side by side there should
  // always be a transcript up, but on a phone "nothing picked yet" is a real
  // state — it is the one that gives the list the whole screen.
  const chosen = selected
    ? rows.find((row) => row._id === selected)
    : undefined;

  // Derived rather than stored: keeps a conversation open by default, and
  // falls back gracefully when the current selection is filtered out or deleted.
  const active = chosen ?? rows[0];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {view === "escalations" ? "Escalations" : "Conversations"}
          </h1>
          <p className="mt-1 hidden max-w-2xl text-sm text-muted-foreground sm:block">
            {view === "escalations"
              ? "Threads an agent has handed to your team. Set one back to open, or close it, once it is dealt with."
              : "Threads across WhatsApp and the web playground."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="conv-agent" className="hidden text-sm sm:inline">
            Agent
          </Label>
          <SelectField
            id="conv-agent"
            aria-label="Filter by agent"
            value={agentFilter}
            onValueChange={setAgentFilter}
            options={[
              { value: "all", label: "All agents" },
              ...(agents ?? []).map((agent) => ({
                value: agent._id as string,
                label: agent.botName,
              })),
            ]}
          />
          {/* Not on the Escalations tab, where every row has the same one. */}
          {view === "conversations" ? (
            <>
              <Label htmlFor="conv-status" className="hidden text-sm sm:inline">
                Status
              </Label>
              {/* The same state the buckets above the list write to, so the
                  two controls can never disagree about what is on screen. */}
              <SelectField
                id="conv-status"
                aria-label="Filter by status"
                value={statusFilter}
                onValueChange={setStatusFilter}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "unread", label: "unread" },
                  ...STATUS_OPTIONS,
                ]}
              />
            </>
          ) : null}
          <NewConversationDialog onStarted={setSelected} />
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* Master-detail below lg: the list owns the screen until a thread is
            picked, then hands it over, and the back button in the transcript
            header brings it back. Splitting the viewport instead — a list
            capped at 45vh above a transcript — left a phone with about 230px
            for the transcript once the page header and the thread's own header
            were paid for, which is not enough to read a conversation in. From
            lg up the two panes sit side by side exactly as before. */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col border-b lg:w-92 lg:shrink-0 lg:border-b-0 lg:border-r",
            chosen ? "hidden lg:flex" : "flex"
          )}
        >
          {/* Above the buckets: it picks the list, they narrow it. No panels —
              both tabs render the one list below. */}
          <Tabs
            value={view}
            onValueChange={(next) => switchView(next as View)}
            className="shrink-0 px-3 pt-3"
          >
            <TabsList className="w-full">
              <TabsTrigger value="conversations">
                <ChatsIcon /> Conversations
              </TabsTrigger>
              <TabsTrigger value="escalations">
                <SirenIcon /> Escalations
                {escalations?.length ? (
                  <span className="rounded-md bg-destructive/10 px-1 py-px text-[11px] text-destructive tabular-nums">
                    {escalations.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div
            role="tablist"
            aria-label="Filter conversations"
            className="flex shrink-0 gap-1 overflow-x-auto px-3 pt-2 pb-2"
          >
            {buckets.map((bucket) => {
              const isActive = statusFilter === bucket.value;
              return (
                <button
                  key={bucket.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={cn(
                    "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setStatusFilter(bucket.value)}
                >
                  {bucket.label}
                  <span
                    className={cn(
                      "rounded-md px-1 py-px text-[11px] tabular-nums",
                      isActive
                        ? "bg-primary/15"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {conversations === undefined ? "—" : counts[bucket.value]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                placeholder="Search contact or message…"
                className="pl-7"
                aria-label="Search conversations"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {/* The filters that are not worth a permanent control: most
                workspaces run one channel and never take a thread over by
                hand, so both of these are "all" almost always. The dot is
                there so a list narrowed by them never looks simply empty. */}
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    size="icon-lg"
                    variant="outline"
                    aria-label="More filters"
                    className="relative shrink-0"
                  />
                }
              >
                <FunnelSimpleIcon />
                {narrowed ? (
                  <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />
                ) : null}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="conv-channel" className="text-xs">
                    Channel
                  </Label>
                  <SelectField
                    id="conv-channel"
                    size="sm"
                    value={channelFilter}
                    onValueChange={setChannelFilter}
                    options={[
                      { value: "all", label: "Every channel" },
                      { value: "whatsapp", label: "WhatsApp" },
                      { value: "web", label: "Web playground" },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="conv-handling" className="text-xs">
                    Answered by
                  </Label>
                  <SelectField
                    id="conv-handling"
                    size="sm"
                    value={handlingFilter}
                    onValueChange={setHandlingFilter}
                    options={[
                      { value: "all", label: "Anyone" },
                      { value: "you", label: "Your team" },
                      { value: "agent", label: "The agent" },
                    ]}
                  />
                </div>
                {narrowed ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() => {
                      setChannelFilter("all");
                      setHandlingFilter("all");
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversations === undefined ? (
              <div className="px-3 pb-3">
                <ListSkeleton rows={7} />
              </div>
            ) : rows.length === 0 ? (
              <div className="px-3 pb-3">
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {view === "escalations" ? <SirenIcon /> : <ChatsIcon />}
                    </EmptyMedia>
                    <EmptyTitle>
                      {conversations.length > 0
                        ? "Nothing matches"
                        : view === "escalations"
                          ? "No escalations"
                          : "No conversations"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {conversations.length > 0
                        ? "Try a different search term or filter."
                        : view === "escalations"
                          ? "When an agent hands a conversation to your team, it waits here until somebody sets it back to open or closes it."
                          : "Test an agent in the web playground or send a WhatsApp message to a connected number."}
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
                    showStatus={view === "conversations"}
                    onSelect={() => setSelected(row._id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            chosen ? "flex" : "hidden lg:flex"
          )}
        >
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {conversations === undefined
                ? null
                : "Select a conversation to read the transcript."}
            </div>
          ) : (
            <ConversationDetail
              key={active._id}
              conversationId={active._id}
              workspaceId={workspace._id}
              agents={agents}
              onDeleted={() => setSelected(null)}
              onBack={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
