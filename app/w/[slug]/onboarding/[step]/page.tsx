"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { StepScreen } from "@/components/onboarding/step-screen";
import { isStepId } from "@/lib/onboarding";

/**
 * Five of the six steps. The catalogue has a folder of its own — see
 * `../catalogue/page.tsx` — because its add-a-product page needs a static
 * segment to hang off, and a static segment shadows this one.
 */
export default function OnboardingStepPage({
  params,
}: PageProps<"/w/[slug]/onboarding/[step]">) {
  const { step } = use(params);
  if (!isStepId(step)) notFound();
  return <StepScreen stepId={step} />;
}
