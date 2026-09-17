import type { Doc } from "@/convex/_generated/dataModel";

/**
 * What "set up" means, in one file.
 *
 * Six steps, and for each one a flat list of checks that are either met or not.
 * Every percentage in the flow is `met / total` — no weights, no hand-tuned
 * scores — because a number the operator cannot reconstruct from the ticks in
 * front of them is a number they will not trust. The hub, the rail and each
 * step screen all read their checklist from here, so they can never disagree
 * about whether something is done.
 *
 * `required` is a second, lower bar: it is what makes a step say "Ready"
 * rather than a percentage. A workspace with no address and no website still
 * has agents that work; one with no agents does not. Optional checks still
 * move the bar, so there is always something left to gain by filling more in.
 */

export type StepId =
  | "profile"
  | "facts"
  | "agents"
  | "knowledge"
  | "catalogue"
  | "stages";

export type Check = {
  label: string;
  done: boolean;
  /** Blocks "Ready". Optional checks only move the percentage. */
  required: boolean;
};

export type Step = {
  id: StepId;
  /** 1-based, for "Step 3 of 6". */
  index: number;
  title: string;
  /** The one line under the title, everywhere the step is named. */
  blurb: string;
  checks: Check[];
  /** 0–100. */
  percent: number;
  /** Every required check met. */
  ready: boolean;
  /** The first thing still missing. Null once nothing is. */
  next: string | null;
};

/** The flow, in order. `/w/<slug>/onboarding/<id>` is the page for each. */
export const STEP_IDS: StepId[] = [
  "profile",
  "facts",
  "agents",
  "knowledge",
  "catalogue",
  "stages",
];

export const STEP_COUNT = STEP_IDS.length;

export const isStepId = (value: string): value is StepId =>
  (STEP_IDS as string[]).includes(value);

/** The step after this one, or null at the end of the flow. */
export function nextStepId(id: StepId): StepId | null {
  return STEP_IDS[STEP_IDS.indexOf(id) + 1] ?? null;
}

/** Fact keys worth having, offered as one-tap suggestions on the facts step. */
export const SUGGESTED_FACTS = [
  "Opening hours",
  "Delivery",
  "Payment terms",
  "Lead time",
  "Returns policy",
  "Service area",
  "Minimum order",
  "Warranty",
];

/** The subset of the above that answers what customers ask first. */
const CORE_FACT_TOPICS = ["hour", "deliver", "pay", "price", "lead time", "area"];

const filled = (value: string | undefined | null) => Boolean(value?.trim());

function score(
  id: StepId,
  index: number,
  title: string,
  blurb: string,
  checks: Check[]
): Step {
  const met = checks.filter((check) => check.done).length;
  const missing = checks.find((check) => !check.done);
  return {
    id,
    index,
    title,
    blurb,
    checks,
    percent: checks.length === 0 ? 100 : Math.round((met / checks.length) * 100),
    ready: checks.every((check) => check.done || !check.required),
    next: missing?.label ?? null,
  };
}

// --------------------------------------------------------------- the six steps

/** What each step needs to be scored. Everything is optional while it loads. */
export type OnboardingData = {
  workspace: Doc<"workspaces">;
  agents?: Doc<"agents">[];
  sources?: Pick<Doc<"knowledgeSources">, "status">[];
  products?: Pick<Doc<"products">, "status" | "description" | "price">[];
  stages?: Pick<Doc<"leadStages">, "description" | "outcome">[];
};

function profileStep(w: Doc<"workspaces">): Step {
  return score(
    "profile",
    1,
    "Company profile",
    "The workspace — the facts every agent of yours is told",
    [
      { label: "Company name", done: filled(w.name), required: true },
      {
        label: "What the company does",
        done: filled(w.description),
        required: true,
      },
      { label: "Industry", done: filled(w.industry), required: true },
      {
        label: "A phone number or an email",
        done: filled(w.supportPhone) || filled(w.supportEmail),
        required: true,
      },
      {
        label: "Currency, timezone and locale",
        done: filled(w.currency) && filled(w.timezone) && filled(w.locale),
        required: true,
      },
      { label: "A one-line tagline", done: filled(w.tagline), required: false },
      { label: "Website", done: filled(w.website), required: false },
      { label: "Address", done: filled(w.address), required: false },
      {
        label: "What the agents should call you",
        done: filled(w.ownerName),
        required: false,
      },
    ]
  );
}

function factsStep(w: Doc<"workspaces">): Step {
  const facts = w.facts ?? [];
  const usable = facts.filter((fact) => filled(fact.key) && filled(fact.value));
  const topics = facts.map((fact) => fact.key.toLowerCase());
  const covered = CORE_FACT_TOPICS.filter((topic) =>
    topics.some((key) => key.includes(topic))
  ).length;

  return score(
    "facts",
    2,
    "Company facts",
    "Lines injected into every agent's instructions",
    [
      { label: "At least one fact", done: usable.length >= 1, required: true },
      {
        label: "No fact left half-written",
        done: facts.length > 0 && usable.length === facts.length,
        required: true,
      },
      {
        label: "Hours, delivery or payment covered",
        done: covered >= 2,
        required: false,
      },
      { label: "Four facts or more", done: usable.length >= 4, required: false },
    ]
  );
}

