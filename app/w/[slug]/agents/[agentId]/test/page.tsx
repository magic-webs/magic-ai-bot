"use client";

import { use, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveGreeting } from "@/convex/lib/prompt";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  TranscriptItem,
  TranscriptView,
} from "@/components/transcript";
import { TypingBubble } from "@/components/typing-bubble";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  PaperPlaneRightIcon,
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  WarningIcon,
  SlidersIcon,
} from "@phosphor-icons/react";

// One browser session == one contact, so the playground behaves like a real
// returning customer across reloads. localStorage is an external store rather
// than React state, so it is read through useSyncExternalStore — that keeps the
// server snapshot null and avoids a hydration mismatch.
const sessionCache = new Map<string, string>();

function readOrCreateSession(storageKey: string): string {
  const cached = sessionCache.get(storageKey);
  if (cached) return cached;

  let existing: string | null = null;
  try {
    existing = window.localStorage.getItem(storageKey);
  } catch {
    /* private browsing or blocked site data */
  }

  if (!existing) {
    existing = `web-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(storageKey, existing);
    } catch {
      /* keep the in-memory value for this tab only */
    }
  }

  sessionCache.set(storageKey, existing);
  return existing;
}

const noopSubscribe = () => () => {};

// Generic openers that exercise the retrieval, catalogue and escalation paths.
const STARTER_PROMPTS = [
  "What do you sell?",
  "Do you deliver to my area?",
  "I need a quote",
  "I'd like to speak to someone",
];

function useSessionId(agentId: string): string | null {
  const storageKey = `magic-ai-bot:web-session:${agentId}`;
  return useSyncExternalStore(
    noopSubscribe,
    () => readOrCreateSession(storageKey),
    () => null
  );
}

export default function AgentTestPage({
  params,
}: PageProps<"/w/[slug]/agents/[agentId]/test">) {
  const { agentId } = use(params);
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const typedAgentId = agentId as Id<"agents">;

  const sessionId = useSessionId(agentId);
  const agent = useQuery(api.agents.get, { agentId: typedAgentId });
  const conversation = useQuery(
    api.conversations.findWebConversation,
    sessionId ? { agentId: typedAgentId, sessionId } : "skip"
  );
  const messages = useQuery(api.conversations.listMessages, {
    conversationId: conversation?._id,
  });
  const respond = useAction(api.engine.respondAsUser);
  const resetConversation = useMutation(api.conversations.reset);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !sessionId || sending) return;

    setInput("");
    setSending(true);
    setLastError(null);
    try {
      const result = await respond({
        agentId: typedAgentId,
        channelType: "web",
        externalId: sessionId,
        text,
      });
      if (!result.ok && result.error) setLastError(result.error);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : String(error);
      setLastError(description);
      toast.add({ title: "The agent did not reply", description, type: "error" });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  if (agent === undefined) {
    return (
      <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading agent…
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This agent no longer exists.{" "}
        <Link href={`${base}/agents`} className="underline">
          Back to agents
        </Link>
      </div>
    );
  }

  const isEmpty = (messages ?? []).length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label="Back"
            nativeButton={false}
            render={<Link href={`${base}/agents`} />}
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">
              {agent.botName}{" "}
              <span className="text-muted-foreground">· {agent.role}</span>
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Web playground — same engine that serves WhatsApp
            </p>
          </div>
          <Badge
            variant={agent.status === "active" ? "default" : "secondary"}
          >
            {agent.status}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch
              id="show-tools"
              size="sm"
              checked={showTools}
              onCheckedChange={setShowTools}
            />
            <Label htmlFor="show-tools" className="text-xs">
              Tool trace
            </Label>
          </div>
          <Button
            size="lg"
            variant="outline"
            disabled={!conversation}
            onClick={async () => {
              if (!conversation) return;
              await resetConversation({ conversationId: conversation._id });
              setLastError(null);
              toast.add({ title: "Conversation cleared", type: "success" });
            }}
          >
            <ArrowsClockwiseIcon /> Reset
          </Button>
          <Button
            size="lg"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agentId}`} />}
          >
            <SlidersIcon /> Configure
          </Button>
        </div>
      </header>

      {agent.status === "paused" ? (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>This agent is paused</AlertTitle>
            <AlertDescription>
              A paused agent refuses every turn. Set it to Draft or Active on the
              configuration page to test it.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {lastError ? (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>Last turn reported an error</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              {lastError}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <TranscriptView
        messages={messages}
        showTools={showTools}
        leading={
          <>
            <TranscriptItem messageId="greeting">
              <Message align="start">
                <MessageContent>
                  <Bubble variant="outline">
                    <BubbleContent>
                      {resolveGreeting(agent, workspace.name)}
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter>opening line</MessageFooter>
                </MessageContent>
              </Message>
            </TranscriptItem>

            {isEmpty && messages !== undefined ? (
              <TranscriptItem messageId="starters">
                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Try one
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {STARTER_PROMPTS.map((prompt) => (
                      <Button
                        key={prompt}
                        size="lg"
                        variant="outline"
                        disabled={!sessionId || sending}
                        onClick={() => void send(prompt)}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              </TranscriptItem>
            ) : null}
          </>
        }
        trailing={
          sending ? (
            <TranscriptItem messageId="typing">
              <TypingBubble label="The agent is typing" />
            </TranscriptItem>
          ) : null
        }
      />

      <div className="shrink-0 border-t p-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={input}
            disabled={!sessionId}
            placeholder="Type as a customer would — e.g. “I need 500 business cards”"
            className="resize-none"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button
            size="icon-lg"
            aria-label="Send message"
            disabled={sending || !input.trim() || !sessionId}
            onClick={() => void send()}
          >
            {sending ? <Spinner /> : <PaperPlaneRightIcon />}
          </Button>
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-xs text-muted-foreground">
          Enter to send · Shift+Enter for a new line.
        </p>
      </div>
    </div>
  );
}
