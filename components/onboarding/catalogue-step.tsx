"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { ProductThumbnail } from "@/components/product-images";
import { NothingYet } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { stepHref } from "@/lib/onboarding";
import {
  ArrowRightIcon,
  ImagesIcon,
  PencilSimpleIcon,
  PlusIcon,
  QuestionIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * Step 5 — the catalogue.
 *
 * Two platform rules make this step load-bearing rather than decorative: an
 * agent refuses to discuss a product that is not in the catalogue, and it never
 * quotes a price that is not stored on one. So an empty catalogue is an agent
 * that can talk about the company and sell nothing, and a catalogue with no
 * prices is an agent that has to hand every quote to a human.
 *
 * Adding lives on its own page — variants, spec questions and images need more
 * room than a card on a checklist, and cramming them in is how they end up left
 * out. What is left here is the list, and what each row is still missing.
 */

/** Products and services share a table; the tag is how they were told apart. */
const isService = (tags: string[]) => tags.includes("service");

/** The variant question, if the product has one — the first select field. */
const variantsOf = (
  fields: Array<{ type: string; label: string; options?: string[] }>
) => fields.find((field) => field.type === "select" && (field.options?.length ?? 0) > 0);

export function CatalogueStep() {
  const workspace = useWorkspace();
  const router = useRouter();
  const removeProduct = useMutation(api.products.remove);
  const products = useQuery(api.products.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const base = `/w/${workspace.slug}/onboarding/catalogue`;
  const addHref = `${base}/new`;

  const money = (amount: number) => {
    try {
      return new Intl.NumberFormat(workspace.locale, {
        style: "currency",
        currency: workspace.currency,
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
    } catch {
      // An unknown currency code should not take the page down.
      return `${workspace.currency} ${amount}`;
    }
  };

  const drop = async (productId: Id<"products">, name: string) => {
    try {
      await removeProduct({ productId });
      toast.add({ title: `${name} removed`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not remove it",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  if (products === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading the catalogue…
      </div>
    );
  }

  const live = products.filter((product) => product.status === "active");
  const services = live.filter((product) => isService(product.tags)).length;
  const priced = live.filter(
    (product) => typeof product.price === "number"
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {live.length === 0 ? (
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader>
            <CardTitle>Start with three or four best sellers</CardTitle>
            <CardDescription>
              They cover most of what gets asked. There are worked examples on
              the next page — a product with colour variants, one priced by the
              metre, a flat-fee service and one that must never be quoted — and
              picking one fills the form rather than saving anything.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button nativeButton={false} render={<Link href={addHref} />}>
              <SparkleIcon /> Add your first entry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            What the agents may sell
            <Badge variant="outline">
              {live.length - services} product
              {live.length - services === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              {services} service{services === 1 ? "" : "s"}
            </Badge>
            <Badge variant={priced > 0 ? "secondary" : "outline"}>
              {priced} priced
            </Badge>
          </CardTitle>
          <CardDescription>
            Anything not listed here, an agent will decline to discuss.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {live.length === 0 ? (
            <NothingYet>Nothing in the catalogue yet.</NothingYet>
          ) : null}

          {live.map((product) => {
            const variant = variantsOf(product.requirementFields ?? []);
            const pictures = product.resolvedImages?.length ?? 0;
            const questions = product.requirementFields?.length ?? 0;

            return (
              <div
                key={product._id}
                className="group flex items-start gap-3 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <ProductThumbnail
                  url={product.resolvedImages?.[0]?.url}
                  alt={product.resolvedImages?.[0]?.alt ?? product.name}
                  className="size-14"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The name is the link. A whole row that is a link would
                        swallow the remove button inside it. */}
                    <Link
                      href={`${base}/${product._id}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {product.name}
                    </Link>
                    {isService(product.tags) ? (
                      <Badge variant="outline">service</Badge>
                    ) : null}
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {product.description ||
                      "No description — the agent has nothing to say about this one."}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{product.category}</Badge>
                    {typeof product.price === "number" ? (
                      <Badge variant="secondary">
                        {money(product.price)}
                        {product.unit ? ` ${product.unit}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        no price — agent cannot quote
                      </Badge>
                    )}
                    {variant ? (
                      <Badge variant="outline">
                        {variant.label}: {variant.options?.join(", ")}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ImagesIcon className="size-3.5" />
                      {pictures} picture{pictures === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <QuestionIcon className="size-3.5" />
                      {questions} question{questions === 1 ? "" : "s"} before an
                      order
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link href={`${base}/${product._id}`} />
                    }
                  >
                    <PencilSimpleIcon /> Edit
                  </Button>
                  <Button
                    size="icon-lg"
                    variant="ghost"
                    aria-label={`Remove ${product.name}`}
                    onClick={() => void drop(product._id, product.name)}
                  >
                    <XIcon />
                  </Button>
                </div>
              </div>
            );
          })}

          <Button
            variant="outline"
            className="self-start"
            nativeButton={false}
            render={<Link href={addHref} />}
          >
            <PlusIcon /> Add a product or service
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Editing an existing entry, bulk CSV import and reordering pictures live
        on the{" "}
        <Link
          href={`/w/${workspace.slug}/products`}
          className="underline underline-offset-4"
        >
          catalogue
        </Link>{" "}
        page.
      </p>

      <div>
        <Button onClick={() => router.push(stepHref(workspace.slug, "stages"))}>
          Continue <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}
