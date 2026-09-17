"use client";

import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { useProgress } from "@/components/onboarding/use-progress";
import {
  ChecklistCard,
  StepHeader,
  StepRail,
  WhyCard,
} from "@/components/onboarding/shell";
import { ProfileStep } from "@/components/onboarding/profile-step";
import { FactsStep } from "@/components/onboarding/facts-step";
import { AgentsStep } from "@/components/onboarding/agents-step";
import { KnowledgeStep } from "@/components/onboarding/knowledge-step";
import { CatalogueStep } from "@/components/onboarding/catalogue-step";
import { StagesStep } from "@/components/onboarding/stages-step";
import { Button } from "@/components/ui/button";
import { nextStepId, stepHref, type StepId } from "@/lib/onboarding";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";

/**
 * One step of the setup, frame and all.
 *
 * A component rather than the page itself because two routes render it: the
 * `[step]` catch-all, and `catalogue/`, which has to exist as a real folder so
 * that `catalogue/new` — the add-a-product page — has somewhere to hang. A
 * static segment shadows a dynamic sibling in the app router, so without this
 * the catalogue step would 404 the moment the add page was added.
 *
 * The rail is a nav, not a wizard. A company that already has a catalogue
 * should not have to click through three screens to reach the pipeline, so the
 * numbers say how much there is rather than locking a path.
 */

/** Why each step exists, in the operator's terms. */
const WHY: Record<StepId, React.ReactNode> = {
  profile:
    "This is the workspace itself. Every agent you run is handed these facts before it reads a single message, so an agent can only be as accurate about your company as this page is.",
  facts:
    "These lines are pasted, word for word, into the instructions of every agent you run. If an agent ever tells a customer something that is not true of you, this is the page that fixes it — once, for all of them.",
  agents:
    "One front desk answers everything and hands each conversation to the right specialist. It chooses from one line per agent — “hand over to me when…” — so that line is the routing, not a description of it.",
  knowledge:
    "Facts go in every prompt; this goes in none of them. A source is searched at the moment a customer asks, and only the passages that match are handed to the agent — which is what lets the knowledge base be long without making every reply slower.",
  catalogue:
    "An agent will not discuss a product that is not in here, and will not quote a price that is not stored on one. That is deliberate: it is what stops an agent inventing a product line or a discount.",
  stages:
    "Your follow-up desk reads every conversation that has gone quiet, files it against these descriptions and writes the nudge. The wording is what it matches on — so write each stage as the situation it describes, not as a label.",
};

const FORMS: Record<StepId, () => React.ReactElement> = {
  profile: ProfileStep,
  facts: FactsStep,
  agents: AgentsStep,
  knowledge: KnowledgeStep,
  catalogue: CatalogueStep,
  stages: StagesStep,
};

export function StepScreen({ stepId }: { stepId: StepId }) {
  const workspace = useWorkspace();
  const { progress } = useProgress();

  const step = progress.byId[stepId];
  const Form = FORMS[stepId];
  const after = nextStepId(stepId);
  const hub = `/w/${workspace.slug}/onboarding`;

  return (
    <div className="flex min-w-0 flex-1 gap-8 overflow-y-auto p-4 sm:p-6 lg:p-8">
      {/* Hidden on a phone, where it would push the form below the fold — the
          heading still says which step this is and the footer still links on. */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-0 flex flex-col gap-4">
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2 self-start"
            nativeButton={false}
            render={<Link href={hub} />}
          >
            <ArrowLeftIcon /> All steps
          </Button>
          <StepRail
            slug={workspace.slug}
            steps={progress.steps}
            activeId={stepId}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="lg:hidden">
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2"
            nativeButton={false}
            render={<Link href={hub} />}
          >
            <ArrowLeftIcon /> All steps
          </Button>
        </div>

        <StepHeader step={step} />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <WhyCard>{WHY[stepId]}</WhyCard>
            <Form />
          </div>

          {/* Beside the form on a wide screen, above it otherwise — the
              checklist is what the percentage means, so it wants to be
              readable while the form is being filled rather than after. */}
          <aside className="order-first flex flex-col gap-3 xl:sticky xl:top-0 xl:order-last">
            <ChecklistCard step={step} />
            {after ? (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                nativeButton={false}
                render={<Link href={stepHref(workspace.slug, after)} />}
              >
                Skip to {progress.byId[after].title} <ArrowRightIcon />
              </Button>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
