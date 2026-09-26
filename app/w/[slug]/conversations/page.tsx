"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { TranscriptView } from "@/components/transcript";
import { ManualReply } from "@/components/manual-reply";
import { ContactAvatar } from "@/components/contact-avatar";
import { NewConversationDialog } from "@/components/new-conversation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import { ListSkeleton } from "@/components/skeletons";
import { HandbackCountdown } from "@/components/handback-timer";
import {
  ChatsIcon,
  WhatsappLogoIcon,
  GlobeIcon,
  TrashIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  FunnelSimpleIcon,
  EnvelopeIcon,
  PhoneIcon,
  BuildingsIcon,
  UserIcon,
  RobotIcon,
  ClockIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  DeviceMobileIcon,
  CheckIcon,
  ArrowsSplitIcon,
  SirenIcon,
} from "@phosphor-icons/react";

type Status = "open" | "escalated" | "closed";

const STATUS_OPTIONS = [
  { value: "open", label: "open" },
  { value: "escalated", label: "escalated" },
  { value: "closed", label: "closed" },
];

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

// Auto-generated web session ids are noise in a list; show something readable.
function displayContact(row: {
  contactLabel: string;
  channelType: "whatsapp" | "web";
}): string {
  if (row.channelType === "web" && /^web-[a-z0-9]+$/i.test(row.contactLabel)) {
    return `Web visitor ${row.contactLabel.slice(-4)}`;
  }
  return row.contactLabel;
}

function relative(timestamp: number): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

/**
 * The same thing, short enough to sit at the end of a row without pushing the
 * name out of it. "about 21 hours ago" is three words of padding when the
 * column it lives in is four characters wide.
 */
function shortAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function statusVariant(status: Status) {
  return status === "escalated"
    ? "destructive"
    : status === "closed"
      ? "secondary"
      : "default";
}

// ---------------------------------------------------------------------------
// Detail pane — contact facts plus the shared transcript reader.
// ---------------------------------------------------------------------------

