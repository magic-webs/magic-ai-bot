"use client";

import { useSyncExternalStore } from "react";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The current time, rounded down to the hour.
 *
 * Convex queries must not read the wall clock — they are not re-run just
 * because time passed — so the dashboard passes `now` in as an argument.
 * Rounding to the hour keeps the query key (and its cache entry) stable.
 *
 * The clock is an external mutable source, so it is read through
 * useSyncExternalStore rather than `Date.now()` during render: the snapshot is
 * cached so repeated reads in one pass are identical, and the subscription
 * makes the dashboard roll over to a new day on its own.
 */
let snapshot = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function read(): number {
  return Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
}

function getSnapshot(): number {
  // Only move the cached value when the hour actually changes, so the value
  // React sees is stable within a render pass.
  if (snapshot === 0) snapshot = read();
  return snapshot;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  if (!timer) {
    // A minute is fine: we only care about crossing an hour boundary.
    timer = setInterval(() => {
      const next = read();
      if (next !== snapshot) {
        snapshot = next;
        for (const listener of listeners) listener();
      }
    }, 60_000);
  }

  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useHourBucket(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
