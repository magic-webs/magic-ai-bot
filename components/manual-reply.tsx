"use client";

import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Countdown, replyWindow, useNow } from "@/components/handback-timer";
import {
  HANDBACK_AFTER_MINUTES,
  PAUSE_CHOICES_MINUTES,
  pauseLabel,
} from "@/convex/lib/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PaperPlaneRightIcon,
  PauseIcon,
  LightningIcon,
  SmileyIcon,
  TimerIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * The pause the last reply used, remembered per browser — a convenience for
 * whoever sits at this screen, not a workspace setting, so a thread two people
 * are working does not flip between their preferences. Every read and write
 * is guarded: storage can be blocked, and the default is a fine answer.
 */
const PAUSE_KEY = "magic-agent.reply-pause-minutes";

function storedPause(): number {
  try {
    const value = Number(window.localStorage.getItem(PAUSE_KEY));
    return (PAUSE_CHOICES_MINUTES as readonly number[]).includes(value)
      ? value
      : HANDBACK_AFTER_MINUTES;
  } catch {
    return HANDBACK_AFTER_MINUTES;
  }
}

function storePause(minutes: number) {
  try {
    window.localStorage.setItem(PAUSE_KEY, String(minutes));
  } catch {
    // Remembered for this page only, then.
  }
}

const PAUSE_OPTIONS = PAUSE_CHOICES_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: pauseLabel(minutes),
}));

/**
 * The emoji a sales desk actually reaches for, in the order it reaches for
 * them. A picker is a grid of forty, not a search over three thousand — every
 * one of these is a click, and a library to do that would be a download.
 */
const EMOJI = [
  "👍", "🙏", "😊", "😀", "🎉", "✅", "❤️", "🔥",
  "👌", "🙌", "💪", "✨", "😅", "😍", "🤝", "👏",
  "📦", "🚚", "🧾", "💰", "🏷️", "📸", "📍", "📞",
  "⏰", "📅", "⚡", "⭐", "❓", "❗", "😢", "😡",
] as const;

// ---------------------------------------------------------------------------
// Insert a product, by name and price, into whatever is already typed.
//
// The lightning button: the thing a person answering a sales thread types
// most, and the thing they are most likely to get wrong from memory. Prices
// come off the catalogue record, so a quote sent by hand says what the agent
// would have said.
// ---------------------------------------------------------------------------