function ConversationDetail({
  conversationId,
  onDeleted,
  onBack,
}: {
  conversationId: Id<"conversations">;
  onDeleted: () => void;
  /** Below lg the transcript is the whole screen; this is the way back to the list. */
  onBack: () => void;
}) {
  const detail = useQuery(api.conversations.getWithContact, { conversationId });
  const messages = useQuery(api.conversations.listMessages, { conversationId });
  // For the face and name on each reply. A thread that was handed over has
  // messages from two agents in it, and the transcript is the only place that
  // can say which of them said what.
  const workspace = useWorkspace();
  const threadAgents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const setStatus = useMutation(api.conversations.setStatus);
  const setHumanHandling = useMutation(api.conversations.setHumanHandling);
  const removeConversation = useMutation(api.conversations.remove);
  const [showTools, setShowTools] = useState(true);
  // Held here rather than inside the actions menu: the menu unmounts as soon
  // as an item is picked, and a confirmation that unmounts with the thing that
  // opened it never appears.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (detail === undefined) {
    return (
      <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading conversation…
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        This conversation no longer exists.
      </div>
    );
  }

  const { conversation, contact, agent } = detail;
  const rawLabel =
    contact?.name ?? contact?.phone ?? contact?.externalId ?? "Unknown";
  const label = displayContact({
    contactLabel: rawLabel,
    channelType: conversation.channelType,
  });

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        {/* Hidden from lg up, where the list is still on screen beside the
            transcript and going "back" would mean nothing. */}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to all conversations"
          className="-ml-1 shrink-0 lg:hidden"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>

        <ContactAvatar
          label={rawLabel}
          channelType={conversation.channelType}
          size={40}
          className="hidden sm:inline-flex"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate font-heading text-base font-semibold tracking-tight">
              {label}
            </h2>
            <Badge variant={statusVariant(conversation.status)}>
              {conversation.status}
            </Badge>
            {/* Only while a person holds the thread. Nothing is shown in the
                ordinary case, which is the agent answering. */}
            {conversation.humanHandling ? (
              <Badge variant="outline" className="gap-1">
                <UserIcon className="size-3" />
                You have this thread
                {/* The hold expires, and a colleague who cannot see the clock
                    finds out when the agent answers over the top of them. */}
                <HandbackCountdown
                  humanHandlingAt={conversation.humanHandlingAt}
                />
              </Badge>
            ) : null}
          </div>

          {/* Three facts, and only three. Everything else the agent learned
              about this person is a click away under the contact button —
              a header that grows with the record pushes the conversation off
              the screen it is supposed to be about. */}
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {conversation.channelType === "whatsapp" ? (
                <WhatsappLogoIcon className="size-3.5 shrink-0" />
              ) : (
                <GlobeIcon className="size-3.5 shrink-0" />
              )}
              {contact?.phone ? (
                <span className="font-mono">{contact.phone}</span>
              ) : (
                <span>Web playground</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <ClockIcon className="size-3.5 shrink-0" />
              Last activity {relative(conversation.lastMessageAt)}
            </span>
            {contact?.externalId && contact.externalId !== contact.phone ? (
              <span className="hidden items-center gap-1 md:flex">
                <DeviceMobileIcon className="size-3.5 shrink-0" />
                <span className="truncate font-mono opacity-70">
                  {contact.externalId}
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* How this thread got here: when it started, how far it has run,
              who has held it. Facts about the conversation rather than about
              the person, which is the button next door. */}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label="Thread history"
                />
              }
            >
              <ClockCounterClockwiseIcon />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                This thread
              </p>
              <dl className="flex flex-col gap-1.5 text-xs">
                <Fact term="Started">
                  {new Date(conversation.createdAt).toLocaleString()}
                </Fact>
                <Fact term="Last activity">
                  {relative(conversation.lastMessageAt)}
                </Fact>
                <Fact term="Messages">{conversation.messageCount}</Fact>
                <Fact term="Channel">
                  {conversation.channelType === "whatsapp"
                    ? "WhatsApp"
                    : "Web playground"}
                </Fact>
                <Fact term="Arrived at">{agent?.botName ?? "— deleted —"}</Fact>
                {conversation.handoffCount ? (
                  <Fact term="Handovers">
                    <span className="flex items-center gap-1">
                      <ArrowsSplitIcon className="size-3" />
                      {conversation.handoffCount}
                    </span>
                  </Fact>
                ) : null}
                {conversation.followUpCount ? (
                  <Fact term="Nudges sent">{conversation.followUpCount}</Fact>
                ) : null}
              </dl>
              {conversation.leadStageNote ? (
                <p className="border-t pt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Lead note ·{" "}
                  </span>
                  {conversation.leadStageNote}
                </p>
              ) : null}
            </PopoverContent>
          </Popover>

          {/* Everything the agent has learned about the person. */}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label="Contact details"
                />
              }
            >
              <UserIcon />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="flex items-center gap-2.5">
                <ContactAvatar
                  label={rawLabel}
                  channelType={conversation.channelType}
                  size={36}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Held by {agent?.botName ?? "— deleted —"}
                  </p>
                </div>
              </div>
              <dl className="flex flex-col gap-1.5 text-xs">
                {contact?.phone ? (
                  <Fact term={<PhoneIcon className="size-3.5" />}>
                    <span className="font-mono">{contact.phone}</span>
                  </Fact>
                ) : null}
                {contact?.email ? (
                  <Fact term={<EnvelopeIcon className="size-3.5" />}>
                    <span className="font-mono break-all">{contact.email}</span>
                  </Fact>
                ) : null}
                {contact?.company ? (
                  <Fact term={<BuildingsIcon className="size-3.5" />}>
                    {contact.company}
                  </Fact>
                ) : null}
                {contact?.externalId ? (
                  <Fact term={<DeviceMobileIcon className="size-3.5" />}>
                    <span className="font-mono break-all opacity-70">
                      {contact.externalId}
                    </span>
                  </Fact>
                ) : null}
              </dl>
              {contact?.remark ? (
                <p className="text-xs text-muted-foreground">
                  {contact.remark}
                </p>
              ) : null}
              {contact?.attributes.length ? (
                <div className="flex flex-wrap gap-1 border-t pt-2">
                  {contact.attributes.map((attribute) => (
                    <Badge
                      key={attribute.key}
                      variant="secondary"
                      className="text-xs"
                    >
                      {attribute.key}: {attribute.value}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label="Conversation actions"
                />
              }
            >
              <DotsThreeIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* The label has to sit inside a group: DropdownMenuLabel is
                  Base UI's Menu.GroupLabel and reads MenuGroupContext. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUS_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={async () => {
                      await setStatus({
                        conversationId,
                        status: option.value as Status,
                      });
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        conversation.status !== option.value && "invisible"
                      )}
                    />
                    <span className="capitalize">{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              {conversation.humanHandling ? (
                <DropdownMenuItem
                  onClick={async () => {
                    await setHumanHandling({ conversationId, handling: false });
                    toast.add({
                      title: "Agent resumed",
                      description: `${agent?.botName ?? "The agent"} will answer ${label} again.`,
                      type: "success",
                    });
                  }}
                >
                  <RobotIcon /> Resume agent now
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon /> Delete conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Kept out of the menu on purpose: it is a view setting somebody
              flips while reading, not an action on the conversation. */}
          <div className="ml-1 flex items-center gap-1.5 rounded-lg border px-2 py-1">
            <Label
              htmlFor="conv-tools"
              className="hidden text-xs sm:inline whitespace-nowrap"
            >
              Tool trace
            </Label>
            <Switch
              id="conv-tools"
              size="sm"
              aria-label="Show tool trace"
              checked={showTools}
              onCheckedChange={setShowTools}
            />
          </div>
        </div>
      </div>

      <TranscriptView
        messages={messages}
        showTools={showTools}
        perspective="team"
        agents={threadAgents}
        emptyState={
          <p className="text-sm text-muted-foreground">
            This conversation has no messages yet.
          </p>
        }
      />

      {/* Below the transcript, not inside it: the reader scrolls, this does
          not. Absent from the agent playground, which is a test harness with
          nobody on the other end to reply to. */}
      <ManualReply
        conversationId={conversationId}
        windowClosed={detail.freeFormWindowClosed}
        neverWritten={detail.lastInboundAt === null}
        humanHandling={conversation.humanHandling ?? false}
        agentName={agent?.botName ?? "The agent"}
        contactLabel={label}
      />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              The transcript with {label} and its tool trace are removed
              permanently. Any orders it produced are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
            <AlertDialogAction
              render={
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await removeConversation({ conversationId });
                    onDeleted();
                    toast.add({
                      title: "Conversation deleted",
                      type: "success",
                    });
                  }}
                >
                  Delete permanently
                </Button>
              }
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One line of a popover's fact list: a narrow term and whatever it is worth. */
function Fact({
  term,
  children,
}: {
  term: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <dt className="flex w-20 shrink-0 items-center text-muted-foreground">
        {term}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

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
  // ?view=escalations lands on the Escalations tab — what a notification about
  // an escalation should open. Read once, like ?c.
  const [view, setView] = useState<View>(
    params.get("view") === "escalations" ? "escalations" : "conversations"
  );

  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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

  const switchView = (next: View) => {
    setView(next);
    // A status bucket picked on one tab means nothing on the other.
    setStatusFilter("all");
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

  // A thread the customer had the last word on, and that nobody has filed
  // away. A closed conversation is not waiting on anybody.
  const isUnread = (row: (typeof matching)[number]) =>
    row.awaitingReply && row.status !== "closed";

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
                {rows.map((row) => {
                  const isActive = row._id === active?._id;
                  const unread = isUnread(row);
                  return (
                    <button
                      key={row._id}
                      type="button"
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-2.5 border-l-2 py-2.5 pr-3 pl-2.5 text-left transition-colors",
                        isActive
                          ? "border-l-primary bg-primary/[0.07]"
                          : "border-l-transparent hover:bg-muted/60"
                      )}
                      onClick={() => setSelected(row._id)}
                    >
                      <ContactAvatar
                        label={row.contactLabel}
                        channelType={row.channelType}
                        size={40}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate text-sm",
                              unread ? "font-semibold" : "font-medium"
                            )}
                          >
                            {displayContact(row)}
                          </span>
                          {row.status !== "open" &&
                          view === "conversations" ? (
                            <Badge
                              variant={statusVariant(row.status)}
                              className="shrink-0"
                            >
                              {row.status}
                            </Badge>
                          ) : null}
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {shortAgo(row.lastMessageAt)}
                          </span>
                        </span>

                        <span className="mt-0.5 flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-xs",
                              unread
                                ? "text-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {row.lastMessagePreview ?? "No messages"}
                          </span>
                          {/* The one thing on the row worth a colour: the
                              customer spoke last and is still waiting. */}
                          {unread ? (
                            <span
                              className="size-2 shrink-0 rounded-full bg-primary"
                              title="Waiting on a reply"
                            />
                          ) : null}
                        </span>

                        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                          {row.messageCount} messages ·{" "}
                          {/* Two names once the front desk has routed it on:
                              where it arrived, and who has it now. */}
                          {row.handedOff
                            ? `${row.agentName} → ${row.activeAgentName}`
                            : row.agentName}
                        </span>
                      </span>
                    </button>
                  );
                })}
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
              onDeleted={() => setSelected(null)}
              onBack={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
