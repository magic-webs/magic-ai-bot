"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { TranscriptView, type TranscriptAgent } from "@/components/transcript";
import { ManualReply } from "@/components/manual-reply";
import { ContactAvatar } from "@/components/contact-avatar";
import { DeliveryTicks } from "@/components/delivery-ticks";
import { WindowClock } from "@/components/window-clock";
import { SelectField } from "@/components/select-field";
import { CHANNEL_LABEL, ChannelMark, type ChannelKind } from "@/components/channel-mark";
import {
  Countdown,
  HandbackCountdown,
  holdEnd,
  replyWindow,
  useNow,
} from "@/components/handback-timer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  TrashIcon,
  ArrowLeftIcon,
  EnvelopeIcon,
  PhoneIcon,
  BuildingsIcon,
  UserIcon,
  RobotIcon,
  ClockIcon,
  DotsThreeIcon,
  DeviceMobileIcon,
  CheckIcon,
  CheckCircleIcon,
  ArrowsSplitIcon,
  NotepadIcon,
  PauseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ProhibitIcon,
} from "@phosphor-icons/react";

/**
 * One thread, read and answered — the transcript, the facts about it and the
 * reply box — and the row that opens it.
 *
 * Shared by the inbox and the escalations desk, so a human agent signed in on
 * the desk sees exactly the thread the dashboard shows. The two differ only in
 * what `ConversationDetail` is handed: the desk passes `replyingAs`.
 */

/** A thread as `conversations.listInbox` and `desk.escalations` list it. */
export type InboxRow = FunctionReturnType<
  typeof api.conversations.listInbox
>["page"][number];

export type Status = "open" | "escalated" | "closed";

export const STATUS_OPTIONS = [
  { value: "open", label: "open" },
  { value: "escalated", label: "escalated" },
  { value: "closed", label: "closed" },
];

