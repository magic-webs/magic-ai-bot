"use client";

import { use, useRef, useState, useSyncExternalStore } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  PaperPlaneRightIcon,
  RobotIcon,
  UserIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { toast } from "@/components/ui/toast";

// One browser == one contact, so a returning visitor keeps their conversation.
// localStorage is an external store rather than React state, so it is read
// through useSyncExternalStore — that keeps the server snapshot null and avoids
// a hydration mismatch.
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

  // Must match the `web-<alphanumeric>` shape convex/widget.ts accepts.
  if (!existing || !/^web-[a-z0-9]+$/i.test(existing)) {
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

const noopSubscribe = () => () => { };

function useSessionId(channelKey: string): string | null {
  const storageKey = `magic-ai-bot:widget-session:${channelKey}`;
  return useSyncExternalStore(
    noopSubscribe,
    () => readOrCreateSession(storageKey),
    () => null
  );
}

// The loader script drops the widget in an iframe with `?embed=1`, and owns the
// launcher button that opened it — so the in-panel close button has to ask the
// parent to collapse rather than doing it itself.
function useEmbedded(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("embed") === "1",
    () => false
  );
}

function closePanel() {
  try {
    window.parent?.postMessage({ source: "magic-ai-bot", type: "close" }, "*");
  } catch {
    /* not embedded, or a parent that will not talk to us */
  }
}

// Whichever of white or near-black stays readable on the chosen colour. The
// two contrast ratios are equal at a relative luminance of 0.179, so that is
// the crossover.
function readableOn(hex: string): string {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const value = parseInt(full.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance > 0.179 ? "#0b1c12" : "#ffffff";
}

/**
 * The `data-color` a site put on the embed snippet, if any.
 *
 * It colours the whole widget rather than only the launcher, so a site that
 * picks its own brand colour does not end up with a branded button opening a
 * green chat. Absent or malformed, the widget keeps the green palette from
 * globals.css — and only a hex literal is accepted, because the value goes
 * straight into a style attribute.
 */
// Computed once and cached. useSyncExternalStore compares snapshots by
// identity, so returning a fresh object per call would re-render forever.
let accentCache: React.CSSProperties | undefined;
let accentRead = false;

function readAccent(): React.CSSProperties | undefined {
  if (accentRead) return accentCache;
  accentRead = true;

  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get("color");
  } catch {
    return undefined;
  }
  if (!raw || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return undefined;

  accentCache = {
    "--primary": raw,
    "--primary-foreground": readableOn(raw),
    "--ring": raw,
  } as React.CSSProperties;
  return accentCache;
}

function useAccent(): React.CSSProperties | undefined {
  return useSyncExternalStore(noopSubscribe, readAccent, () => undefined);
}

// utm_name / utm_phone let a site that already knows the visitor skip the form.
// The loader forwards them from the host page.
function prefillFromQuery(): { name?: string; phone?: string } {
  if (typeof window === "undefined") return {};
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      name: params.get("utm_name") ?? undefined,
      phone: params.get("utm_phone") ?? undefined,
    };
  } catch {
    return {};
  }
}

function WidgetShell({
  title,
  embedded,
  children,
}: {
  title: string;
  embedded: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-svh w-full flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20">
          <RobotIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-medium">{title}</h1>
          <p className="truncate text-xs opacity-90">Assistant</p>
        </div>
        {embedded ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close chat"
            className="shrink-0 text-primary-foreground hover:bg-primary-foreground/20"
            onClick={closePanel}
          >
            <XIcon />
          </Button>
        ) : null}
      </header>
      {children}
    </div>
  );
}

