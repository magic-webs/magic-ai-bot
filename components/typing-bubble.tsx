"use client";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";

/**
 * WhatsApp's typing indicator: three dots rising in sequence inside an
 * incoming bubble, with no words.
 *
 * Replaces a spinner and the word "typing…". The spinner read as the app doing
 * something; this reads as a person about to answer, which is what the wait
 * actually is.
 *
 * The stagger lives in globals.css — the delay is per dot, keyed off
 * data-slot="typing-dot", and it stops entirely under
 * prefers-reduced-motion.
 */
export function TypingBubble({ label = "Typing" }: { label?: string }) {
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="outline">
          <BubbleContent className="flex items-center gap-1 py-2.5">
            {/* Announced once, as text, rather than leaving a screen reader to
                make sense of three empty spans. */}
            <span className="sr-only">{label}</span>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                data-slot="typing-dot"
                aria-hidden="true"
                className="size-1.5 rounded-full bg-muted-foreground"
              />
            ))}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
