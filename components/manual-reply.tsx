"use client";

import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
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
  WarningIcon,
} from "@phosphor-icons/react";

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
  windowClosed,
  neverWritten,
  contactLabel,
  humanHandling,
  agentName,
}: {
  conversationId: Id<"conversations">;
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
  const workspace = useWorkspace();
  // Who is on the team, so a reply can be signed. Absent or empty and the
  // composer looks exactly as it did — nobody is made to fill in a roster
  // before they can answer a customer.
  const team = useQuery(api.team.activeForReply, {
    workspaceId: workspace._id,
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sender, setSender] = useState<string>("");

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
      {windowClosed ? (
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
            <ProductInsert
              onPick={(line) =>
                // Padded, so it does not weld itself onto the word in front.
                insert(text && !/\s$/.test(text.slice(0, 40)) ? ` ${line}` : line)
              }
            />
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

      <div className="mx-auto mt-1.5 flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Press <kbd className="font-sans font-medium">Enter</kbd> to send ·{" "}
          <kbd className="font-sans font-medium">Shift + Enter</kbd> for a new
          line
        </span>

        {/* Only once there is a team to choose from. A workspace that has not
            filled in a roster replies exactly as it did before, and one that
            has gets the reply signed without an extra step — the first name is
            already selected. */}
        {roster.length > 0 ? (
          <span className="flex items-center gap-1.5">
            Replying as
            <SelectField
              value={sendingAs}
              onValueChange={setSender}
              aria-label="Replying as"
              className="h-7 w-48 text-xs"
              options={roster.map((member) => ({
                value: member._id,
                label: `${member.name} · ${member.role}`,
              }))}
            />
          </span>
        ) : null}

        {/* Only before the first reply. Sending is what takes the thread over,
            so it has to be said beforehand — but once it is said, the header
            carries a "You have this thread" badge and a Resume button, so
            repeating it here would be the third place saying the same thing. */}
        {!humanHandling ? (
          <span
            className="ml-auto flex items-center gap-1.5"
            title={`${agentName} stops answering ${contactLabel} once you reply, until you resume it from the thread header.`}
          >
            <PauseIcon className="size-3.5 shrink-0" />
            Replying pauses {agentName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