function ProductInsert({ onPick }: { onPick: (line: string) => void }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  // Only once it has been opened. A subscription to the whole catalogue on
  // every conversation anybody reads is a lot of nothing most of the time.
  const [wanted, setWanted] = useState(false);
  const [term, setTerm] = useState("");

  const products = useQuery(
    api.products.listByWorkspace,
    wanted ? { workspaceId: workspace._id } : "skip"
  );

  const money = (amount: number) => {
    try {
      return new Intl.NumberFormat(workspace.locale, {
        style: "currency",
        currency: workspace.currency,
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
    } catch {
      // An unknown currency code should not take the composer down.
      return `${workspace.currency} ${amount}`;
    }
  };

  const search = term.trim().toLowerCase();
  const rows = (products ?? []).filter(
    (product) =>
      !search ||
      `${product.name} ${product.category} ${product.sku ?? ""}`
        .toLowerCase()
        .includes(search)
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setWanted(true);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Insert a product"
            title="Insert a product from the catalogue"
          >
            <LightningIcon />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            value={term}
            placeholder="Search the catalogue…"
            aria-label="Search products"
            className="h-8"
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {products === undefined ? (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Spinner /> Loading the catalogue…
            </p>
          ) : rows.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {products.length === 0
                ? "No products in the catalogue yet."
                : "Nothing matches that."}
            </p>
          ) : (
            rows.map((product) => (
              <button
                key={product._id}
                type="button"
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  onPick(
                    product.price !== undefined
                      ? `${product.name} — ${money(product.price)}${
                          product.unit ? ` ${product.unit}` : ""
                        }`
                      : product.name
                  );
                  setOpen(false);
                  setTerm("");
                }}
              >
                <span className="text-sm font-medium">{product.name}</span>
                <span className="text-xs text-muted-foreground">
                  {product.category}
                  {product.price !== undefined
                    ? ` · ${money(product.price)}`
                    : " · no price on file"}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reply to a customer by hand, on the thread the agent has been holding.
 *
 * The message goes out over the same channel and is recorded as an ordinary
 * outgoing message — one voice from the customer's side — marked so the
 * transcript can show it came from a person.
 */
export function ManualReply({
  conversationId,
  workspaceId,
  replyingAs,
  channelType,
  lastInboundAt,
  windowClosed,
  neverWritten,
  contactLabel,
  humanHandling,
  agentName,
}: {
  conversationId: Id<"conversations">;
  workspaceId: Id<"workspaces">;
  channelType: "whatsapp" | "web";
  /** When the customer last wrote, which starts WhatsApp's 24-hour window. */
  lastInboundAt: number | null;
  /**
   * A human agent on the escalations desk, who sends as themselves: no roster
   * to pick from, and no catalogue — both are the dashboard's, not the desk's.
   */
  replyingAs?: { name: string; role: string };
  /**
   * WhatsApp's 24-hour free-form window has passed, worked out server-side in
   * `conversations.getWithContact`. Always false on the web widget, which has
   * no such rule.
   */
  windowClosed: boolean;
  /** The customer has never written, so there is no window to be inside. */
  neverWritten: boolean;
  contactLabel: string;
  /** A person already holds this thread, so the agent is not answering it. */
  humanHandling: boolean;
  agentName: string;
}) {
  const send = useAction(api.conversations.sendManualReply);
  // Who is on the team, so a reply can be signed. Absent or empty and the
  // composer looks exactly as it did — nobody is made to fill in a roster
  // before they can answer a customer. Not asked on the desk, which could not
  // read it anyway.
  const team = useQuery(
    api.team.activeForReply,
    replyingAs ? "skip" : { workspaceId }
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sender, setSender] = useState<string>("");
  // Read once, at mount. This only renders once the session has loaded in the
  // browser, so there is no server render for the stored value to disagree
  // with.
  const [pauseMinutes, setPauseMinutes] = useState(storedPause);

  const now = useNow();
  const window24 = channelType === "whatsapp" ? replyWindow(lastInboundAt, now) : null;
  // The server's answer is as of the query's last run; the clock here is
  // current. Either one saying closed is closed.
  const closed = windowClosed || (window24 !== null && !window24.open);

  const roster = team ?? [];
  // Default to the first person on the list rather than to nobody, so the
  // count on the Team page means something without anyone having to opt in.
  const sendingAs = sender || roster[0]?._id || "";

  /**
   * Drop a fragment in where the caret is, rather than on the end.
   * Half-written sentences are the normal case for an emoji, and a message
   * that grows backwards while you type in the middle of it is maddening.
   */
  const insert = (fragment: string) => {
    const field = inputRef.current;
    const at = field?.selectionStart ?? text.length;
    const to = field?.selectionEnd ?? at;
    const next = text.slice(0, at) + fragment + text.slice(to);
    setText(next);
    // After React has written the new value, or the caret lands on the old one.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + fragment.length, at + fragment.length);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      const result = await send({
        conversationId,
        text: body,
        teamMemberId: sendingAs
          ? (sendingAs as Id<"teamMembers">)
          : undefined,
        pauseMinutes,
      });
      if (result.ok) {
        // Cleared only on success, so a rejected message is still there to
        // edit or copy rather than lost.
        setText("");
        inputRef.current?.focus();
      } else {
        toast.add({
          title: "Not sent",
          description: result.error,
          type: "error",
        });
      }
    } catch (caught) {
      toast.add({
        title: "Not sent",
        description: caught instanceof Error ? caught.message : String(caught),
        type: "error",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t bg-background px-3 py-2.5">
      {/* WhatsApp refuses a free-form message more than 24 hours after the
          customer's last one. Four words is enough to warn; the reason sits on
          hover for whoever has not met the rule before. The input stays live
          either way, because WhatsApp is the authority on its own window and
          our timestamp is not. */}
      {closed ? (
        <p
          className="mx-auto mb-1.5 flex w-full max-w-3xl items-center gap-1.5 text-xs text-muted-foreground"
          title={
            neverWritten
              ? `${contactLabel} has not written on WhatsApp yet, so a free-form message cannot be delivered.`
              : `WhatsApp only delivers a free-form reply within 24 hours of the customer's last message. ${contactLabel} last wrote before that, so this will likely be rejected.`
          }
        >
          <WarningIcon className="size-3.5 shrink-0" />
          {neverWritten ? "No inbound message yet" : "Reply window closed"}
        </p>
      ) : window24 ? (
        // Open, and counting. Amber for the last hour, which is when somebody
        // meaning to answer later needs to answer now.
        <p
          className={
            window24.left < 60 * 60_000
              ? "mx-auto mb-1.5 flex w-full max-w-3xl items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
              : "mx-auto mb-1.5 flex w-full max-w-3xl items-center gap-1.5 text-xs text-muted-foreground"
          }
          title={`WhatsApp delivers a free-form reply until ${new Date(window24.endsAt).toLocaleString()} — 24 hours after ${contactLabel}'s last message. After that only an approved template gets through.`}
        >
          <TimerIcon className="size-3.5 shrink-0" />
          <span>
            Reply window open ·{" "}
            <Countdown to={window24.endsAt} /> left
          </span>
        </p>
      ) : null}

      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        {/* One bordered field holding the tools and the text, rather than a
            row of controls beside a box: the whole thing is the composer, so
            it takes the focus ring as a unit. */}
        <div className="flex min-w-0 flex-1 items-end gap-1 rounded-xl border border-input bg-background px-1.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label="Insert an emoji"
                  >
                    <SmileyIcon />
                  </Button>
                }
              />
              <PopoverContent align="start" className="w-auto p-2">
                <div className="grid grid-cols-8 gap-0.5">
                  {EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Insert ${emoji}`}
                      className="cursor-pointer rounded-md p-1 text-lg leading-none transition-colors hover:bg-muted"
                      onClick={() => insert(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {replyingAs ? null : (
              <ProductInsert
                onPick={(line) =>
                  // Padded, so it does not weld itself onto the word in front.
                  insert(
                    text && !/\s$/.test(text.slice(0, 40)) ? ` ${line}` : line
                  )
                }
              />
            )}
          </div>

          <Textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder="Type a message…"
            // Textarea already sizes to its content; the min-height it ships
            // with is for a form field, and here a one-line reply should get a
            // one-line box. The border and ring come off because the wrapper
            // above draws both for the composer as a whole.
            className="max-h-32 min-h-8 resize-none border-0 bg-transparent px-1 py-1 focus-visible:ring-0 dark:bg-transparent"
            aria-label="Your reply"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <Button
          className="size-11 shrink-0 rounded-xl [&_svg:not([class*='size-'])]:size-5"
          aria-label="Send reply"
          disabled={sending || !text.trim()}
          onClick={() => void submit()}
        >
          {sending ? <Spinner /> : <PaperPlaneRightIcon weight="fill" />}
        </Button>
      </div>

      {/* One row: who the reply is from on the left, how long it pauses the
          agent on the right. Wraps only on a phone, where the two cannot fit
          side by side. No keyboard hint — Enter sends, as in every chat app,
          and the line it took pushed the pause onto a row of its own. */}
      <div className="mx-auto mt-1.5 flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 text-xs whitespace-nowrap text-muted-foreground sm:flex-nowrap">
        {/* Only once there is a team to choose from. A workspace that has not
            filled in a roster replies exactly as it did before, and one that
            has gets the reply signed without an extra step — the first name is
            already selected. */}
        {/* This side gives way when the column is narrow — the name clips
            inside its picker — so the pause beside it stays whole. */}
        {replyingAs ? (
          <span className="min-w-0 truncate">
            Replying as{" "}
            <span className="font-medium text-foreground">{replyingAs.name}</span>
            {replyingAs.role ? ` · ${replyingAs.role}` : null}
          </span>
        ) : roster.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5">
            Replying as
            <SelectField
              value={sendingAs}
              onValueChange={setSender}
              aria-label="Replying as"
              className="h-7 w-48 min-w-24 shrink text-xs"
              options={roster.map((member) => ({
                value: member._id,
                label: `${member.name} · ${member.role}`,
              }))}
            />
          </span>
        ) : null}

        {/* Sending is what takes the thread over, so it has to be said
            beforehand — and how long for, which is the reader's to choose.
            Once the thread is held the header carries the countdown; this
            stays because every reply restarts it with whatever is picked. */}
        <span
          className="ml-auto flex shrink-0 items-center gap-1.5"
          title={`${agentName} stops answering ${contactLabel} for this long after each reply you send. Resume it early from the thread menu.`}
        >
          <PauseIcon className="size-3.5 shrink-0" />
          {humanHandling ? "Each reply pauses" : "Replying pauses"} {agentName}{" "}
          for
          <SelectField
            value={String(pauseMinutes)}
            onValueChange={(next) => {
              const minutes = Number(next);
              setPauseMinutes(minutes);
              storePause(minutes);
            }}
            aria-label="How long a reply pauses the agent"
            className="h-7 w-28 text-xs"
            options={PAUSE_OPTIONS}
          />
        </span>
      </div>
    </div>
  );
}
