"use client";

import { StepScreen } from "@/components/onboarding/step-screen";

/**
 * Step 5, on its own route.
 *
 * `[step]` would have served this perfectly well, but `catalogue/new` — the
 * add-a-product page — needs `catalogue` to be a real folder, and in the app
 * router a static segment shadows its dynamic sibling. So the catalogue gets an
 * explicit page that renders the same screen as the other five.
 */
export default function CatalogueStepPage() {
  return <StepScreen stepId="catalogue" />;
}
