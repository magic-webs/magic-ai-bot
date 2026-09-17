"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  STEP_COUNT,
  stepHref,
  type Check,
  type Step,
  type StepId,
} from "@/lib/onboarding";
import {
  BooksIcon,
  CheckCircleIcon,
  CircleIcon,
  FunnelIcon,
  InfoIcon,
  NotePencilIcon,
  PackageIcon,
  RobotIcon,
  StorefrontIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

/**
 * A glyph per step.
 *
 * Here rather than in `lib/onboarding`, which is a scoring model and has no
 * business importing React. The rail, the hub and the step heading all draw
 * from this one map so a step looks the same wherever it is named.
 */
export const STEP_ICONS: Record<StepId, PhosphorIcon> = {
  profile: StorefrontIcon,
  facts: NotePencilIcon,
  agents: RobotIcon,
  knowledge: BooksIcon,
  catalogue: PackageIcon,
  stages: FunnelIcon,
};

/**
 * The shared furniture of the setup flow: the dial, the checklist, the rail
 * down the left of every step, and the note at the top of one.
 *
 * All of it is driven by `lib/onboarding`, so none of these components decides
 * anything — they draw a `Step` and nothing more. That is deliberate: the
 * percentage shown on the dashboard card, on the rail and at the top of a step
 * are the same number computed once, and a component that recomputed its own
 * would be the first thing to drift.
 */

/**
 * The dial.
 *
 * One SVG circle stroked over another, rotated a quarter turn so it starts at
 * twelve o'clock and animated through `stroke-dashoffset` with a CSS
 * transition — no animation library, and no re-render per frame.
 */
export function ProgressRing({
  value,
  size = 132,
  stroke = 10,
  className,
  children,
}: {
  /** 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Setup complete"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/** The flat bar, for the rail and the step cards. */
export function ProgressBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Checklist({
  checks,
  className,
}: {
  checks: Check[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {checks.map((check) => (
        <li key={check.label} className="flex items-center gap-2.5">
          {check.done ? (
            <CheckCircleIcon
              weight="fill"
              className="size-4.5 shrink-0 text-primary"
            />
          ) : (
            <CircleIcon className="size-4.5 shrink-0 text-muted-foreground/50" />
          )}
          <span
            className={cn(
              "flex-1 text-sm",
              check.done ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {check.label}
          </span>
          {check.required ? null : (
            <span className="text-xs text-muted-foreground">optional</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The six steps down the side of every step page.
 *
 * A nav, not a wizard: the steps have no order that has to be obeyed, and a
 * company that already has a catalogue should not have to click through three
 * screens to reach it. The numbers are there to say how much there is, not to
 * lock a path.
 */
export function StepRail({
  slug,
  steps,
  activeId,
}: {
  slug: string;
  steps: Step[];
  activeId?: string;
}) {
  return (
    <nav aria-label="Setup steps" className="flex flex-col gap-1">
      {steps.map((step) => {
        const active = step.id === activeId;
        return (
          <Link
            key={step.id}
            href={stepHref(slug, step.id)}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-colors",
              active ? "border-border bg-muted/70" : "hover:bg-muted/50"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
                step.ready
                  ? "bg-primary text-primary-foreground"
                  : active
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {step.ready ? (
                <CheckCircleIcon weight="fill" className="size-4" />
              ) : (
                step.index
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    active ? "font-medium" : "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {step.percent}%
                </span>
              </span>
              <ProgressBar value={step.percent} className="mt-1.5 h-1" />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The heading of a step page. */
export function StepHeader({ step }: { step: Step }) {
  const Glyph = STEP_ICONS[step.id];

  return (
    <header className="flex items-start gap-4">
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl",
          step.ready
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Glyph className="size-6" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Step {step.index} of {STEP_COUNT}
          </span>
          {step.ready ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircleIcon weight="fill" className="size-3" /> Ready
            </Badge>
          ) : (
            <Badge variant="outline">{step.percent}% filled</Badge>
          )}
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {step.title}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{step.blurb}</p>
        <ProgressBar value={step.percent} className="mt-1 max-w-md" />
      </div>
    </header>
  );
}

/**
 * Why a step exists, in the operator's terms.
 *
 * Every step opens with one. All six ask for work, and the only thing that
 * makes a form worth filling in is knowing what reads it.
 */
export function WhyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardContent className="flex items-start gap-3">
        <InfoIcon weight="fill" className="mt-0.5 size-4.5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed">{children}</p>
      </CardContent>
    </Card>
  );
}

/** What the step's checks add up to, beside the form. */
export function ChecklistCard({ step }: { step: Step }) {
  const met = step.checks.filter((check) => check.done).length;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">This step</span>
          <span className="text-sm tabular-nums text-muted-foreground">
            {met}/{step.checks.length}
          </span>
        </div>
        <ProgressBar value={step.percent} />
        <Checklist checks={step.checks} />
        {step.ready ? (
          <p className="flex items-center gap-1.5 text-xs text-primary">
            <CheckCircleIcon weight="fill" className="size-3.5" />
            Everything this step needs is in place.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            The ticks marked optional still move the percentage — they are just
            not what stops the agents working.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A labelled row in a step's form.
 *
 * The hint says what the agents do with the field rather than restating its
 * name. Six forms' worth of label/control/hint is enough repetition to be
 * worth one component, and it keeps "optional" written the same way in all of
 * them — which is the thing an operator scans for.
 */
export function FormRow({
  label,
  htmlFor,
  hint,
  optional = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {optional ? (
          <span className="text-xs text-muted-foreground">optional</span>
        ) : null}
      </div>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** An empty list inside a step. */
export function NothingYet({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
