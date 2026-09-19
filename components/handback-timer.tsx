"use client";

import { useSyncExternalStore } from "react";
import { HANDBACK_AFTER_MINUTES } from "@/convex/lib/shared";

/**
 * One ticking clock for every countdown on the page.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the current time
 * is an external source, reading it during render is impure, and setting state
 * from an effect body is what the lint config rejects. Subscribing to it is
 * both the honest description and the shape React wants.
 *
 * Module-level, so ten threads on screen share one interval rather than ten.
 */
let clock = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  // Refreshed on the way in: the module may have loaded minutes ago, and the
  // first snapshot React takes is the one immediately after this call.
  clock = Date.now();
  listeners.add(listener);

  if (!timer) {
    // Twenty seconds. The label is in whole minutes, so anything faster
    // re-renders without changing a pixel.
    timer = setInterval(() => {
      clock = Date.now();
      for (const notify of listeners) notify();
    }, 20_000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => clock;
// There is no clock on the server, and a time rendered there would be wrong by
// however long the page sat in a cache. Zero means "not yet known", and the
// component renders nothing until it hydrates.
const getServerSnapshot = () => 0;

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * How long a held thread has before it goes back to the agent.
 *
 * The point of showing it is that the hold is invisible otherwise: a colleague
 * who takes a thread over and walks away has no way of knowing the agent is
 * about to start answering again. A number counting down says it before it
 * happens rather than after.
 */
export function handbackLabel(
  humanHandlingAt: number | undefined,
  now: number
): string | null {
  if (!humanHandlingAt || now === 0) return null;

  const deadline = humanHandlingAt + HANDBACK_AFTER_MINUTES * 60_000;
  const left = deadline - now;

  // The sweep runs on a fifteen-minute cadence, so a thread past its deadline
  // has not necessarily been released yet. Saying "0m left" would claim a
  // precision that is not there.
  if (left <= 0) return "handing back";

  const minutes = Math.ceil(left / 60_000);
  if (minutes >= 60) return "1h left";
  return `${minutes}m left`;
}

export function HandbackCountdown({
  humanHandlingAt,
}: {
  humanHandlingAt: number | undefined;
}) {
  const now = useNow();
  const label = handbackLabel(humanHandlingAt, now);
  if (!label) return null;

  return (
    <span
      className="tabular-nums"
      title={`Nobody has replied by hand for a while. The agent takes this thread back ${HANDBACK_AFTER_MINUTES} minutes after the last manual reply, checked every 15 minutes. Reply again to reset it, or resume the agent now from this menu.`}
    >
      {label}
    </span>
  );
}
