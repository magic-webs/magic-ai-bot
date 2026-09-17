"use client";

import { useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import {
  draftFromSample,
  ProductForm,
  EMPTY_DRAFT,
  type ProductDraft,
} from "@/components/onboarding/product-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { swatchDot, SAMPLE_PACKS, type Sample } from "@/lib/catalogue-samples";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  FilePlusIcon,
  SparkleIcon,
  TagIcon,
} from "@phosphor-icons/react";

/**
 * Add a product or a service.
 *
 * Its own page rather than a dialog on the catalogue step, because the three
 * things that actually make a catalogue entry useful to an agent — variants,
 * the spec questions it must collect, and pictures — do not fit in a card on a
 * checklist, and squeezing them in is how they end up left out.
 *
 * It opens on the samples rather than on an empty form. A company writing its
 * first catalogue entry has to invent the shape of one before it can write it,
 * and "name, description, price" does not hint that the spec questions are what
 * turn a chat into an order. Picking a sample fills the form so it can be read
 * and edited; nothing is saved until Save is pressed.
 */

/**
 * One example.
 *
 * A `div` with a button role rather than a `<button>`, and that is not a
 * stylistic preference: a button's content model is phrasing content, so the
 * paragraphs and the rule inside one are invalid, and a button used as a flex
 * container does not stretch as a grid item — it takes its content height,
 * clips the overflow, and every card taller than its neighbours loses its last
 * two rows. Which is exactly what happened here.
 */
function SampleCard({
  sample,
  currency,
  onPick,
}: {
  sample: Sample;
  currency: string;
  onPick: () => void;
}) {
  const priced = typeof sample.price === "number";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick();
      }}
      aria-label={`Start from the ${sample.name} example`}
      className={cn(
        "group flex h-full cursor-pointer flex-col gap-3 rounded-xl border p-4 text-left transition-all",
        "hover:-translate-y-px hover:border-primary/40 hover:shadow-sm",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-medium">{sample.name}</p>
          <p className="text-xs text-muted-foreground">{sample.category}</p>
        </div>
        <Badge variant={sample.kind === "service" ? "outline" : "secondary"}>
          {sample.kind}
        </Badge>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {sample.description}
      </p>

      {/* The variants, as the swatches they will be saved as. */}
      {sample.variants ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {sample.variants.options.map((option) => (
            <span
              key={option.name}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-[11px] whitespace-nowrap"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={swatchDot(option.hex)}
                alt=""
                className="size-3 shrink-0 rounded-full"
              />
              {option.name}
            </span>
          ))}
        </div>
      ) : null}

      {/* `mt-auto` is what lines the footers up across a row of cards whose
          descriptions and swatch lists are different heights. */}
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-1">
        {priced ? (
          <span className="text-sm font-medium tabular-nums">
            {currency} {sample.price?.toLocaleString()}
            {sample.unit ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                {sample.unit}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            No price — enquiry only
          </span>
        )}
        <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
          {sample.requirements.length} question
          {sample.requirements.length === 1 ? "" : "s"}
        </span>
      </div>

      <Separator />

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <SparkleIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">{sample.demonstrates}</span>
      </p>

      <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        Use this example →
      </span>
    </div>
  );
}

/** The blank option, as the last tile rather than a second card below. */
function BlankCard({ onPick }: { onPick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick();
      }}
      className={cn(
        "flex h-full min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors",
        "hover:border-primary/40 hover:bg-muted/40",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      )}
    >
      <FilePlusIcon className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">Start from blank</p>
      <p className="text-xs text-muted-foreground">
        The same fields, none of them filled in
      </p>
    </div>
  );
}

export default function NewCataloguePage() {
  const workspace = useWorkspace();
  const back = `/w/${workspace.slug}/onboarding/catalogue`;

  /** Null until something is picked, so the samples get the whole page first. */
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  /* Bumped on every pick so the form remounts and re-seeds. `useState` reads
     its initial value once, and re-seeding by prop would need an effect that
     would then fight whatever is half-typed. */
  const [seed, setSeed] = useState(0);
  const [pack, setPack] = useState(SAMPLE_PACKS[0].id);

  const start = (next: ProductDraft) => {
    setDraft(next);
    setSeed((value) => value + 1);
    // The form replaces the samples in place, so put the reader at the top of
    // it rather than halfway down a list that is no longer on screen.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const active = SAMPLE_PACKS.find((candidate) => candidate.id === pack)!;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-3">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 self-start"
          nativeButton={false}
          render={<Link href={back} />}
        >
          <ArrowLeftIcon /> Catalogue
        </Button>

        {/* Top-aligned, so the action does not float against the middle of a
            two-line description. */}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {draft ? "New catalogue entry" : "Add a product or service"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {draft
                ? "Everything here is editable. Nothing is saved until you press save."
                : "Start from one of the examples — they are filled in the way an agent needs — or begin with a blank form."}
            </p>
          </div>
          {draft ? (
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              <SparkleIcon /> Back to the examples
            </Button>
          ) : null}
        </div>
      </header>

      {draft ? (
        <ProductForm
          key={seed}
          initial={draft}
          onSaved={(next) => {
            // "Save and add another" empties the form; drop back to the
            // samples so the next one is as easy to start as the first.
            if (next === "again") setDraft(null);
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Examples to start from</CardTitle>
            <CardDescription>
              Between them these cover every case the catalogue supports: a
              fixed price, a price with a unit, no price at all, colour and
              metal variants with their own pictures, and each of the five kinds
              of question an agent can be made to ask. Prices are placeholders
              in {workspace.currency} — change them to yours.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {SAMPLE_PACKS.map((candidate) => (
                <Button
                  key={candidate.id}
                  size="sm"
                  variant={candidate.id === pack ? "secondary" : "outline"}
                  onClick={() => setPack(candidate.id)}
                >
                  <TagIcon /> {candidate.label}
                </Button>
              ))}
              <p className="ml-1 text-sm text-muted-foreground">
                {active.blurb}
              </p>
            </div>

            <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {active.items.map((sample) => (
                <SampleCard
                  key={sample.name}
                  sample={sample}
                  currency={workspace.currency}
                  onPick={() => start(draftFromSample(sample))}
                />
              ))}
              <BlankCard onPick={() => start(EMPTY_DRAFT)} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
