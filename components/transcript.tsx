"use client";

import { Fragment } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { RichMessage, parseRichPayload } from "@/components/rich-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { AgentAvatar, type AgentGender } from "@/components/agent-avatar";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  WrenchIcon,
  CaretRightIcon,
  ArrowsSplitIcon,
  ChecksIcon,
  ClipboardTextIcon,
  UserIcon,
} from "@phosphor-icons/react";

function timeOf(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local midnight, as the key a run of messages on one day is grouped by. */
function dayKeyOf(createdAt: number): string {
  return new Date(createdAt).toDateString();
}

/**
 * The chip that breaks the thread up by day. Today and yesterday are named
 * as well as dated — a reader working out how stale a conversation is should
 * not have to hold the calendar in their head.
 */
function dayLabelOf(createdAt: number): string {
  const date = new Date(createdAt);
  const dated = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round(
    (midnight.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days === 0) return `Today, ${dated}`;
  if (days === 1) return `Yesterday, ${dated}`;
  return dated;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One tool call, collapsed to a single line until opened.
// ---------------------------------------------------------------------------

export function ToolTrace({ message }: { message: Doc<"messages"> }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="lg" className="text-muted-foreground">
            {/* The trigger is this Button, so `data-panel-open` lands on the
                group/button element the icon sits inside. */}
            <CaretRightIcon className="transition-transform group-data-panel-open/button:rotate-90" />
            <WrenchIcon />
            <span className="font-mono">{message.toolName}</span>
            <Badge
              variant={message.toolOk ? "secondary" : "destructive"}
              className="text-xs"
            >
              {message.toolOk ? "ok" : "failed"}
            </Badge>
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Input
          </p>
          <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
            {message.toolInput}
          </pre>
          <Separator className="my-1" />
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output
          </p>
          <pre className="max-h-52 overflow-auto font-mono text-xs whitespace-pre-wrap">
            {message.toolOutput}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// An internal handover, mid-conversation. The customer never saw this; it is
// here so a company reading the transcript can tell why the voice changed.
// ---------------------------------------------------------------------------

function HandoffMarker({ message }: { message: Doc<"messages"> }) {
  let summary: string | null = null;
  try {
    const parsed = JSON.parse(message.toolInput ?? "{}") as {
      summary?: string;
    };
    summary = parsed.summary?.trim() || null;
  } catch {
    /* older rows, or a truncated payload */
  }

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowsSplitIcon className="size-3.5" />
        <span>{message.text}</span>
      </div>
      {summary ? (
        <p className="max-w-md text-center text-xs text-muted-foreground/80">
          Handed over: {summary}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// An internal note on the thread — the follow-up desk filing the conversation
// at a lead stage and saying why.
//
// Deliberately not a bubble. It used to fall through to the ordinary message
// branch, which put the desk's private reasoning on the left in the same
// outline bubble an agent's reply uses: it read as though "Filed at New
// enquiry · No nudge needed" had been sent to the customer. Nothing here was
// ever sent anywhere, so it is set apart from the conversation instead of
// dressed up as part of it.
// ---------------------------------------------------------------------------

function NoteMarker({ message }: { message: Doc<"messages"> }) {
  return (
    // Amber, and the only amber on the thread. On the chat wallpaper a note in
    // the neutral palette reads as another bubble that happens to be wide; a
    // colour nothing else uses says "this is not part of the conversation"
    // before the label underneath it is read.
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-amber-300/70 bg-amber-50/95 px-3 py-2 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-center gap-1.5">
        <ClipboardTextIcon className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
        <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
          Internal note · Not sent to the customer
        </p>
        <span className="ml-auto shrink-0 text-xs text-amber-800/70 dark:text-amber-200/60">
          {timeOf(message.createdAt)}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-amber-950/90 dark:text-amber-100/80">
        {message.text}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The message list. Shared by the agent playground and the conversations
// reader so both render bubbles, tool traces and errors identically.
// ---------------------------------------------------------------------------

export type TranscriptAgent = {
  _id: string;
  botName: string;
  gender?: AgentGender | null;
};

export function TranscriptView({
  messages,
  showTools = true,
  leading,
  trailing,
  emptyState,
  contentClassName,
  perspective = "customer",
  agents,
}: {
  /** `undefined` while the query is in flight. */
  messages: Doc<"messages">[] | undefined;
  showTools?: boolean;
  /** Items rendered above the transcript, e.g. a greeting. */
  leading?: React.ReactNode;
  /** Items rendered below it, e.g. a typing indicator. */
  trailing?: React.ReactNode;
  emptyState?: React.ReactNode;
  contentClassName?: string;
  /**
   * Which side of the conversation the reader is on, which decides who gets
   * the tinted bubbles on the right.
   *
   * The playground is `"customer"`: you type as the customer, so your messages
   * are the outgoing ones and the agent answers from the left. The inbox is
   * `"team"` — you are the business, the reply box at the bottom posts as the
   * business, and an inbox that puts the customer on the right reads as though
   * somebody else were running the account.
   */
  perspective?: "customer" | "team";
  /**
   * The workspace's agents, so a reply can carry the face and name of
   * whichever one wrote it. Omit and the bubbles are unattributed.
   */
  agents?: TranscriptAgent[];
}) {
  const visible = (messages ?? []).filter((message) =>
    message.kind === "tool" ? showTools : true
  );

  const agentById = new Map((agents ?? []).map((agent) => [agent._id, agent]));
  const teamOnRight = perspective === "team";

  /**
   * Who to credit each bubble to, and whether to say so out loud.
   *
   * The group-chat rule: the face and the name go on the first message of a
   * run and are left off the rest, so a handoff mid-thread reads as a change
   * of face rather than as a name repeated down every line. Computed over the
   * bubbles alone — a tool trace between two of Ziya's replies does not make
   * the second one a new speaker.
   */
  const senderKeys = new Map<string, { key: string; first: boolean }>();
  let previousKey: string | null = null;
  for (const message of visible) {
    if (
      message.kind === "tool" ||
      message.kind === "handoff" ||
      message.kind === "note" ||
      message.kind === "error"
    ) {
      continue;
    }
    const key =
      message.role === "user"
        ? "customer"
        : message.sentByHuman
          ? "team"
          : (message.agentId ?? "agent");
    senderKeys.set(message._id, { key, first: key !== previousKey });
    previousKey = key;
  }

  /**
   * One row of the thread. Lifted out of the map so the map itself can be
   * about grouping — it has to look at the message before this one to know
   * whether a new day has started.
   */
  const renderMessage = (message: Doc<"messages">) => {
    if (message.kind === "tool") {
      return (
        <MessageScrollerItem
          key={message._id}
          messageId={message._id}
          // A tool call is part of the agent's turn, so it sits on
          // the agent's side — which moves with the perspective.
          // Left-aligned everywhere, it ends up opposite the reply
          // it belongs to the moment the agent is on the right.
          className={cn(
            "flex w-full",
            teamOnRight ? "justify-end" : "justify-start"
          )}
        >
          {/* Sized to its content, capped like a bubble: collapsed
              it is the width of the name, expanded it grows to fit
              the payload without running the width of the thread. */}
          <div className="min-w-0 max-w-[80%]">
            <ToolTrace message={message} />
          </div>
        </MessageScrollerItem>
      );
    }

    if (message.kind === "handoff") {
      return (
        <MessageScrollerItem
          key={message._id}
          messageId={message._id}
          className="mx-auto w-full"
        >
          <HandoffMarker message={message} />
        </MessageScrollerItem>
      );
    }

    if (message.kind === "note") {
      return (
        <MessageScrollerItem
          key={message._id}
          messageId={message._id}
          className="mx-auto w-full"
        >
          <NoteMarker message={message} />
        </MessageScrollerItem>
      );
    }

    if (message.kind === "error") {
      return (
        <MessageScrollerItem
          key={message._id}
          messageId={message._id}
        >
          {/* Also the agent's, so it follows the agent's side. */}
          <Bubble
            variant="destructive"
            align={teamOnRight ? "end" : "start"}
          >
            <BubbleContent className="font-mono text-xs">
              {message.text}
            </BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      );
    }

    const isCustomer = message.role === "user";
    // Whose messages sit on the right in the tinted bubble: the
    // reader's own side.
    const mine = teamOnRight ? !isCustomer : isCustomer;

    const sender = senderKeys.get(message._id);
    const agent = message.agentId
      ? agentById.get(message.agentId)
      : undefined;
    // Only the business side is ever more than one person — several
    // agents, plus whoever on the team picked the thread up — so it
    // is the only side that needs naming.
    const attributed =
      !isCustomer && (Boolean(agent) || Boolean(message.sentByHuman));

    // What the customer was actually shown, rendered the same way
    // the chat renders it — a line of prose describing a menu is no
    // use to someone working out why a conversation went wrong.
    // Inert here: clicking a button in a transcript must not answer
    // on the customer's behalf.
    const rich = parseRichPayload(message.payload);

    // How long the model took. Diagnostic rather than conversational, so on
    // our own side of the thread it rides with the tool trace — under every
    // outgoing bubble a bare "1.2s" is noise on a page meant to read as a
    // conversation. On the other side it keeps the clock company in the
    // footer, as it always has.
    const showLatency = Boolean(message.latencyMs) && (!mine || showTools);
    const teamMark = Boolean(message.sentByHuman) && !sender?.first;
    const showFooter = !mine || showLatency || teamMark;

    return (
      <MessageScrollerItem key={message._id} messageId={message._id}>
        <Message align={mine ? "end" : "start"}>
          {attributed ? (
            sender?.first ? (
              <MessageAvatar className="bg-transparent">
                {message.sentByHuman || !agent ? (
                  <span className="flex size-7 items-center justify-center rounded-full border bg-muted">
                    <UserIcon className="size-3.5" />
                  </span>
                ) : (
                  <AgentAvatar
                    name={agent.botName}
                    gender={agent.gender}
                    size={28}
                  />
                )}
              </MessageAvatar>
            ) : (
              // Holds the gutter, so a run of replies stays in line
              // under the one carrying the face.
              <div className="w-8 shrink-0" aria-hidden />
            )
          ) : null}
          <MessageContent>
            {attributed && sender?.first ? (
              <MessageHeader>
                {message.sentByHuman ? "Your team" : agent?.botName}
              </MessageHeader>
            ) : null}
            <Bubble variant={mine ? "tinted" : "outline"}>
              <BubbleContent
                className={
                  rich ? "min-w-56" : "whitespace-pre-wrap"
                }
              >
                {/* Our own messages carry the clock inside the bubble, the
                    way every chat client does. Before the text, not after:
                    it is floated, so the last line wraps around it. The
                    other side keeps its time in the footer underneath —
                    there are no ticks to pair it with, and a bubble with
                    nothing in the corner reads as somebody else's. */}
                {mine ? (
                  <span
                    data-slot="chat-time"
                    className="flex items-center gap-0.5"
                  >
                    {timeOf(message.createdAt)}
                    {/* WhatsApp's blue, not a theme token: this is their
                        read receipt, drawn as they draw it. */}
                    <ChecksIcon className="size-3 shrink-0 text-[#53bdeb]" />
                  </span>
                ) : null}
                {rich ? (
                  <RichMessage message={rich} interactive={false} />
                ) : (
                  message.text
                )}
              </BubbleContent>
            </Bubble>
            {showFooter ? (
              <MessageFooter>
                {/* Only when the header above has not already said so:
                    a run of team replies is named once, so the later
                    ones still need marking as a person's. */}
                {teamMark ? (
                  <span className="flex items-center gap-1">
                    <UserIcon className="size-3" />
                    Your team{!mine || showLatency ? " ·" : ""}
                  </span>
                ) : null}
                {mine ? null : timeOf(message.createdAt)}
                {showLatency
                  ? `${mine ? "" : " · "}${((message.latencyMs ?? 0) / 1000).toFixed(1)}s`
                  : ""}
              </MessageFooter>
            ) : null}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  };

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller
        data-chat="whatsapp"
        className="min-h-0 min-w-0 flex-1"
      >
        <MessageScrollerViewport aria-label="Conversation">
          {/* justify-end sits a short conversation just above the composer,
              the way a chat client does; once the content overflows,
              `h-max` wins and it scrolls normally. */}
          <MessageScrollerContent
            className={cn(
              "mx-auto w-full max-w-3xl justify-end gap-4 p-4",
              contentClassName
            )}
          >
            {leading}

            {messages === undefined ? (
              <MessageScrollerItem messageId="loading">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Loading messages…
                </div>
              </MessageScrollerItem>
            ) : null}

            {messages !== undefined && messages.length === 0 && emptyState ? (
              <MessageScrollerItem messageId="empty">
                {emptyState}
              </MessageScrollerItem>
            ) : null}

            {visible.map((message, index) => {
              const previous = visible[index - 1];
              const day =
                !previous ||
                dayKeyOf(previous.createdAt) !== dayKeyOf(message.createdAt)
                  ? dayLabelOf(message.createdAt)
                  : null;
              return (
                <Fragment key={message._id}>
                  {day ? (
                    <MessageScrollerItem messageId={`day-${message._id}`}>
                      <DaySeparator label={day} />
                    </MessageScrollerItem>
                  ) : null}
                  {renderMessage(message)}
                </Fragment>
              );
            })}

            {trailing}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export { MessageScrollerItem as TranscriptItem };
