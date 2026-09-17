"use client";

import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { useProgress } from "@/components/onboarding/use-progress";
import {
  ProgressBar,
  ProgressRing,
  STEP_ICONS,
} from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { STEP_COUNT, stepHref, type Step } from "@/lib/onboarding";
import {
  ArrowRightIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
} from "@phosphor-icons/react";

/**
 * The setup hub.
 *
 * Six cards, each carrying its own percentage, over one dial for the lot. The
 * dial is the mean of the six rather than every tick over every tick — see
 * `lib/onboarding` — so a step is worth a sixth of the journey whether it asks
 * four questions or nine.
 *
 * Nothing here gates the console. Every step is a form over configuration that
 * already had a page of its own; this is the order to do it in and an honest
 * account of how far along it is, not a wall in front of the product.
 */

function StepCard({
  step,
  href,
  loading,
}: {
  step: Step;
  href: string;
  loading: boolean;
}) {
  const Glyph = STEP_ICONS[step.id];

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 transition-all",
        "hover:-translate-y-px hover:border-primary/40 hover:shadow-sm",
        step.ready && "bg-muted/30"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
            step.ready
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground group-hover:text-foreground"
          )}
        >
          <Glyph className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {step.index}
            </span>
            <p className="truncate text-sm font-medium">{step.title}</p>
            {step.ready ? (
              <CheckCircleIcon
                weight="fill"
                className="size-4 shrink-0 text-primary"
              />
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {step.blurb}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              step.ready ? "text-primary" : "text-foreground"
            )}
          >
            {loading ? "—" : `${step.percent}%`}
          </span>
          <CaretRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>

      <ProgressBar value={loading ? 0 : step.percent} className="h-1" />

      {/* The first unmet check, named. A bar that has stopped short is a
          question, and the answer belongs on the same card. */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {loading ? (
          "Checking…"
        ) : step.next ? (
          <>
            <CircleDashedIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Next: {step.next}</span>
          </>
        ) : (
          <>
            <CheckCircleIcon
              weight="fill"
              className="size-3.5 shrink-0 text-primary"
            />
            <span className="text-primary">Nothing left in this step</span>
          </>
        )}
      </p>
    </Link>
  );
}

export default function OnboardingHubPage() {
  const workspace = useWorkspace();
  const { progress, loading } = useProgress();
  const { steps, percent, readyCount, complete, resume } = progress;

  /* What is actually outstanding, counted across every step. "6 things left"
     is a smaller, truer promise than "you are at 9%", and it is the number
     someone decides on when choosing whether to carry on now or later. */
  const outstanding = steps.reduce(
    (sum, step) => sum + step.checks.filter((check) => !check.done).length,
    0
  );
  const blocking = steps.reduce(
    (sum, step) =>
      sum + step.checks.filter((check) => !check.done && check.required).length,
    0
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Set up {workspace.name}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Six steps. Everything in them is read by every agent you run, so the
          more of it is filled in, the less they have to guess.
        </p>
      </header>

      {/* ------------------------------------------------------------- dial */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 py-2 sm:flex-row sm:gap-8">
          {loading ? (
            <Skeleton className="size-36 shrink-0 rounded-full" />
          ) : (
            <ProgressRing value={percent} size={144} stroke={12}>
              <span className="text-4xl font-semibold tabular-nums leading-none">
                {percent}
                <span className="text-lg font-medium text-muted-foreground">
                  %
                </span>
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                {readyCount} of {STEP_COUNT} ready
              </span>
            </ProgressRing>
          )}

          <div className="flex min-w-0 flex-1 flex-col items-center gap-4 text-center sm:items-start sm:text-left">
            <div className="flex flex-col gap-1.5">
              <p className="text-lg font-medium">
                {complete
                  ? "Your workspace is set up"
                  : percent === 0
                    ? "Let's teach your agents the business"
                    : "Keep going — you're getting there"}
              </p>
              <p className="max-w-xl text-sm text-muted-foreground">
                {complete
                  ? "Every step has what it needs. Come back any time to add more — agents pick changes up on their next reply."
                  : loading
                    ? "Reading your workspace…"
                    : blocking > 0
                      ? `${blocking} thing${blocking === 1 ? "" : "s"} still stop the agents working properly, and ${outstanding - blocking} more would make them better. None of it is final.`
                      : `Nothing is holding the agents back. ${outstanding} optional thing${outstanding === 1 ? "" : "s"} left if you want them sharper.`}
              </p>
            </div>

            {complete ? (
              <Badge variant="secondary" className="gap-1.5">
                <CheckCircleIcon weight="fill" className="size-3.5" />
                All six steps ready
              </Badge>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  nativeButton={false}
                  render={<Link href={stepHref(workspace.slug, resume.id)} />}
                >
                  {percent === 0
                    ? "Start with the basics"
                    : `Continue: ${resume.title}`}
                  <ArrowRightIcon />
                </Button>
                {/* Six dots, one per step, as a legend for the dial: it says at
                    a glance which parts of the journey are done without having
                    to read six cards. */}
                <span className="flex items-center gap-1 pl-1">
                  {steps.map((step) => (
                    <span
                      key={step.id}
                      title={`${step.title} — ${step.percent}%`}
                      className={cn(
                        "size-2 rounded-full",
                        step.ready
                          ? "bg-primary"
                          : step.percent > 0
                            ? "bg-primary/35"
                            : "bg-muted-foreground/25"
                      )}
                    />
                  ))}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ steps */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            href={stepHref(workspace.slug, step.id)}
            loading={loading}
          />
        ))}
      </section>

      <p className="text-xs text-muted-foreground">
        Every step can be reopened and changed. Agents read the current version
        on their next reply, so an edit is live the moment it saves.
      </p>
    </div>
  );
}
