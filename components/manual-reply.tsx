"use client";

import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  PaperPlaneRightIcon,
  PauseIcon,
  WarningIcon,
} from "@phosphor-icons/react";

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      const result = await send({ conversationId, text: body });
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
    <div className="shrink-0 border-t p-3">
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
        <Textarea
          ref={inputRef}
          rows={2}
          value={text}
          placeholder="Write a reply…"
          className="resize-none"
          aria-label="Your reply"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          size="icon-lg"
          aria-label="Send reply"
          disabled={sending || !text.trim()}
          onClick={() => void submit()}
        >
          {sending ? <Spinner /> : <PaperPlaneRightIcon />}
        </Button>
      </div>

      {/* Only before the first reply. Sending is what takes the thread over,
          so it has to be said beforehand — but once it is said, the header
          carries a "You have this thread" badge and a Resume button, so
          repeating it here would be the third place saying the same thing.
          The keyboard hint is gone with it: Enter-to-send is what every chat
          box does, and it was costing a line on every conversation to say so. */}
      {!humanHandling ? (
        <p
          className="mx-auto mt-1.5 flex w-full max-w-3xl items-center gap-1.5 text-xs text-muted-foreground"
          title={`${agentName} stops answering ${contactLabel} once you reply, until you resume it from the thread header.`}
        >
          <PauseIcon className="size-3.5 shrink-0" />
          Replying pauses {agentName}
        </p>
      ) : null}
    </div>
  );
}