function agentsStep(agents: Doc<"agents">[]): Step {
  // `kind` is absent on every agent made before routing existed, and absent
  // means specialist — so the fallback is not a nicety, it is the rule.
  const kindOf = (agent: Doc<"agents">) => agent.kind ?? "specialist";
  const specialists = agents.filter((agent) => kindOf(agent) === "specialist");
  const router = agents.find((agent) => kindOf(agent) === "router");

  return score("agents", 3, "Agents", "One agent per block — persona, job, rules", [
    { label: "At least one agent", done: specialists.length >= 1, required: true },
    {
      label: "A front desk to route enquiries",
      done: Boolean(router),
      required: true,
    },
    {
      label: "Every agent says when to take over",
      done:
        specialists.length > 0 &&
        specialists.every((agent) => filled(agent.routingDescription)),
      required: true,
    },
    {
      label: "One agent live, not draft",
      done: specialists.some((agent) => agent.status === "active"),
      required: true,
    },
    {
      label: "Rules written for every agent",
      done:
        specialists.length > 0 &&
        specialists.every((agent) => agent.rules.length > 0),
      required: false,
    },
  ]);
}

function knowledgeStep(sources: Pick<Doc<"knowledgeSources">, "status">[]): Step {
  return score(
    "knowledge",
    4,
    "Knowledge base",
    "Searchable sources the agents quote from",
    [
      { label: "A first source", done: sources.length >= 1, required: true },
      {
        label: "Everything indexed and searchable",
        done:
          sources.length > 0 &&
          sources.every((source) => source.status === "ready"),
        required: true,
      },
      { label: "Three sources or more", done: sources.length >= 3, required: false },
    ]
  );
}

function catalogueStep(
  products: Pick<Doc<"products">, "status" | "description" | "price">[]
): Step {
  const live = products.filter((product) => product.status === "active");
  return score(
    "catalogue",
    5,
    "Catalogue",
    "The products and services agents are allowed to discuss",
    [
      {
        label: "A first product or service",
        done: live.length >= 1,
        required: true,
      },
      {
        label: "Every one described",
        done: live.length > 0 && live.every((p) => filled(p.description)),
        required: true,
      },
      {
        // Agents are forbidden from quoting a price that is not stored, so an
        // unpriced catalogue is one that can never close anything on its own.
        label: "At least one price stored",
        done: live.some((product) => typeof product.price === "number"),
        required: false,
      },
    ]
  );
}

function stagesStep(
  stages: Pick<Doc<"leadStages">, "description" | "outcome">[]
): Step {
  return score(
    "stages",
    6,
    "Enquiry stages",
    "Your lead pipeline and follow-up behaviour",
    [
      { label: "A pipeline with stages", done: stages.length >= 1, required: true },
      {
        // This is the text the follow-up desk matches a conversation against,
        // so a stage without one is a stage nothing is ever filed into.
        label: "Every stage explains what belongs in it",
        done: stages.length > 0 && stages.every((s) => filled(s.description)),
        required: true,
      },
      {
        label: "A won and a lost stage to close on",
        done:
          stages.some((stage) => stage.outcome === "won") &&
          stages.some((stage) => stage.outcome === "lost"),
        required: true,
      },
      { label: "Three stages or more", done: stages.length >= 3, required: false },
    ]
  );
}

export type Progress = {
  steps: Step[];
  byId: Record<StepId, Step>;
  /** 0–100 across the whole flow. */
  percent: number;
  readyCount: number;
  complete: boolean;
  /** The step "Continue" opens — the first that is not ready. */
  resume: Step;
};

/**
 * Score a workspace.
 *
 * A plain function rather than a hook, so the hub, the rail and the dashboard
 * card can each feed it whatever they already have loaded instead of every one
 * of them opening four more subscriptions. A missing list scores as empty,
 * which reads as 0% while it loads — callers that care show a skeleton until
 * their queries resolve.
 */
export function scoreWorkspace({
  workspace,
  agents,
  sources,
  products,
  stages,
}: OnboardingData): Progress {
  const steps = [
    profileStep(workspace),
    factsStep(workspace),
    agentsStep(agents ?? []),
    knowledgeStep(sources ?? []),
    catalogueStep(products ?? []),
    stagesStep(stages ?? []),
  ];

  /* The mean of the six, not every tick over every tick. Each step is a sixth
     of the journey in the operator's head, and totalling the checks instead
     would make the company profile — which has the most boxes — worth three
     times what the agents step is worth. */
  const percent = Math.round(
    steps.reduce((sum, step) => sum + step.percent, 0) / steps.length
  );

  return {
    steps,
    byId: Object.fromEntries(steps.map((step) => [step.id, step])) as Record<
      StepId,
      Step
    >,
    percent,
    readyCount: steps.filter((step) => step.ready).length,
    complete: steps.every((step) => step.ready),
    resume: steps.find((step) => !step.ready) ?? steps[0],
  };
}

/** Where a step lives, for a given workspace. */
export const stepHref = (slug: string, id: StepId) =>
  `/w/${slug}/onboarding/${id}`;
