"use client";

import { useEffect } from "react";

/**
 * Palettes a workspace can render in.
 *
 * Each entry maps to a block in globals.css. `id: null` is the default, which
 * sets no attribute at all, so the base :root / .dark tokens apply.
 *
 * The swatches are the theme's own primary and two of its chart steps, so the
 * picker previews the palette rather than describing it.
 */
export type ThemeOption = {
  id: string | null;
  name: string;
  description: string;
  swatches: string[];
};

export const THEMES: ThemeOption[] = [
  {
    // Read from the live tokens rather than hardcoded hexes, so this swatch
    // stays correct if the base palette is ever re-generated.
    id: null,
    name: "Default",
    description: "The palette this console ships with.",
    swatches: [
      "var(--primary)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
    ],
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Cool teal on olive neutrals.",
    swatches: ["#007a55", "#00bba7", "#009689", "#46ecd5"],
  },
];

/**
 * Applies the workspace's theme to <html>.
 *
 * The attribute goes on the same element as the dark class, so a theme's dark
 * variant is a compound selector (.dark[data-theme="…"]) and both axes stay
 * independent: picking a palette does not disturb light/dark, and vice versa.
 *
 * Cleared on unmount so leaving a workspace — for the admin console, or another
 * workspace — does not leave its palette behind.
 */
export function WorkspaceTheme({ theme }: { theme?: string | null }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  return null;
}