// Auto-generated web session ids are noise in a list; show something readable.
export function displayContact(row: {
  contactLabel: string;
  channelType: ChannelKind;
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

/** The time at the end of a chat row, the way WhatsApp writes it. */
export function chatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  if (timestamp >= today.getTime()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (timestamp >= today.getTime() - dayMs) return "Yesterday";
  if (timestamp >= today.getTime() - 6 * dayMs) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

/** Who said the last thing, as the row prefixes it. Null for the customer. */
function lastSpeaker(row: InboxRow): string | null {
  switch (row.lastMessageFrom) {
    case "team":
      return row.lastMessageSender ?? "Team";
    case "agent":
      return row.lastMessageSender ?? row.activeAgentName;
    case "system":
      return row.lastMessageSender ?? "Alert";
    default:
      return row.lastMessageRole === "assistant" ? row.activeAgentName : null;
  }
}

export function statusVariant(status: Status) {
  return status === "escalated"
    ? "destructive"
    : status === "closed"
      ? "secondary"
      : "default";
}

/** A thread the customer had the last word on, and that nobody has filed away. */
export function isUnread(row: InboxRow): boolean {
  return row.awaitingReply && row.status !== "closed" && !row.markedBot;
}

/** One thread in a list, as the inbox and the desk both draw it. */
export function ConversationRow({
  row,
  active,
  showStatus,
  showChannel = false,
  onSelect,
}: {
  row: InboxRow;
  active: boolean;
  /** Off where every row has the same status and the badge would say nothing. */
  showStatus: boolean;
  /** Which number it came in on, for a workspace with more than one. */
  showChannel?: boolean;
  onSelect: () => void;
}) {
  const unread = isUnread(row);
  const speaker = lastSpeaker(row);
  const waiting = unread ? Math.max(1, row.unreadCount ?? 1) : 0;
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 border-l-2 py-2.5 pr-3 pl-2.5 text-left transition-colors",
        active
          ? "border-l-primary bg-primary/[0.07]"
          : "border-l-transparent hover:bg-muted/60"
      )}
      onClick={onSelect}
    >
      <span className="relative mt-0.5 shrink-0">
        <ContactAvatar
          label={row.contactLabel}
          channelType={row.channelType}
          size={40}
        />
        <ChannelMark
          type={row.channelType}
          size={17}
          className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
        />
      </span>
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
          {showStatus && row.status !== "open" ? (
            <Badge variant={statusVariant(row.status)} className="shrink-0">
              {row.status}
            </Badge>
          ) : null}
          {row.markedBot ? (
            <Badge variant="destructive" className="shrink-0">
              bot
            </Badge>
          ) : null}
          {showChannel && row.channelName ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              · {row.channelName}
            </span>
          ) : null}
          <span
            className={cn(
              "ml-auto shrink-0 text-xs",
              unread ? "font-medium text-primary" : "text-muted-foreground"
            )}
          >
            {chatTime(row.lastMessageAt)}
          </span>
        </span>

        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 text-xs",
              unread ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {speaker ? (
              <>
                <DeliveryTicks status={row.lastMessageDelivery} className="size-3.5" />
                <span className="shrink-0 font-medium">{speaker}:</span>
              </>
            ) : null}
            <span className="truncate">
              {row.lastMessagePreview ?? "No messages"}
            </span>
          </span>
          {waiting ? (
            <span
              className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
              title="Messages waiting on a reply"
            >
              {waiting > 99 ? "99+" : waiting}
            </span>
          ) : null}
        </span>

        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
          {row.messageCount} messages ·{" "}
          {/* Two names once the front desk has routed it on: where it arrived,
              and who has it now. */}
          {row.handedOff
            ? `${row.agentName} → ${row.activeAgentName}`
            : row.agentName}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail pane — the transcript and the reply box, with everything else about
// the thread and the person in a panel beside it.
// ---------------------------------------------------------------------------

/**
 * Whether the screen matches a media query, kept current as it is resized.
 * An external source, so it is read through useSyncExternalStore; there is no
 * screen on the server, which says no.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/**
 * Whether the details panel is open on a wide screen. Closed to begin with,
 * so the transcript gets the room; once somebody opens it, it stays open as
 * they move from thread to thread, until the page is loaded again. Module
 * state rather than storage, so every visit starts closed.
 */
let detailsOpenThisVisit = false;

export function ConversationDetail({
  conversationId,
  workspaceId,
  agents: threadAgents,
  replyingAs,
  detailsInlineFrom = "(min-width: 1440px)",
  onDeleted,
  onBack,
}: {
  conversationId: Id<"conversations">;
  workspaceId: Id<"workspaces">;
  /**
   * For the face and name on each reply. A thread that was handed over has
   * messages from two agents in it, and the transcript is the only place that
   * can say which of them said what. Passed in rather than fetched, because
   * the inbox and the escalations desk read the roster through different
   * doors.
   */
  agents: TranscriptAgent[] | undefined;
  /**
   * Set on the escalations desk: the human agent signed in. They reply as
   * themselves, get a Resolve button, and cannot delete the thread.
   */
  replyingAs?: { name: string; role: string };
  /**
   * From how wide the details sit beside the transcript rather than sliding
   * over it. The inbox shares its width with the app sidebar and the thread
   * list; the desk has no sidebar, so it can afford them sooner.
   */
  detailsInlineFrom?: string;
  onDeleted: () => void;
  /** Below lg the transcript is the whole screen; this is the way back to the list. */
  onBack: () => void;
}) {
  const onDesk = Boolean(replyingAs);
  const detail = useQuery(api.conversations.getWithContact, { conversationId });
  const messages = useQuery(api.conversations.listMessages, { conversationId });
  const setStatus = useMutation(api.conversations.setStatus);
  const setHumanHandling = useMutation(api.conversations.setHumanHandling);
  const removeConversation = useMutation(api.conversations.remove);
  const setBot = useMutation(api.conversations.setBot);
  // Off by default: the trace is for working out why an agent said something,
  // and most people opening a thread are here to read what it said.
  const [showTools, setShowTools] = useState(false);
  // Held here rather than inside the actions menu: the menu unmounts as soon
  // as an item is picked, and a confirmation that unmounts with the thing that
  // opened it never appears.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Two answers to "are the details showing", one per layout. Beside the
  // transcript it is a standing preference; sliding over it, it is something
  // opened to look at and closed again, so it starts shut on every thread.
  const inline = useMediaQuery(detailsInlineFrom);
  const [inlineOpen, setInlineOpen] = useState(() => detailsOpenThisVisit);
  const [sheetOpen, setSheetOpen] = useState(false);
  const detailsOpen = inline ? inlineOpen : sheetOpen;
  // The tab's arrow nudges once, to say there is something behind it — and
  // not again once it has been used, which says it has been found.
  const [tabUsed, setTabUsed] = useState(false);
  const toggleDetails = () => {
    setTabUsed(true);
    if (inline) {
      setInlineOpen(!inlineOpen);
      detailsOpenThisVisit = !inlineOpen;
    } else {
      setSheetOpen(!sheetOpen);
    }
  };

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
        {onDesk
          ? "This conversation has left the desk — it was resolved or set back to open."
          : "This conversation no longer exists."}
      </div>
    );
  }

  const { conversation, contact, agent, channel } = detail;
  const rawLabel =
    contact?.name ?? contact?.phone ?? contact?.externalId ?? "Unknown";
  const label = displayContact({
    contactLabel: rawLabel,
    channelType: conversation.channelType,
  });
  // Who answers now, which is not the entry agent once the front desk has
  // routed the thread on.
  const holderId = conversation.activeAgentId ?? conversation.agentId;
  const holderName =
    threadAgents?.find((one) => one._id === holderId)?.botName ??
    agent?.botName ??
    "The agent";

  const resume = async () => {
    await setHumanHandling({ conversationId, handling: false });
    toast.add({
      title: "Agent resumed",
      description: `${holderName} will answer ${label} again.`,
      type: "success",
    });
  };

  const toggleBot = async () => {
    const bot = !conversation.markedBot;
    try {
      await setBot({ conversationId, bot });
      toast.add({
        title: bot ? "Marked as bot" : "Unmarked as bot",
        description: bot
          ? `Messages from ${label} are ignored and no agent answers them.`
          : `${holderName} will answer ${label} again.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not update",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  // Done with it: the agent answers again, and the thread leaves the desk.
  // The hold is released first, because once the status has moved the desk
  // can no longer touch the thread.
  const resolve = async () => {
    setResolving(true);
    try {
      if (conversation.humanHandling) {
        await setHumanHandling({ conversationId, handling: false });
      }
      await setStatus({ conversationId, status: "open" });
      toast.add({
        title: "Resolved",
        description: `${holderName} answers ${label} again.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not resolve",
        description: friendlyError(error),
        type: "error",
      });
      setResolving(false);
    }
  };

  const details = (
    <ThreadDetails
      conversation={conversation}
      contact={contact}
      channel={channel}
      rawLabel={rawLabel}
      label={label}
      arrivedAt={agent?.botName ?? "— deleted —"}
      holderName={holderName}
      lastInboundAt={detail.lastInboundAt}
      editable={!onDesk}
      onResume={() => void resume()}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The way in and out of the details: a tab on the chat's right edge,
            halfway down, which is where the panel it moves sits. Open, it
            rides the panel's border and points right, to push it away;
            closed, it points left, to pull it back out. No right border of
            its own — the edge it is attached to is that border. */}
        <button
          type="button"
          aria-label={detailsOpen ? "Hide details" : "Show details"}
          aria-expanded={detailsOpen}
          title={detailsOpen ? "Hide details" : "Details and notes"}
          className="absolute top-1/2 right-0 z-10 flex h-14 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-lg border border-r-0 bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={toggleDetails}
        >
          {detailsOpen ? (
            <CaretRightIcon weight="bold" className="size-3.5" />
          ) : (
            <CaretLeftIcon
              weight="bold"
              className="size-3.5"
              data-slot={tabUsed ? undefined : "details-nudge"}
            />
          )}
        </button>

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
                  {/* Short on a phone, where the full sentence runs under the
                      buttons beside it. */}
                  <span className="max-sm:hidden">You have this thread</span>
                  <span className="sm:hidden">Yours</span>
                  {/* The hold expires, and a colleague who cannot see the clock
                      finds out when the agent answers over the top of them. */}
                  <HandbackCountdown
                    humanHandlingAt={conversation.humanHandlingAt}
                    humanHandlingUntil={conversation.humanHandlingUntil}
                  />
                </Badge>
              ) : null}
              {conversation.markedBot ? (
                <Badge variant="destructive" className="gap-1">
                  <ProhibitIcon className="size-3" />
                  Bot · blocked
                </Badge>
              ) : null}
            </div>

            {/* Two facts, and only two. Everything else about the thread and
                the person is in the details panel — a header that grows with
                the record pushes the conversation off the screen it is
                supposed to be about. */}
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <ChannelMark type={conversation.channelType} size={14} />
                {contact?.phone ? (
                  <span className="font-mono">{contact.phone}</span>
                ) : (
                  <span>Web chat</span>
                )}
                {channel ? <span>· via {channel.name}</span> : null}
              </span>
              <span className="flex items-center gap-1">
                <ClockIcon className="size-3.5 shrink-0" />
                Last activity {relative(conversation.lastMessageAt)}
              </span>
              {conversation.channelType !== "web" ? (
                <HeaderWindow lastInboundAt={detail.lastInboundAt} />
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onDesk && conversation.status === "escalated" ? (
              // Icon-only on a phone, where the label would squeeze the
              // contact's name out of the header.
              <Button
                size="sm"
                className="mr-1 max-sm:size-8 max-sm:px-0"
                aria-label="Resolve"
                title="Resolve — hand back to the agent and off the desk"
                disabled={resolving}
                onClick={() => void resolve()}
              >
                {resolving ? <Spinner /> : <CheckCircleIcon />}
                <span className="max-sm:hidden">Resolve</span>
              </Button>
            ) : null}

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
                  <DropdownMenuItem onClick={() => void resume()}>
                    <RobotIcon /> Resume agent now
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => void toggleBot()}>
                  <ProhibitIcon />
                  {conversation.markedBot ? "Unmark as bot" : "Mark as bot"}
                </DropdownMenuItem>
                {onDesk ? null : (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <TrashIcon /> Delete conversation
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Kept out of the menu on purpose: it is a view setting somebody
                flips while reading, not an action on the conversation. */}
            <div className="ml-1 flex items-center gap-1.5 rounded-lg border px-2 py-1">
              <Label
                htmlFor="conv-tools"
                className="hidden text-xs whitespace-nowrap sm:inline"
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
          workspaceId={workspaceId}
          replyingAs={replyingAs}
          channelType={conversation.channelType}
          lastInboundAt={detail.lastInboundAt}
          windowClosed={detail.freeFormWindowClosed}
          neverWritten={detail.lastInboundAt === null}
          humanHandling={conversation.humanHandling ?? false}
          agentName={holderName}
          contactLabel={label}
        />
      </div>

      {inline ? (
        detailsOpen ? (
          <aside
            aria-label="Conversation details"
            className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-muted/20"
          >
            {details}
          </aside>
        ) : null
      ) : (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-sm">
            <SheetHeader className="border-b">
              <SheetTitle>Details</SheetTitle>
            </SheetHeader>
            {details}
          </SheetContent>
        </Sheet>
      )}

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
    </div>
  );
}

