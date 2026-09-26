"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { TranscriptView, type TranscriptAgent } from "@/components/transcript";
import { ManualReply } from "@/components/manual-reply";
import { ContactAvatar } from "@/components/contact-avatar";
import { HandbackCountdown } from "@/components/handback-timer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
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
  WhatsappLogoIcon,
  GlobeIcon,
  TrashIcon,
  ArrowLeftIcon,
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
  CheckCircleIcon,
  ArrowsSplitIcon,
} from "@phosphor-icons/react";

/**
 * One thread, read and answered — the transcript, the facts about it and the
 * reply box — and the row that opens it.
 *
 * Shared by the inbox and the escalations desk, so a human agent signed in on
 * the desk sees exactly the thread the dashboard shows. The two differ only in
 * what `ConversationDetail` is handed: the desk passes `replyingAs`.
 */

/** A thread as `conversations.listByWorkspace` and `desk.escalations` list it. */
export type InboxRow = FunctionReturnType<
  typeof api.conversations.listByWorkspace
>[number];

export type Status = "open" | "escalated" | "closed";

export const STATUS_OPTIONS = [
  { value: "open", label: "open" },
  { value: "escalated", label: "escalated" },
  { value: "closed", label: "closed" },
];

// Auto-generated web session ids are noise in a list; show something readable.
export function displayContact(row: {
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
export function shortAgo(timestamp: number): string {
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

export function statusVariant(status: Status) {
  return status === "escalated"
    ? "destructive"
    : status === "closed"
      ? "secondary"
      : "default";
}

/** A thread the customer had the last word on, and that nobody has filed away. */
export function isUnread(row: InboxRow): boolean {
  return row.awaitingReply && row.status !== "closed";
}

/** One thread in a list, as the inbox and the desk both draw it. */
export function ConversationRow({
  row,
  active,
  showStatus,
  onSelect,
}: {
  row: InboxRow;
  active: boolean;
  /** Off where every row has the same status and the badge would say nothing. */
  showStatus: boolean;
  onSelect: () => void;
}) {
  const unread = isUnread(row);
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
          {showStatus && row.status !== "open" ? (
            <Badge variant={statusVariant(row.status)} className="shrink-0">
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
              unread ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {row.lastMessagePreview ?? "No messages"}
          </span>
          {/* The one thing on the row worth a colour: the customer spoke last
              and is still waiting. */}
          {unread ? (
            <span
              className="size-2 shrink-0 rounded-full bg-primary"
              title="Waiting on a reply"
            />
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
// Detail pane — contact facts plus the shared transcript reader.
// ---------------------------------------------------------------------------

export function ConversationDetail({
  conversationId,
  workspaceId,
  agents: threadAgents,
  replyingAs,
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
  const [showTools, setShowTools] = useState(true);
  // Held here rather than inside the actions menu: the menu unmounts as soon
  // as an item is picked, and a confirmation that unmounts with the thing that
  // opened it never appears.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [resolving, setResolving] = useState(false);

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

  const { conversation, contact, agent } = detail;

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
        description: `${agent?.botName ?? "The agent"} answers ${label} again.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not resolve",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
      setResolving(false);
    }
  };
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
                {/* Short on a phone, where the full sentence runs under the
                    buttons beside it. */}
                <span className="max-sm:hidden">You have this thread</span>
                <span className="sm:hidden">Yours</span>
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
        workspaceId={workspaceId}
        replyingAs={replyingAs}
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
