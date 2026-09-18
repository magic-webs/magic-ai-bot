"use client";

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
  ClipboardTextIcon,
  UserIcon,
} from "@phosphor-icons/react";

function timeOf(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    <div className="mx-auto flex w-full max-w-xl gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
      <ClipboardTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Internal note · not sent to the customer
        </p>
        <p className="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">
          {message.text}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground/70">
        {timeOf(message.createdAt)}
      </span>
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

            {visible.map((message) => {
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
                          {rich ? (
                            <RichMessage message={rich} interactive={false} />
                          ) : (
                            message.text
                          )}
                        </BubbleContent>
                      </Bubble>
                      <MessageFooter>
                        {/* Only when the header above has not already said so:
                            a run of team replies is named once, so the later
                            ones still need marking as a person's. */}
                        {message.sentByHuman && !sender?.first ? (
                          <span className="flex items-center gap-1">
                            <UserIcon className="size-3" />
                            Your team ·
                          </span>
                        ) : null}
                        {timeOf(message.createdAt)}
                        {message.latencyMs
                          ? ` · ${(message.latencyMs / 1000).toFixed(1)}s`
                          : ""}
                      </MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
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
