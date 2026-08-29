"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
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
  RobotIcon,
  UserIcon,
  WrenchIcon,
  CaretRightIcon,
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
          <Button variant="ghost" size="xs" className="text-muted-foreground">
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
// The message list. Shared by the agent playground and the conversations
// reader so both render bubbles, tool traces and errors identically.
// ---------------------------------------------------------------------------

export function TranscriptView({
  messages,
  showTools = true,
  leading,
  trailing,
  emptyState,
  contentClassName,
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
}) {
  const visible = (messages ?? []).filter((message) =>
    message.kind === "tool" ? showTools : true
  );

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 min-w-0 flex-1">
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
                    className="mx-auto w-full"
                  >
                    <ToolTrace message={message} />
                  </MessageScrollerItem>
                );
              }

              if (message.kind === "error") {
                return (
                  <MessageScrollerItem
                    key={message._id}
                    messageId={message._id}
                  >
                    <Bubble variant="destructive" align="start">
                      <BubbleContent className="font-mono text-xs">
                        {message.text}
                      </BubbleContent>
                    </Bubble>
                  </MessageScrollerItem>
                );
              }

              const isUser = message.role === "user";
              return (
                <MessageScrollerItem key={message._id} messageId={message._id}>
                  <Message align={isUser ? "end" : "start"}>
                    <MessageAvatar>
                      {isUser ? (
                        <UserIcon className="size-4" />
                      ) : (
                        <RobotIcon className="size-4" />
                      )}
                    </MessageAvatar>
                    <MessageContent>
                      <Bubble variant={isUser ? "default" : "muted"}>
                        <BubbleContent className="whitespace-pre-wrap">
                          {message.text}
                        </BubbleContent>
                      </Bubble>
                      <MessageFooter>
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
