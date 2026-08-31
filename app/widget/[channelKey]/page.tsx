"use client";

import { use, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveGreeting } from "@/convex/lib/prompt";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import { TranscriptItem, TranscriptView } from "@/components/transcript";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  PaperPlaneRightIcon,
  RobotIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { toast } from "@/components/ui/toast";

const sessionCache = new Map<string, string>();

function readOrCreateSession(storageKey: string): string {
  const cached = sessionCache.get(storageKey);
  if (cached) return cached;

  let existing: string | null = null;
  try {
    existing = window.localStorage.getItem(storageKey);
  } catch {}

  if (!existing) {
    existing = `web-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(storageKey, existing);
    } catch {}
  }

  sessionCache.set(storageKey, existing);
  return existing;
}

const noopSubscribe = () => () => {};

function useSessionId(channelKey: string): string | null {
  const storageKey = `magic-ai-bot:widget-session:${channelKey}`;
  return useSyncExternalStore(
    noopSubscribe,
    () => readOrCreateSession(storageKey),
    () => null
  );
}

export default function WidgetPage({
  params,
}: {
  params: Promise<{ channelKey: string }>;
}) {
  const { channelKey } = use(params);
  const sessionId = useSessionId(channelKey);

  // We need to resolve the channel and agent info
  // Since resolveByKey is an internalQuery, we should use a public query for the widget
  const channelData = useQuery(api.channels.getWidgetData, { channelKey });
  const registerContact = useMutation(api.contacts.registerWidgetContact);

  const [hasRegistered, setHasRegistered] = useState(false);
  const [checkingParams, setCheckingParams] = useState(true);

  const [form, setForm] = useState({ name: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sessionId || channelData === undefined) return;

    if (channelData === null) {
      setCheckingParams(false);
      return;
    }

    const queryParams = new URLSearchParams(window.location.search);
    const utmName = queryParams.get("utm_name");
    const utmPhone = queryParams.get("utm_phone");

    const checkRegistration = async () => {
      // Check if this session is already registered
      let registered = false;
      try {
        const isReg = window.localStorage.getItem(`magic-ai-bot:widget-registered:${sessionId}`);
        if (isReg === "true") {
          registered = true;
        }
      } catch {}

      if (registered) {
        setHasRegistered(true);
        setCheckingParams(false);
        return;
      }

      if (utmName || utmPhone) {
        // Auto-register using UTM params
        try {
          await registerContact({
            workspaceId: channelData.workspaceId,
            externalId: sessionId,
            channelType: "web",
            name: utmName || undefined,
            phone: utmPhone || undefined,
          });
          try {
            window.localStorage.setItem(`magic-ai-bot:widget-registered:${sessionId}`, "true");
          } catch {}
          setHasRegistered(true);
        } catch (e) {
          console.error("Failed to auto-register contact", e);
        }
      }

      setCheckingParams(false);
    };

    checkRegistration();
  }, [sessionId, channelData, registerContact]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !channelData) return;

    if (!form.name.trim() || !form.phone.trim()) {
      toast.add({ title: "Please fill in all fields", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      await registerContact({
        workspaceId: channelData.workspaceId,
        externalId: sessionId,
        channelType: "web",
        name: form.name.trim(),
        phone: form.phone.trim(),
      });
      try {
        window.localStorage.setItem(`magic-ai-bot:widget-registered:${sessionId}`, "true");
      } catch {}
      setHasRegistered(true);
    } catch (error) {
      toast.add({
        title: "Could not start chat",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (channelData === undefined || checkingParams) {
    return (
      <div className="flex h-svh w-full items-center justify-center bg-background p-4 text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  if (channelData === null) {
    return (
      <div className="flex h-svh w-full items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-sm">
          <WarningIcon />
          <AlertTitle>Widget not found</AlertTitle>
          <AlertDescription>
            This chat widget is invalid or has been removed.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasRegistered) {
    return (
      <div className="flex h-svh w-full flex-col bg-background">
        <header className="flex shrink-0 flex-col items-center justify-center gap-1 border-b bg-primary p-6 text-primary-foreground">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary-foreground/20">
            <RobotIcon className="size-6" />
          </div>
          <h1 className="mt-2 text-lg font-medium">{channelData.agent.botName}</h1>
          <p className="text-center text-sm opacity-90">{channelData.agent.role}</p>
        </header>
        <div className="flex flex-1 flex-col justify-center p-6">
          <div className="mx-auto w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-center text-lg font-semibold">Start a conversation</h2>
            <p className="mb-6 text-center text-sm text-muted-foreground">
              Please let us know who we are talking to.
            </p>
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Jane Doe"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={submitting}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  placeholder="+1 555 123 4567"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  disabled={submitting}
                />
              </div>
              <Button type="submit" className="mt-2 w-full" disabled={submitting}>
                {submitting ? <Spinner /> : "Start chat"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <WidgetChat
      channelData={channelData}
      sessionId={sessionId!}
    />
  );
}

function WidgetChat({
  channelData,
  sessionId,
}: {
  channelData: any;
  sessionId: string;
}) {
  const agentId = channelData.agent._id;
  const conversation = useQuery(
    api.conversations.findWebConversation,
    { agentId, sessionId }
  );
  const messages = useQuery(api.conversations.listMessages, {
    conversationId: conversation?._id,
  });
  const respond = useAction(api.engine.respondAsUser);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || !sessionId || sending) return;

    setInput("");
    setSending(true);
    try {
      const result = await respond({
        agentId,
        channelType: "web",
        externalId: sessionId,
        text,
      });
      if (!result.ok && result.error) {
        toast.add({ title: "Failed to send", description: result.error, type: "error" });
      }
    } catch (error) {
      toast.add({
        title: "Could not send message",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const isEmpty = (messages ?? []).length === 0;

  return (
    <div className="flex h-svh w-full flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary-foreground/20">
          <RobotIcon className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-medium">{channelData.agent.botName}</h1>
          <p className="truncate text-xs opacity-90">{channelData.agent.role}</p>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <TranscriptView
          messages={messages}
          showTools={false}
          leading={
            <>
              <TranscriptItem messageId="greeting">
                <Message align="start">
                  <MessageAvatar>
                    <RobotIcon className="size-4" />
                  </MessageAvatar>
                  <MessageContent>
                    <Bubble variant="muted">
                      <BubbleContent>
                        {resolveGreeting(channelData.agent, channelData.workspaceName)}
                      </BubbleContent>
                    </Bubble>
                    <MessageFooter>opening line</MessageFooter>
                  </MessageContent>
                </Message>
              </TranscriptItem>
            </>
          }
          trailing={
            sending ? (
              <TranscriptItem messageId="typing">
                <Message align="start">
                  <MessageAvatar>
                    <RobotIcon className="size-4" />
                  </MessageAvatar>
                  <MessageContent>
                    <Bubble variant="muted">
                      <BubbleContent className="flex items-center gap-2">
                        <Spinner /> thinking…
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </TranscriptItem>
            ) : null
          }
        />
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex w-full items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder="Type a message..."
            className="min-h-[44px] resize-none"
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
            disabled={sending || !input.trim()}
            onClick={() => void send()}
            className="shrink-0"
          >
            {sending ? <Spinner /> : <PaperPlaneRightIcon />}
          </Button>
        </div>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Powered by Magic AI Bot
        </p>
      </div>
    </div>
  );
}
