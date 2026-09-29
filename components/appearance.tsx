"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  applyDark,
  isAppearance,
  isDark,
  type Appearance,
} from "@/lib/appearance";

// The stored choice, as an external store: a pick in this tab tells the
// listeners directly, and one in another tab arrives as a `storage` event.

const listeners = new Set<() => void>();

function readAppearance(): Appearance {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_KEY);
    return isAppearance(stored) ? stored : DEFAULT_APPEARANCE;
  } catch {
    // Storage can be switched off; the console still works, just light.
    return DEFAULT_APPEARANCE;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setAppearance(next: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, next);
  } catch {
    // Not remembered, but still applied for this visit.
  }
  for (const listener of listeners) listener();
}

/** The current choice, for a picker. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, readAppearance, () => DEFAULT_APPEARANCE);
}

/**
 * Keeps <html> in step after the first paint, which the script in the root
 * layout handles: a new choice here or in another tab, the device switching
 * while on System, and a client-side navigation into or out of the console.
 *
 * Reads storage in the effect rather than through `useAppearance`, whose first
 * render during hydration is the server's default — applying that would flash
 * a dark page light for a frame.
 */
export function AppearanceSync() {
  const pathname = usePathname();

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyDark(isDark(readAppearance(), pathname, media.matches));
    apply();
    const unsubscribe = subscribe(apply);
    media.addEventListener("change", apply);
    return () => {
      unsubscribe();
      media.removeEventListener("change", apply);
    };
  }, [pathname]);

  return null;
}