// ---------------------------------------------------------------------------
// The details panel
// ---------------------------------------------------------------------------

type Detail = NonNullable<
  FunctionReturnType<typeof api.conversations.getWithContact>
>;

/** One titled block of the panel. */
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b px-4 py-3.5 last:border-b-0">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function HeaderWindow({ lastInboundAt }: { lastInboundAt: number | null }) {
  const now = useNow();
  const window24 = replyWindow(lastInboundAt, now);
  if (!window24) return null;
  return (
    <span
      className={cn(
        "flex items-center gap-1",
        !window24.open && "text-destructive",
        window24.open && window24.left < 60 * 60_000 && "text-amber-600 dark:text-amber-400"
      )}
    >
      <WindowClock lastInboundAt={lastInboundAt} size={14} />
      {window24.open ? (
        <span>
          <Countdown to={window24.endsAt} /> to reply
        </span>
      ) : (
        "Reply window closed"
      )}
    </span>
  );
}

function Pipeline({
  conversation,
}: {
  conversation: Detail["conversation"];
}) {
  const stages = useQuery(api.leads.stageNames, {
    workspaceId: conversation.workspaceId,
  });
  const records = useQuery(api.records.forConversation, {
    conversationId: conversation._id,
  });
  const setLeadStage = useMutation(api.leads.setStage);
  const updateRecord = useMutation(api.records.updateRecord);

  const run = async (work: Promise<unknown>, done: string) => {
    try {
      await work;
      toast.add({ title: done, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not change the stage",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  return (
    <DetailSection title="Pipeline">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="thread-lead-stage" className="text-xs text-muted-foreground">
          Lead stage
        </Label>
        <SelectField
          id="thread-lead-stage"
          size="sm"
          value={conversation.leadStageId ?? "none"}
          disabled={stages === undefined}
          onValueChange={(value) =>
            void run(
              setLeadStage({
                conversationId: conversation._id,
                stageId: value === "none" ? undefined : (value as Id<"leadStages">),
                note: conversation.leadStageNote,
              }),
              "Lead stage changed"
            )
          }
          options={[
            { value: "none", label: "Not staged" },
            ...(stages ?? []).map((stage) => ({
              value: stage._id as string,
              label: stage.name,
            })),
          ]}
        />
      </div>

      {records === undefined ? (
        <Spinner className="size-3.5" />
      ) : records.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing filed from this thread yet.</p>
      ) : (
        records.map((record) => {
          const options = record.stage && !record.stages.includes(record.stage)
            ? [record.stage, ...record.stages]
            : record.stages;
          return (
            <div key={record._id} className="flex flex-col gap-1.5 rounded-md border p-2">
              <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium">
                  {record.bookName}
                  {record.serialNumber ? ` #${record.serialNumber}` : ""}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {record.reference}
                </span>
              </div>
              {record.summary ? (
                <p className="truncate text-xs text-muted-foreground">{record.summary}</p>
              ) : null}
              {options.length > 0 ? (
                <SelectField
                  size="sm"
                  aria-label={`${record.bookName} stage`}
                  value={record.stage ?? ""}
                  placeholder="No stage"
                  onValueChange={(stage) =>
                    void run(
                      updateRecord({ recordId: record._id, stage }),
                      `${record.bookName} moved to ${stage}`
                    )
                  }
                  options={options.map((stage) => ({ value: stage, label: stage }))}
                />
              ) : null}
            </div>
          );
        })
      )}
    </DetailSection>
  );
}

/**
 * Everything about the thread and the person that is not the conversation
 * itself: who they are, the notes kept on them, whether the agent is
 * answering, how long WhatsApp will still take a free-form reply, and the
 * thread's own history.
 */
function ThreadDetails({
  conversation,
  contact,
  channel,
  rawLabel,
  label,
  arrivedAt,
  holderName,
  lastInboundAt,
  editable,
  onResume,
}: {
  conversation: Detail["conversation"];
  contact: Detail["contact"];
  channel: Detail["channel"];
  rawLabel: string;
  label: string;
  arrivedAt: string;
  holderName: string;
  lastInboundAt: number | null;
  /** Off on the desk, which may read the notes but not change them. */
  editable: boolean;
  onResume: () => void;
}) {
  const now = useNow();
  const pauseEnd = conversation.humanHandling
    ? holdEnd(conversation.humanHandlingAt, conversation.humanHandlingUntil)
    : null;
  const window24 =
    conversation.channelType !== "web"
      ? replyWindow(lastInboundAt, now)
      : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-4">
        <span className="relative shrink-0">
          <ContactAvatar
            label={rawLabel}
            channelType={conversation.channelType}
            size={48}
          />
          <ChannelMark
            type={conversation.channelType}
            size={19}
            className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
          />
        </span>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold">{label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {channel?.name ?? CHANNEL_LABEL[conversation.channelType]}
            {channel?.phone ? ` · ${channel.phone}` : null}
            {contact?.company ? ` · ${contact.company}` : null}
          </p>
        </div>
      </div>

      <DetailSection title="Contact">
        <dl className="flex flex-col gap-1.5 text-xs">
          <Fact term={<PhoneIcon className="size-3.5" />}>
            {contact?.phone ? (
              <span className="font-mono">{contact.phone}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Fact>
          <Fact term={<EnvelopeIcon className="size-3.5" />}>
            {contact?.email ? (
              <span className="font-mono break-all">{contact.email}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Fact>
          {contact?.company ? (
            <Fact term={<BuildingsIcon className="size-3.5" />}>
              {contact.company}
            </Fact>
          ) : null}
          {contact?.externalId && contact.externalId !== contact.phone ? (
            <Fact term={<DeviceMobileIcon className="size-3.5" />}>
              <span className="font-mono break-all opacity-70">
                {contact.externalId}
              </span>
            </Fact>
          ) : null}
        </dl>
        {contact?.attributes.length ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {contact.attributes.map((attribute) => (
              <Badge key={attribute.key} variant="secondary" className="text-xs">
                {attribute.key}: {attribute.value}
              </Badge>
            ))}
          </div>
        ) : null}
      </DetailSection>

      <Pipeline conversation={conversation} />

      <DetailSection title="Notes">
        {contact ? (
          <ContactNotes
            // Remounted when the stored note changes, so a note saved from
            // another screen replaces what is shown rather than hiding behind
            // an unsaved copy of the old one.
            key={`${contact._id}:${contact.remark ?? ""}`}
            contactId={contact._id}
            remark={contact.remark ?? ""}
            editable={editable}
          />
        ) : (
          <p className="text-xs text-muted-foreground">No contact on file.</p>
        )}
        {conversation.leadStageNote ? (
          <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Lead note · </span>
            {conversation.leadStageNote}
          </p>
        ) : null}
      </DetailSection>

      <DetailSection title="Agent">
        {pauseEnd ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs">
              <PauseIcon className="size-3.5 shrink-0 text-amber-600" />
              <span>
                {holderName} is paused ·{" "}
                <HandbackCountdown
                  humanHandlingAt={conversation.humanHandlingAt}
                  humanHandlingUntil={conversation.humanHandlingUntil}
                />
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Answers again at{" "}
              {new Date(pauseEnd).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
              , unless somebody replies by hand first.
            </p>
            <Button size="sm" variant="outline" className="self-start" onClick={onResume}>
              <RobotIcon /> Resume now
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs">
            <RobotIcon className="size-3.5 shrink-0 text-primary" />
            {holderName} is answering
          </p>
        )}
      </DetailSection>

      {conversation.channelType !== "web" ? (
        <DetailSection title="Reply window">
          {window24 ? (
            <div className="flex items-center gap-3">
              <WindowClock lastInboundAt={lastInboundAt} size={44} />
              {window24.open ? (
                <p className="text-xs font-medium">
                  Open · <Countdown to={window24.endsAt} /> left
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {conversation.channelType === "whatsapp"
                    ? "Closed — only an approved template gets through until they write again."
                    : "Closed — nothing gets through until they write again."}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              They have not written on {CHANNEL_LABEL[conversation.channelType]} yet.
            </p>
          )}
        </DetailSection>
      ) : null}

      <DetailSection title="This thread">
        <dl className="flex flex-col gap-1.5 text-xs">
          <Fact term="Status">
            <span className="capitalize">{conversation.status}</span>
          </Fact>
          <Fact term="Started">
            {new Date(conversation.createdAt).toLocaleString()}
          </Fact>
          <Fact term="Last activity">{relative(conversation.lastMessageAt)}</Fact>
          <Fact term="Messages">{conversation.messageCount}</Fact>
          <Fact term="Arrived at">{arrivedAt}</Fact>
          <Fact term="Held by">{holderName}</Fact>
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
      </DetailSection>
    </div>
  );
}

/**
 * The note the team keeps on this person — the contact's remark, the same
 * field the Contacts table edits. Saved on request rather than on every
 * keystroke, so a half-written note is not what a colleague reads.
 */
function ContactNotes({
  contactId,
  remark,
  editable,
}: {
  contactId: Id<"contacts">;
  remark: string;
  editable: boolean;
}) {
  const update = useMutation(api.contacts.update);
  const [draft, setDraft] = useState(remark);
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== remark.trim();

  if (!editable) {
    return remark ? (
      <p className="text-xs whitespace-pre-wrap">{remark}</p>
    ) : (
      <p className="text-xs text-muted-foreground">No notes on this contact.</p>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await update({ contactId, remark: draft });
      toast.add({ title: "Note saved", type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not save the note",
        description: friendlyError(error),
        type: "error",
      });
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={draft}
        rows={3}
        placeholder="Anything the team should know — preferences, what was promised, who to ask for."
        className="min-h-20 bg-background text-xs"
        aria-label="Notes on this contact"
        onChange={(event) => setDraft(event.target.value)}
      />
      {dirty ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? <Spinner /> : <NotepadIcon />} Save note
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setDraft(remark)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One line of a fact list: a narrow term and whatever it is worth. */
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