export default function WidgetPage({
  params,
}: {
  params: Promise<{ channelKey: string }>;
}) {
  const { channelKey } = use(params);
  const sessionId = useSessionId(channelKey);
  const embedded = useEmbedded();
  const accent = useAccent();

  const widget = useQuery(api.widget.bootstrap, { channelKey });
  const session = useQuery(
    api.widget.session,
    sessionId ? { channelKey, sessionId } : "skip"
  );

  // `data-theme="widget"` swaps the accent tokens for the green palette in
  // globals.css, so the header, the outgoing bubbles and the send button all
  // follow — the widget is embedded on someone else's site and has no business
  // inheriting whichever colour the workspace console is set to.
  //
  // display:contents keeps the wrapper out of the layout while still passing the
  // custom properties down.
  const theme = (children: React.ReactNode) => (
    <div data-theme="widget" style={accent} className="contents">
      {children}
    </div>
  );

  if (widget === undefined || !sessionId || session === undefined) {
    return theme(
      <div className="flex h-svh w-full items-center justify-center bg-background p-4 text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  if (widget === null) {
    return theme(
      <div className="flex h-svh w-full items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-sm">
          <WarningIcon />
          <AlertTitle>Chat unavailable</AlertTitle>
          <AlertDescription>
            This chat widget has been removed or switched off.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Whoever is holding the conversation now — the front desk on a fresh chat,
  // the specialist it routed to afterwards.
  const title = session.agentBotName ?? widget.agent.botName;

  if (!session.registered) {
    return theme(
      <WidgetShell title={title} embedded={embedded}>
        <RegisterForm
          channelKey={channelKey}
          sessionId={sessionId}
          workspaceName={widget.workspaceName}
        />
      </WidgetShell>
    );
  }

  return theme(
    <WidgetShell title={title} embedded={embedded}>
      <WidgetChat
        channelKey={channelKey}
        sessionId={sessionId}
        greeting={widget.agent.greeting}
        messages={session.messages}
      />
    </WidgetShell>
  );
}

function RegisterForm({
  channelKey,
  sessionId,
  workspaceName,
}: {
  channelKey: string;
  sessionId: string;
  workspaceName: string;
}) {
  const register = useMutation(api.widget.register);
  const [form, setForm] = useState(() => {
    const prefill = prefillFromQuery();
    return { name: prefill.name ?? "", phone: prefill.phone ?? "" };
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast.add({ title: "Please fill in both fields", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      await register({
        channelKey,
        sessionId,
        name: form.name.trim(),
        phone: form.phone.trim(),
      });
      // No local flag to set: `widget.session` now reports this visitor as
      // registered, and the subscription re-renders into the chat by itself.
    } catch (error) {
      toast.add({
        title: "Could not start the chat",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col justify-center overflow-y-auto p-5">
      <div className="mx-auto w-full max-w-sm">
        <h2 className="text-center text-lg font-semibold">
          Chat with {workspaceName}
        </h2>
        <p className="mt-1 mb-5 text-center text-sm text-muted-foreground">
          Leave your name and number and we&apos;ll pick up right away.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="widget-name">Name</Label>
            <Input
              id="widget-name"
              autoComplete="name"
              placeholder="Your name"
              value={form.name}
              disabled={submitting}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="widget-phone">Phone number</Label>
            <Input
              id="widget-phone"
              type="tel"
              autoComplete="tel"
              placeholder="Your phone number"
              value={form.phone}
              disabled={submitting}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: event.target.value }))
              }
            />
          </div>
          <Button type="submit" className="mt-1 w-full" disabled={submitting}>
            {submitting ? <Spinner /> : "Start chat"}
          </Button>
        </form>
      </div>
    </div>
  );
}

type WidgetMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  botName: string | null;
  createdAt: number;
};

function WidgetChat({
  channelKey,
  sessionId,
  greeting,
  messages,
}: {
  channelKey: string;
  sessionId: string;
  greeting: string;
  messages: WidgetMessage[];
}) {
  const respond = useAction(api.engine.respondFromWidget);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    try {
      const result = await respond({ channelKey, sessionId, text });
      if (!result.delivered) {
        // Nothing was recorded, so hand the text back rather than losing it.
        setInput(text);
        toast.add({
          title: "Not sent",
          description: result.error,
          type: "error",
        });
      }
      // A delivered message that failed to generate a proper answer needs no
      // toast: it is in the transcript, and so is the apology. Offering the
      // text back would invite the visitor to send it twice.
    } catch (error) {
      setInput(text);
      toast.add({
        title: "Could not send",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 min-w-0 flex-1">
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent className="mx-auto w-full max-w-2xl justify-end gap-3 p-4">
              <MessageScrollerItem messageId="greeting">
                <Message align="start">
                  <MessageAvatar>
                    <RobotIcon className="size-4" />
                  </MessageAvatar>
                  <MessageContent>
                    <Bubble variant="muted">
                      <BubbleContent className="whitespace-pre-wrap">
                        {greeting}
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              {messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
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
                        {/* Named once the front desk has routed the chat, so
                            the visitor can see who they are talking to now. */}
                        {!isUser && message.botName ? (
                          <MessageFooter>{message.botName}</MessageFooter>
                        ) : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}

              {sending ? (
                <MessageScrollerItem messageId="typing">
                  <Message align="start">
                    <MessageAvatar>
                      <RobotIcon className="size-4" />
                    </MessageAvatar>
                    <MessageContent>
                      <Bubble variant="muted">
                        <BubbleContent className="flex items-center gap-2">
                          <Spinner /> typing…
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="shrink-0 border-t p-3">
        <div className="flex w-full items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder="Type a message…"
            className="min-h-11 resize-none"
            maxLength={2000}
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
    </>
  );
}
