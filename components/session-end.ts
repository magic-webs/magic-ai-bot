"use client";

import { useSyncExternalStore } from "react";
import type { SessionEndReason } from "@/lib/session";

// Why the session cookie stopped working, as the token route reported it.
// Module state rather than context: it is written from the Convex auth hook,
// which lives inside ConvexProviderWithAuth and has no way to hand values to
// the pages below it.

let reason: SessionEndReason | null = null;
const listeners = new Set<() => void>();

export function reportSessionEnd(next: SessionEndReason | null) {
  if (next === reason) return;
  reason = next;
  for (const listener of listeners) listener();
}

export function useSessionEndReason(): SessionEndReason | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reason,
    () => null
  );
}

// Set while this tab signs itself out, so the session it is ending is not
// mistaken for one ended from somewhere else in the moment before the page
// navigates away.
let signingOut = false;

export function markSigningOut() {
  signingOut = true;
}

export function isSigningOut() {
  return signingOut;
}
