"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  draftFromProduct,
  ProductForm,
} from "@/components/onboarding/product-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import {
  ArrowLeftIcon,
  PackageIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * View and edit one catalogue entry.
 *
 * The same form the add page uses, seeded from the saved product — see
 * `draftFromProduct`, which has to undo everything saving does to variants or
 * each edit would duplicate the swatches and ask the customer their colour
 * twice.
 *
 * It sits under `catalogue/` next to `new/`. A static segment beats a dynamic
 * sibling in the app router, so `new` stays the add page and everything else
 * is read as a product id.
 */
export default function EditProductPage({
  params,
}: PageProps<"/w/[slug]/onboarding/catalogue/[productId]">) {
  const { productId } = use(params);
  const workspace = useWorkspace();
  const router = useRouter();
  const removeProduct = useMutation(api.products.remove);
  const [removing, setRemoving] = useState(false);

  const back = `/w/${workspace.slug}/onboarding/catalogue`;
  const product = useQuery(api.products.get, {
    productId: productId as Id<"products">,
  });

  if (product === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    );
  }

  if (product === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarningIcon />
            </EmptyMedia>
            <EmptyTitle>That entry is gone</EmptyTitle>
            <EmptyDescription>
              It has been deleted, or the link is wrong.{" "}
              <Link href={back} className="underline underline-offset-4">
                Back to the catalogue
              </Link>
              .
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const drop = async () => {
    setRemoving(true);
    try {
      await removeProduct({ productId: product._id });
      toast.add({ title: `${product.name} removed`, type: "success" });
      router.push(back);
    } catch (error) {
      toast.add({
        title: "Could not remove it",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
      setRemoving(false);
    }
  };

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

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">
                {product.name}
              </h1>
              {product.tags.includes("service") ? (
                <Badge variant="outline">service</Badge>
              ) : null}
              {product.status === "archived" ? (
                <Badge variant="outline">archived</Badge>
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <PackageIcon className="size-4" />
              {product.category}
              <span aria-hidden="true">·</span>
              {product.requirementFields?.length ?? 0} question
              {(product.requirementFields?.length ?? 0) === 1 ? "" : "s"} before
              an order
              <span aria-hidden="true">·</span>
              {product.resolvedImages.length} picture
              {product.resolvedImages.length === 1 ? "" : "s"}
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" disabled={removing}>
                  <TrashIcon /> Remove
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {product.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your agents will stop discussing it immediately, and any
                  pictures stored against it are deleted. Orders already taken
                  keep their copy of the details.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => void drop()}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {/* Keyed on the id, so opening a different product re-seeds the form
          rather than leaving the last one's answers in the boxes. */}
      <ProductForm
        key={product._id}
        productId={product._id}
        initial={draftFromProduct(product)}
        onSaved={() => {}}
      />
    </div>
  );
}
