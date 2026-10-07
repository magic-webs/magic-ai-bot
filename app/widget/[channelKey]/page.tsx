"use client";

import {
  Fragment,
  use,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowRightIcon,
  PaperPlaneRightIcon,
  UserIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
// The same agent icon the console's sidebar carries, so the chat a customer
// sees and the Agents page a workspace edits are one product.
import { HugeiconsIcon } from "@hugeicons/react";
import { Robot01Icon } from "@hugeicons/core-free-icons";
import { toast } from "@/components/ui/toast";
import {
  MetaSpacer,
  MetaStamp,
  RichMessage,
  parseRichPayload,
  quotedChoice,
  type ChatMeta,
} from "@/components/rich-message";
import { WhatsAppText, isJumboEmoji } from "@/components/whatsapp-text";
import { DeliveryTicks } from "@/components/delivery-ticks";
import type { Outbound } from "@/convex/lib/whatsappSend";
import { TypingBubble } from "@/components/typing-bubble";
import {
  DEFAULT_ISO,
  DIAL_CODES,
  dialCodeFor,
  guessIso,
  isoFromLocale,
  splitDialCode,
  stripDialCode,
} from "@/lib/dial-codes";
import { friendlyError } from "@/lib/errors";

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

// WhatsApp stamps every bubble with a short local clock time, no date.
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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

// On <html> as well as the wrapper, so portalled sheets, popups and toasts
// take the widget palette instead of the console's.
function useWidgetDocument(
  accent: React.CSSProperties | undefined,
  embedded: boolean
) {
  useEffect(() => {
    const root = document.documentElement;
    const tokens = Object.entries(accent ?? {});
    root.dataset.theme = "widget";
    for (const [name, value] of tokens) root.style.setProperty(name, String(value));
    return () => {
      delete root.dataset.theme;
      for (const [name] of tokens) root.style.removeProperty(name);
    };
  }, [accent]);

  useEffect(() => {
    if (!embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="listbox"]')) return;
      closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded]);
}

/**
 * Which country the code select starts on, from the browser locale.
 *
 * Through useSyncExternalStore for the same reason the accent and the stored
 * session id are: the server has no `navigator`, so reading it in a `useState`
 * initialiser would render the default into the HTML and something else on
 * hydration. Here the server snapshot is the default by construction and React
 * re-renders into the real guess after hydrating, with no mismatch and no
 * effect setting state — which the lint rules forbid anyway.
 */
function useGuessedIso(): string {
  return useSyncExternalStore(noopSubscribe, guessIso, () => DEFAULT_ISO);
}

/**
 * The country code beside the phone field.
 *
 * The trigger shows the flag and the code alone — it sits inside the phone
 * input's own box and has to leave room for the number — while the list names
 * every country, since "+673" identifies nothing on its own. Base UI's
 * `Select.Value` takes a render function for exactly this, which is why this
 * uses the primitives rather than the `SelectField` wrapper every dashboard
 * form uses.
 */
function DialCodeSelect({
  iso,
  onChange,
  disabled,
}: {
  iso: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={iso}
      onValueChange={(next) => onChange(String(next))}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label="Country code"
        // `data-[size=default]:h-full`, not a bare `h-full`: SelectTrigger's
        // own height is written `data-[size=default]:h-8`, and tailwind-merge
        // only drops a class when the variants match too — so an unqualified
        // one is kept alongside it and then loses to the attribute selector on
        // specificity. The trigger would sit 8 units tall inside an 11-unit
        // row, which is the same trap the agent map's inspector documents.
        className="w-auto shrink-0 gap-1 rounded-none border-0 bg-transparent pr-2 pl-3 shadow-none focus-visible:ring-0 data-[size=default]:h-full dark:bg-transparent dark:hover:bg-transparent"
      >
        <SelectValue>
          {(value) => {
            const entry = dialCodeFor(String(value));
            return (
              <span className="flex items-center gap-1.5 text-sm">
                <span aria-hidden>{entry.flag}</span>
                <span className="tabular-nums">{entry.dial}</span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      {/* Bounded and scrolling: the list is every country, and an unbounded
          popup would run off both ends of a 620px panel. */}
      <SelectContent className="max-h-72 w-auto min-w-64">
        {DIAL_CODES.map((entry) => (
          <SelectItem key={entry.iso} value={entry.iso}>
            <span className="flex w-full items-center gap-2">
              <span aria-hidden>{entry.flag}</span>
              <span className="flex-1 truncate">{entry.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {entry.dial}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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

/**
 * The attribution line, linked to the product's own site.
 *
 * A plain anchor with target="_blank", not next/link: the widget is an iframe
 * on someone else's page, so a client-side route would load the landing page
 * inside the chat panel. rel="noopener" because the new tab must not get a
 * handle on this window.
 */
function PoweredBy({ className }: { className?: string }) {
  return (
    <p className={`text-center text-[10px] text-muted-foreground ${className ?? ""}`}>
      <a
        href="/?utm_source=widget"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Powered by Magic Agent
      </a>
    </p>
  );
}

function WidgetShell({
  title,
  logoSrc,
  embedded,
  typing = false,
  children,
}: {
  title: string;
  /** The company's logo, drawn in place of the robot when it has one. */
  logoSrc: string | null;
  embedded: boolean;
  typing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-svh w-full flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-black/10 bg-primary px-4 py-3 text-primary-foreground">
        <div className="relative shrink-0">
          {logoSrc ? (
            // White, not the translucent tint the robot sits on: a logo is
            // drawn for a light ground, and over the site's primary colour a
            // dark wordmark would disappear. Contained so a wide one fits.
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-primary-foreground/25">
              {/* eslint-disable-next-line @next/next/no-img-element -- any host */}
              <img
                src={logoSrc}
                alt=""
                className="size-full object-contain p-1"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full bg-primary-foreground/20 ring-1 ring-primary-foreground/25">
              <HugeiconsIcon icon={Robot01Icon} size={20} strokeWidth={2} />
            </div>
          )}
          {/* Says someone is there before a word has been typed. The ring is
              --primary, so it reads as a hole punched in the header whatever
              colour the site chose. */}
          <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-emerald-400 ring-2 ring-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-xs opacity-90" aria-live="polite">
            {typing ? "typing…" : "Online · replies instantly"}
          </p>
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
  const [typing, setTyping] = useState(false);
  useWidgetDocument(accent, embedded);

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
      <WidgetShell title={title} logoSrc={widget.logoSrc} embedded={embedded}>
        <RegisterForm
          channelKey={channelKey}
          sessionId={sessionId}
          workspaceName={widget.workspaceName}
          defaultIso={isoFromLocale(widget.locale)}
        />
      </WidgetShell>
    );
  }

  return theme(
    <WidgetShell
      title={title}
      logoSrc={widget.logoSrc}
      embedded={embedded}
      typing={typing}
    >
      <WidgetChat
        channelKey={channelKey}
        sessionId={sessionId}
        title={title}
        greeting={widget.agent.greeting}
        messages={session.messages}
        onTyping={setTyping}
      />
    </WidgetShell>
  );
}

function RegisterForm({
  channelKey,
  sessionId,
  workspaceName,
  defaultIso,
}: {
  channelKey: string;
  sessionId: string;
  workspaceName: string;
  /** The country the company profile's locale names, which outranks the browser's. */
  defaultIso: string | null;
}) {
  const register = useMutation(api.widget.register);
  const guessed = useGuessedIso();
  const [form, setForm] = useState(() => {
    const prefill = prefillFromQuery();
    // A prefilled number may already carry its country code, in which case the
    // select should open on that country rather than making the visitor
    // reconcile "+44" in the box with "🇮🇳 +91" beside it.
    const split = splitDialCode(prefill.phone ?? "");
    return {
      name: prefill.name ?? "",
      phone: split.rest,
      // Null until either the prefill says so or the visitor picks: the guess
      // is not state, and storing it here would freeze whatever the server
      // rendered before the browser locale was readable.
      iso: prefill.phone ? split.iso : null,
    };
  });
  const [submitting, setSubmitting] = useState(false);

  const iso = form.iso ?? defaultIso ?? guessed;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast.add({ title: "Please fill in both fields", type: "error" });
      return;
    }
    const digits = stripDialCode(form.phone).replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 15) {
      toast.add({ title: "Enter a valid phone number", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      await register({
        channelKey,
        sessionId,
        name: form.name.trim(),
        // Stored in full, with the code: the number is what WhatsApp dials and
        // what the team reads off the contacts table, and neither can do
        // anything with a local number whose country is only in the widget.
        phone: `${dialCodeFor(iso).dial} ${stripDialCode(form.phone)}`,
      });
      // No local flag to set: `widget.session` now reports this visitor as
      // registered, and the subscription re-renders into the chat by itself.
    } catch (error) {
      toast.add({
        title: "Could not start the chat",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // m-auto rather than justify-center: auto margins centre the card on a tall
  // phone screen but still let it scroll when the keyboard halves the panel,
  // where justify-center would clip the top of the form instead.
  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-linear-to-b from-primary/8 via-background to-background">
      <div className="m-auto w-full max-w-sm px-5 py-5 duration-500 animate-in fade-in slide-in-from-bottom-2">
        <div className="flex flex-col items-center text-center">
          {/* The illustration carries its own greeting and "Quick responses"
              bubbles, which is why neither is repeated below it. Sized in vh
              as well as px: the panel is 620px on a desktop and the whole
              screen on a phone, and a fixed-height hero either crowds the
              form on the short one or looks lost on the tall one. */}
          <Image
            src="/images/web-widget-agent.png"
            alt=""
            width={1240}
            height={1268}
            priority
            className="mb-2 h-auto w-[min(12rem,22vh)] max-w-full select-none"
          />
          <h2 className="text-xl font-semibold tracking-tight">
            Chat with {workspaceName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Leave your name and number and we&apos;ll pick up right away.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="mt-5 flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm"
        >
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="widget-name"
              className="text-xs text-muted-foreground"
            >
              Name
            </Label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="widget-name"
                autoComplete="name"
                placeholder="Your name"
                className="h-11 rounded-xl pl-9"
                value={form.name}
                disabled={submitting}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="widget-phone"
              className="text-xs text-muted-foreground"
            >
              Phone number
            </Label>
            {/* The select and the input read as one control: the border and
                the rounding are on this row, and both children give up their
                own so the seam between them is a single divider. focus-within
                moves the input's focus ring out to the whole group, which is
                what stops a focused number field from looking detached from
                the code beside it. */}
            <div className="flex h-11 items-stretch overflow-hidden rounded-xl border bg-transparent transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              <DialCodeSelect
                iso={iso}
                disabled={submitting}
                onChange={(iso) => setForm((prev) => ({ ...prev, iso }))}
              />
              <span aria-hidden className="my-2 w-px shrink-0 bg-border" />
              <Input
                id="widget-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="Phone number"
                className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
                value={form.phone}
                disabled={submitting}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, phone: event.target.value }))
                }
              />
            </div>
          </div>
          <Button
            type="submit"
            size="lg"
            className="mt-1 h-11 w-full gap-2 rounded-xl text-sm font-semibold shadow-sm shadow-primary/20"
            disabled={submitting}
          >
            {submitting ? (
              <Spinner />
            ) : (
              <>
                Start chat
                <ArrowRightIcon weight="bold" />
              </>
            )}
          </Button>
        </form>

        <PoweredBy className="mt-4" />
      </div>
    </div>
  );
}


type WidgetMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** JSON of the rich payload, when the agent sent more than prose. */
  payload: string | null;
  botName: string | null;
  createdAt: number;
};

type Outgoing = {
  key: string;
  text: string;
  status: "queued" | "sending" | "sent" | "failed";
  at: number;
  /** The newest transcript time when it was sent; its echo is newer than this. */
  after: number;
  error?: string;
};

type Quote = { author: string; body: string };

type Row =
  | { type: "greeting"; key: string; at: number }
  | {
      type: "message";
      key: string;
      at: number;
      message: WidgetMessage;
      rich: Outbound | null;
      quote: Quote | null;
      read: boolean;
    }
  | { type: "outgoing"; key: string; at: number; item: Outgoing; quote: Quote | null };

let outgoingSeq = 0;

// Each outgoing message is hidden once the transcript holds its echo, matched
// oldest first so two identical messages each claim their own.
function unconfirmed(messages: WidgetMessage[], outbox: Outgoing[]): Outgoing[] {
  const claimed = new Set<string>();
  return outbox.filter((item) => {
    const echo = messages.find(
      (m) =>
        m.role === "user" &&
        !claimed.has(m.id) &&
        m.createdAt > item.after &&
        m.text.trim() === item.text
    );
    if (echo) claimed.add(echo.id);
    return !echo;
  });
}

function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(at: number, now: number): string {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return day.toLocaleDateString(undefined, { weekday: "long" });
  return day.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function DayChip({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-lg bg-(--chat-chip) px-3 py-1 text-xs text-muted-foreground shadow-xs">
        {label}
      </span>
    </div>
  );
}

function QuoteBlock({ quote }: { quote: Quote }) {
  return (
    <div className="-mx-1.5 -mt-0.5 mb-1 flex overflow-hidden rounded-md bg-foreground/6 whitespace-normal">
      <span className="w-1 shrink-0 bg-primary" />
      <div className="min-w-0 px-2 py-1.5">
        <p className="truncate text-xs font-semibold text-primary">{quote.author}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{quote.body}</p>
      </div>
    </div>
  );
}

function ChatBubble({
  mine,
  text,
  rich,
  meta,
  quote,
  onPick,
  footer,
}: {
  mine: boolean;
  text: string;
  rich: Outbound | null;
  meta: ChatMeta;
  quote: Quote | null;
  onPick: (text: string) => void;
  footer?: React.ReactNode;
}) {
  if (!rich && !quote && isJumboEmoji(text)) {
    return (
      <Message align={mine ? "end" : "start"}>
        <MessageContent>
          <div
            data-slot="chat-jumbo"
            className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}
          >
            <span className="text-5xl leading-tight">{text.trim()}</span>
            <MetaStamp meta={meta} />
          </div>
          {footer}
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message align={mine ? "end" : "start"}>
      <MessageContent>
        <Bubble variant={mine ? "tinted" : "outline"}>
          <BubbleContent className={rich ? "min-w-0" : "whitespace-pre-wrap"}>
            {quote ? <QuoteBlock quote={quote} /> : null}
            {rich ? (
              <RichMessage message={rich} onPick={onPick} meta={meta} />
            ) : (
              <>
                <WhatsAppText text={text}>
                  <MetaSpacer meta={meta} />
                </WhatsAppText>
                <MetaStamp meta={meta} mode="pin" />
              </>
            )}
          </BubbleContent>
        </Bubble>
        {footer}
      </MessageContent>
    </Message>
  );
}

function FollowOutbox({ signal }: { signal: string | undefined }) {
  const { scrollToEnd } = useMessageScroller();
  const handled = useRef(signal);
  useEffect(() => {
    if (!signal || signal === handled.current) return;
    handled.current = signal;
    const frame = requestAnimationFrame(() => scrollToEnd());
    return () => cancelAnimationFrame(frame);
  }, [signal, scrollToEnd]);
  return null;
}

function Composer({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="shrink-0 bg-(--chat-ground) px-2 pt-1.5 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
      <form
        className="mx-auto flex w-full max-w-2xl items-end gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-3xl bg-background px-4 shadow-xs">
          <textarea
            rows={1}
            value={value}
            placeholder="Message"
            aria-label="Message"
            maxLength={2000}
            autoFocus
            className="field-sizing-content max-h-32 min-h-0 w-full resize-none bg-transparent py-2.5 text-[0.9375rem] leading-snug outline-none placeholder:text-muted-foreground"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                onSend();
              }
            }}
          />
        </div>
        <button
          type="submit"
          aria-label="Send message"
          disabled={!value.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-xs transition-[opacity,transform] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:opacity-60"
        >
          <PaperPlaneRightIcon weight="fill" className="size-5" />
        </button>
      </form>
      <PoweredBy className="pt-1" />
    </div>
  );
}

function WidgetChat({
  channelKey,
  sessionId,
  title,
  greeting,
  messages,
  onTyping,
}: {
  channelKey: string;
  sessionId: string;
  title: string;
  greeting: string;
  messages: WidgetMessage[];
  onTyping: (typing: boolean) => void;
}) {
  const respond = useAction(api.engine.respondFromWidget);

  const [input, setInput] = useState("");
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [openedAt] = useState(() => Date.now());
  // One turn at a time, in order: two racing turns would interleave replies.
  const chain = useRef<Promise<void>>(Promise.resolve());

  const patch = (key: string, next: Partial<Outgoing>) =>
    setOutbox((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...next } : item))
    );

  const deliver = (key: string, text: string) => {
    chain.current = chain.current.then(async () => {
      patch(key, { status: "sending", error: undefined });
      onTyping(true);
      try {
        const result = await respond({ channelKey, sessionId, text });
        if (result.delivered) {
          patch(key, { status: "sent" });
        } else {
          patch(key, { status: "failed", error: result.error });
          toast.add({ title: "Not sent", description: result.error, type: "error" });
        }
      } catch (error) {
        const message = friendlyError(error);
        patch(key, { status: "failed", error: message });
        toast.add({ title: "Could not send", description: message, type: "error" });
      } finally {
        onTyping(false);
      }
    });
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const key = `out-${++outgoingSeq}`;
    const after = messages.at(-1)?.createdAt ?? 0;
    setOutbox((prev) => [
      ...unconfirmed(messages, prev),
      { key, text, status: "queued", at: Date.now(), after },
    ]);
    deliver(key, text);
  };

  const retry = (item: Outgoing) => {
    patch(item.key, { status: "queued", error: undefined });
    deliver(item.key, item.text);
  };

  const pending = unconfirmed(messages, outbox);
  const typing = outbox.some((item) => item.status === "sending");

  const rows: Row[] = [
    { type: "greeting", key: "greeting", at: messages[0]?.createdAt ?? openedAt },
  ];
  const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
  let prompt: { rich: Outbound | null; author: string } = { rich: null, author: title };
  const quoteFor = (text: string): Quote | null => {
    const hit = quotedChoice(prompt.rich, text.trim());
    return hit ? { author: prompt.author, body: hit.body } : null;
  };
  messages.forEach((message, index) => {
    const rich = parseRichPayload(message.payload);
    const assistant = message.role === "assistant";
    rows.push({
      type: "message",
      key: message.id,
      at: message.createdAt,
      message,
      rich,
      quote: assistant ? null : quoteFor(message.text),
      read: index < lastAssistant,
    });
    if (assistant) prompt = { rich, author: message.botName ?? title };
  });
  for (const item of pending) {
    rows.push({ type: "outgoing", key: item.key, at: item.at, item, quote: quoteFor(item.text) });
  }

  let lastDay = "";

  return (
    <div data-chat="whatsapp" className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 min-w-0 flex-1">
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent className="mx-auto w-full max-w-2xl justify-end gap-1.5 px-3 py-3">
              {rows.map((row) => {
                const day = dayOf(row.at);
                const chip =
                  day !== lastDay ? (
                    <MessageScrollerItem messageId={`day-${day}`}>
                      <DayChip label={dayLabel(row.at, openedAt)} />
                    </MessageScrollerItem>
                  ) : null;
                lastDay = day;

                let body: React.ReactNode;
                if (row.type === "greeting") {
                  body = (
                    <ChatBubble
                      mine={false}
                      text={greeting}
                      rich={null}
                      quote={null}
                      meta={{ time: clockTime(row.at) }}
                      onPick={send}
                    />
                  );
                } else if (row.type === "message") {
                  const mine = row.message.role === "user";
                  body = (
                    <ChatBubble
                      mine={mine}
                      text={row.message.text}
                      rich={row.rich}
                      quote={row.quote}
                      onPick={send}
                      meta={{
                        time: clockTime(row.at),
                        ticks: mine ? (
                          <DeliveryTicks
                            status={row.read ? "read" : "delivered"}
                            className="size-3.5"
                          />
                        ) : undefined,
                      }}
                    />
                  );
                } else {
                  const { item } = row;
                  body = (
                    <ChatBubble
                      mine
                      text={item.text}
                      rich={null}
                      quote={row.quote}
                      onPick={send}
                      meta={{
                        time: clockTime(item.at),
                        ticks: (
                          <DeliveryTicks
                            status={
                              item.status === "failed"
                                ? "failed"
                                : item.status === "sent"
                                  ? "sent"
                                  : "pending"
                            }
                            error={item.error}
                            className="size-3.5"
                          />
                        ),
                      }}
                      footer={
                        item.status === "failed" ? (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-[0.6875rem] font-medium text-destructive hover:underline"
                            onClick={() => retry(item)}
                          >
                            <WarningCircleIcon weight="fill" className="size-3.5" />
                            Not sent · Tap to retry
                          </button>
                        ) : null
                      }
                    />
                  );
                }

                return (
                  <Fragment key={row.key}>
                    {chip}
                    <MessageScrollerItem messageId={row.key}>{body}</MessageScrollerItem>
                  </Fragment>
                );
              })}

              {typing ? (
                <MessageScrollerItem messageId="typing">
                  <TypingBubble />
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
        <FollowOutbox signal={outbox.at(-1)?.key} />
        <Composer
          value={input}
          onChange={setInput}
          onSend={() => {
            if (!input.trim()) return;
            setInput("");
            send(input);
          }}
        />
      </MessageScrollerProvider>
    </div>
  );
}
