"use client";

import { useSyncExternalStore } from "react";
import {
  HANDBACK_AFTER_MINUTES,
  WHATSAPP_FREE_FORM_WINDOW_HOURS,
} from "@/convex/lib/shared";

/**
 * A ticking clock, shared by everything on the page that reads it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the current time
 * is an external source, reading it during render is impure, and setting state
 * from an effect body is what the lint config rejects. Subscribing to it is
 * both the honest description and the shape React wants.
 *
 * Module-level, so ten threads on screen share one interval rather than ten.
 */
function createClock(intervalMs: number) {
  let clock = Date.now();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function subscribe(listener: () => void) {
    // Refreshed on the way in: the module may have loaded minutes ago, and
    // the first snapshot React takes is the one immediately after this call.
    clock = Date.now();
    listeners.add(listener);

    if (!timer) {
      timer = setInterval(() => {
        clock = Date.now();
        for (const notify of listeners) notify();
      }, intervalMs);
    }

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  return { subscribe, getSnapshot: () => clock };
}

// Twenty seconds, for decisions that turn on the minute — whether a window has
// closed, whether to warn. Anything faster re-renders whole panels for nothing.
const minuteClock = createClock(20_000);
// Every second, but only for the countdown text itself (`Countdown` below), so
// what re-renders each tick is a few characters rather than a reply box.
const secondClock = createClock(1_000);

// There is no clock on the server, and a time rendered there would be wrong by
// however long the page sat in a cache. Zero means "not yet known", and the
// component renders nothing until it hydrates.
const getServerSnapshot = () => 0;

export function useNow(): number {
  return useSyncExternalStore(
    minuteClock.subscribe,
    minuteClock.getSnapshot,
    getServerSnapshot
  );
}

function useNowSeconds(): number {
  return useSyncExternalStore(
    secondClock.subscribe,
    secondClock.getSnapshot,
    getServerSnapshot
  );
}

/**
 * "23h 05m 09s", "4m 30s", "12s" — a span of time to the second. The minutes
 * and seconds are zero-padded once there is a larger unit in front of them, so
 * the text keeps its width as it counts down instead of twitching.
 */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** The time left until `to`, ticking every second. */
export function Countdown({ to }: { to: number }) {
  const now = useNowSeconds();
  if (now === 0) return null;
  return <span className="tabular-nums">{formatLeft(to - now)}</span>;
}

/**
 * When a held thread goes back to the agent: the end its last reply set, or —
 * for a hold taken before the pause was adjustable — the fixed hour.
 */
export function holdEnd(
  humanHandlingAt: number | undefined,
  humanHandlingUntil: number | undefined
): number | null {
  if (humanHandlingUntil) return humanHandlingUntil;
  if (humanHandlingAt) return humanHandlingAt + HANDBACK_AFTER_MINUTES * 60_000;
  return null;
}

/**
 * How long a held thread has before it goes back to the agent.
 *
 * The point of showing it is that the hold is invisible otherwise: a colleague
 * who takes a thread over and walks away has no way of knowing the agent is
 * about to start answering again. A number counting down says it before it
 * happens rather than after.
 */
export function handbackLabel(end: number | null, now: number): string | null {
  if (!end || now === 0) return null;
  const left = end - now;

  // A thread past its end is released on the customer's next message or the
  // next sweep, whichever comes first — not necessarily yet. Saying "0m left"
  // would claim a precision that is not there.
  if (left <= 0) return "handing back";
  return `${formatLeft(left)} left`;
}

export function HandbackCountdown({
  humanHandlingAt,
  humanHandlingUntil,
}: {
  humanHandlingAt: number | undefined;
  humanHandlingUntil: number | undefined;
}) {
  const now = useNowSeconds();
  const label = handbackLabel(holdEnd(humanHandlingAt, humanHandlingUntil), now);
  if (!label) return null;

  return (
    <span
      className="tabular-nums"
      title="The agent takes this thread back when the pause after the last manual reply runs out. Reply again to restart it, or resume the agent now from the thread menu."
    >
      {label}
    </span>
  );
}

/**
 * WhatsApp's free-form reply window: open for 24 hours after the customer's
 * last message, then only an approved template gets through.
 *
 * Counted on the client from `lastInboundAt`, because the server's
 * `freeFormWindowClosed` is worked out when the query last ran and nothing
 * re-runs it just because time passed. Null for a thread with no inbound
 * message, which has no window to be inside.
 */
export function replyWindow(
  lastInboundAt: number | null,
  now: number
): { open: boolean; endsAt: number; left: number } | null {
  if (!lastInboundAt || now === 0) return null;
  const endsAt = lastInboundAt + WHATSAPP_FREE_FORM_WINDOW_HOURS * 60 * 60_000;
  return { open: endsAt > now, endsAt, left: endsAt - now };
}
