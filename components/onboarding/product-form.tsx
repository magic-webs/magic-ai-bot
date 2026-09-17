"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  ProductImagesEditor,
  uploadDrafts,
  type ImageDraft,
} from "@/components/product-images";
import { ChipListEditor } from "@/components/editors";
import { FormRow } from "@/components/onboarding/shell";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  hexFromSwatch,
  swatchDot,
  swatchImage,
  VARIANT_PALETTE,
  type RequirementDraft,
  type RequirementType,
  type Sample,
  type VariantGroup,
  type VariantOption,
} from "@/lib/catalogue-samples";
import {
  CheckCircleIcon,
  PaletteIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * The add-a-product form.
 *
 * Three things the short inline form on the catalogue step could not do, and
 * the reason this is a page of its own:
 *
 *  - **Variants.** The platform has no variant table. "We do it in black and
 *    blue" is stored as a `select` requirement field the agent must ask, plus
 *    one image per option — and nobody works that out from a blank form. Here
 *    it is one editor, and saving writes all three consequences: the question,
 *    the images and an attribute line so the fact also reaches the prompt.
 *  - **Spec questions.** `get_product_requirements` hands the agent this
 *    checklist and it cannot complete an order until every required answer is
 *    collected. It is the difference between a chat and an order.
 *  - **Images.** Uploading needs a storage round trip, which wants more room
 *    than a card on a checklist page.
 */

export type ProductDraft = {
  /** Presentation and defaults only — stored as a tag, since products and
      services are one table and differ in how they are talked about. */
  kind: "product" | "service";
  name: string;
  category: string;
  description: string;
  /** A string, not a number: an in-progress "12." is not a number yet. */
  price: string;
  unit: string;
  tags: string[];
  images: ImageDraft[];
  variants: VariantGroup | null;
  requirements: RequirementDraft[];
  notes: string;
};

export const EMPTY_DRAFT: ProductDraft = {
  kind: "product",
  name: "",
  category: "",
  description: "",
  price: "",
  unit: "",
  tags: [],
  images: [],
  variants: null,
  requirements: [],
  notes: "",
};

const slugKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "field";

/**
 * A sample, as the form holds it.
 *
 * The variant question is dropped from the requirement list on the way in: a
 * sample lists it there so the card can show everything the agent will ask,
 * but in the form the variant editor owns it, and saving puts it back. Left in
 * both places the customer would be asked their colour twice.
 */
export function draftFromSample(sample: Sample): ProductDraft {
  const optionNames = sample.variants?.options.map((option) => option.name) ?? [];
  const isVariantQuestion = (field: RequirementDraft) =>
    optionNames.length > 0 &&
    field.type === "select" &&
    (field.options ?? []).length === optionNames.length &&
    (field.options ?? []).every((option) => optionNames.includes(option));

  return {
    kind: sample.kind,
    name: sample.name,
    category: sample.category,
    description: sample.description,
    price: sample.price === undefined ? "" : String(sample.price),
    unit: sample.unit ?? "",
    tags: sample.tags,
    images: [],
    variants: sample.variants ?? null,
    requirements: sample.requirements.filter((field) => !isVariantQuestion(field)),
    notes: sample.notes ?? "",
  };
}

/**
 * A saved product, as the form holds it.
 *
 * The inverse of `variantConsequences` below, and it has to undo all three of
 * that function's effects or editing would duplicate them: the variant select
 * question comes out of the requirement list, the generated swatches come out
 * of the image list, and the attribute is dropped because saving writes it
 * again. Uploaded photographs are not swatches, so they stay where they are.
 *
 * A product created on the main catalogue page has no variant group to find —
 * its select fields simply stay in the questions list, which is where someone
 * who wrote them there expects them.
 */
export function draftFromProduct(
  product: Doc<"products"> & {
    resolvedImages: Array<{ url: string; alt: string | null }>;
  }
): ProductDraft {
  const fields = (product.requirementFields ?? []) as RequirementDraft[];

  /* The variant question is the select whose options an attribute repeats —
     that pairing is what this form writes, and matching on it rather than on
     "the first select" keeps hand-written select questions out of the variant
     editor. */
  const attributes = product.attributes ?? [];
  const variantField = fields.find(
    (field) =>
      field.type === "select" &&
      (field.options?.length ?? 0) > 0 &&
      attributes.some(
        (attribute) =>
          attribute.value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .join("|")
            .toLowerCase() === (field.options ?? []).join("|").toLowerCase()
      )
  );

  /* `images` and `resolvedImages` are matched by position; resolveImages drops
     entries whose file has gone missing, so the shorter list wins. */
  const stored = (product.images ?? []).slice(0, product.resolvedImages.length);
  const paired = stored.map((image, index) => ({
    image,
    url: product.resolvedImages[index].url,
    alt: product.resolvedImages[index].alt ?? image.alt ?? "",
  }));

  const swatchFor = (option: string) =>
    paired.find(
      (entry) =>
        hexFromSwatch(entry.url) !== null &&
        entry.alt.trim().toLowerCase().endsWith(option.trim().toLowerCase())
    );

  const variants: VariantGroup | null = variantField
    ? {
        label: variantField.label,
        options: (variantField.options ?? []).map((name) => ({
          name,
          // No swatch to read it back off — a colour picked in the editor and
          // then replaced by a photograph, most likely. Grey is a visible
          // "pick one" rather than a wrong guess.
          hex: swatchFor(name)?.url
            ? (hexFromSwatch(swatchFor(name)!.url) ?? "#6b7280")
            : "#6b7280",
        })),
      }
    : null;

  const variantSwatchUrls = new Set(
    variants
      ? (variantField?.options ?? [])
          .map((name) => swatchFor(name)?.url)
          .filter((url): url is string => Boolean(url))
      : []
  );

  return {
    kind: product.tags.includes("service") ? "service" : "product",
    name: product.name,
    category: product.category,
    description: product.description,
    price: product.price === undefined ? "" : String(product.price),
    unit: product.unit ?? "",
    // `service` is how the kind is stored, so it is not also a tag to edit.
    tags: product.tags.filter((tag) => tag !== "service"),
    images: paired
      .filter((entry) => !variantSwatchUrls.has(entry.url))
      .map((entry) => ({
        storageId: entry.image.storageId,
        externalUrl: entry.image.externalUrl,
        alt: entry.alt,
        preview: entry.url,
      })),
    variants,
    requirements: fields.filter((field) => field !== variantField),
    notes: product.notes ?? "",
  };
}

/** Everything the variant group turns into once the product is saved. */
function variantConsequences(draft: ProductDraft) {
  const group = draft.variants;
  if (!group || group.options.length === 0) {
    return { question: null, images: [] as ImageDraft[], attribute: null };
  }

  const names = group.options.map((option) => option.name.trim()).filter(Boolean);
  if (names.length === 0) {
    return { question: null, images: [] as ImageDraft[], attribute: null };
  }

  const question: RequirementDraft = {
    key: slugKey(group.label),
    label: group.label.trim() || "Option",
    type: "select",
    required: true,
    options: names,
  };

  const images: ImageDraft[] = group.options
    .filter((option) => option.name.trim())
    .map((option) => {
      const uri = swatchImage(
        option.hex,
        option.name.trim(),
        draft.name.trim() || "Product"
      );
      return {
        externalUrl: uri,
        alt: `${draft.name.trim() || "Product"} — ${option.name.trim()}`,
        preview: uri,
      };
    });

  return {
    question,
    images,
    attribute: { key: group.label.trim() || "Options", value: names.join(", ") },
  };
}

// ------------------------------------------------------------------ variants

function VariantEditor({
  value,
  productName,
  onChange,
}: {
  value: VariantGroup | null;
  productName: string;
  onChange: (next: VariantGroup | null) => void;
}) {
  const [custom, setCustom] = useState("");

  if (!value) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
        <p className="text-sm text-muted-foreground">
          Does this come in more than one colour, metal, finish or size? Add the
          options and each one gets its own picture and its own question.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ label: "Colour", options: VARIANT_PALETTE.slice(0, 2) })
          }
        >
          <PaletteIcon /> Add variants
        </Button>
      </div>
    );
  }

  const patchOption = (index: number, next: Partial<VariantOption>) =>
    onChange({
      ...value,
      options: value.options.map((option, i) =>
        i === index ? { ...option, ...next } : option
      ),
    });

  const used = new Set(value.options.map((option) => option.name.toLowerCase()));
  const unused = VARIANT_PALETTE.filter(
    (option) => !used.has(option.name.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <FormRow
            label="What varies"
            hint="Becomes the question the agent asks — “which metal would you like?”"
          >
            <Input
              value={value.label}
              onChange={(event) =>
                onChange({ ...value, label: event.target.value })
              }
              placeholder="Colour"
              className="max-w-60"
            />
          </FormRow>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(null)}
          aria-label="Remove variants"
        >
          <XIcon /> Remove
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Options</Label>
        {value.options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            {/* The live swatch, which is exactly the image that will be saved
                against the product — a preview, not an approximation. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={swatchImage(option.hex, option.name || "?", productName || "Product")}
              alt=""
              className="h-10 w-14 shrink-0 rounded border object-cover"
            />
            <Input
              className="flex-1"
              value={option.name}
              onChange={(event) => patchOption(index, { name: event.target.value })}
              placeholder="Black"
            />
            <label className="relative shrink-0" aria-label={`Colour for ${option.name || "this option"}`}>
              <input
                type="color"
                value={option.hex}
                onChange={(event) => patchOption(index, { hex: event.target.value })}
                className="size-9 cursor-pointer rounded-md border bg-background p-1"
              />
            </label>
            <Button
              size="icon-lg"
              variant="ghost"
              aria-label={`Remove ${option.name || "option"}`}
              onClick={() =>
                onChange({
                  ...value,
                  options: value.options.filter((_, i) => i !== index),
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}

        {value.options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No options yet — pick one below.
          </p>
        ) : null}
      </div>

      {unused.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {unused.map((option) => (
            <Button
              key={option.name}
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({ ...value, options: [...value.options, option] })
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={swatchDot(option.hex)} alt="" className="size-3.5 rounded-full" />
              {option.name}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !custom.trim()) return;
            event.preventDefault();
            onChange({
              ...value,
              options: [...value.options, { name: custom.trim(), hex: "#6b7280" }],
            });
            setCustom("");
          }}
          placeholder="Or type your own — “Emerald”, “Small”, “Matt”"
        />
        <Button
          variant="outline"
          disabled={!custom.trim()}
          onClick={() => {
            onChange({
              ...value,
              options: [...value.options, { name: custom.trim(), hex: "#6b7280" }],
            });
            setCustom("");
          }}
        >
          <PlusIcon /> Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Each option is saved as a picture on the product and as one question the
        agent must ask. Replace the pictures with your own photographs whenever
        you have them — these are labelled placeholders, not stock photos.
      </p>
    </div>
  );
}

// -------------------------------------------------------------- requirements

const TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Pick one" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
];

function RequirementEditor({
  value,
  onChange,
}: {
  value: RequirementDraft[];
  onChange: (next: RequirementDraft[]) => void;
}) {
  const patch = (index: number, next: Partial<RequirementDraft>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div className="flex flex-col gap-3">
      {value.map((field, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex gap-2">
            <Input
              className="flex-1"
              value={field.label}
              placeholder="Ring size"
              onChange={(event) =>
                patch(index, {
                  label: event.target.value,
                  // The key is what the order is filed under. Derived while it
                  // is still empty, then left alone — renaming the label of a
                  // question that already has orders against it should not
                  // silently re-file them.
                  key: field.key || slugKey(event.target.value),
                })
              }
            />
            <SelectField
              className="w-32"
              aria-label="Answer type"
              value={field.type}
              onValueChange={(next) =>
                patch(index, { type: next as RequirementType })
              }
              options={TYPE_OPTIONS}
            />
            <Button
              size="icon-lg"
              variant="ghost"
              aria-label={`Remove ${field.label || "question"}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <XIcon />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <Switch
                size="sm"
                checked={field.required}
                onCheckedChange={(checked) => patch(index, { required: checked })}
              />
              <span className="text-xs text-muted-foreground">
                must be answered
              </span>
            </label>
            <Input
              className="min-w-48 flex-1"
              value={field.example ?? ""}
              placeholder="Example answer — helps the agent phrase the question"
              onChange={(event) => patch(index, { example: event.target.value })}
            />
          </div>

          {field.type === "select" ? (
            <Input
              value={(field.options ?? []).join(", ")}
              placeholder="Options, separated by commas"
              onChange={(event) =>
                patch(index, {
                  options: event.target.value
                    .split(",")
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : null}
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          onChange([
            ...value,
            { key: "", label: "", type: "text", required: true },
          ])
        }
      >
        <PlusIcon /> Add a question
      </Button>
    </div>
  );
}

// -------------------------------------------------------------------- the form

export function ProductForm({
  initial,
  productId,
  onSaved,
}: {
  initial: ProductDraft;
  /** Set to edit that product instead of creating a new one. */
  productId?: Id<"products">;
  /** Called after a successful save, with what to do next. */
  onSaved: (next: "again" | "done") => void;
}) {
  const workspace = useWorkspace();
  const router = useRouter();
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);
  const generateUploadUrl = useMutation(api.products.generateUploadUrl);

  const editing = productId !== undefined;
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const service = draft.kind === "service";

  /* A comma decimal separator is what half the world's keyboards offer, and
     `Number("12,50")` is NaN — which would quietly store an unpriced product
     rather than refuse. */
  const parsedPrice = draft.price.trim()
    ? Number(draft.price.trim().replace(",", "."))
    : null;
  const priceBroken = parsedPrice !== null && !Number.isFinite(parsedPrice);
  const ready =
    draft.name.trim().length > 0 &&
    draft.description.trim().length > 0 &&
    !priceBroken;

  const consequences = variantConsequences(draft);

  const save = async (then: "again" | "done") => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const images = await uploadDrafts(
        [...draft.images, ...consequences.images],
        generateUploadUrl
      );

      const requirements = [
        ...(consequences.question ? [consequences.question] : []),
        ...draft.requirements.filter((field) => field.label.trim()),
      ].map((field) => ({
        ...field,
        key: field.key.trim() || slugKey(field.label),
        label: field.label.trim(),
      }));

      const priced = parsedPrice !== null && Number.isFinite(parsedPrice);
      const common = {
        name: draft.name.trim(),
        category: draft.category.trim() || (service ? "Services" : "General"),
        description: draft.description.trim(),
        ...(priced ? { price: parsedPrice, currency: workspace.currency } : {}),
        unit: draft.unit.trim() || undefined,
        // `service` rides along as a tag: products and services are one table,
        // and the tag is what lets the catalogue label them apart.
        tags: service
          ? Array.from(new Set([...draft.tags, "service"]))
          : draft.tags,
        images,
        requirementFields: requirements,
        attributes: consequences.attribute ? [consequences.attribute] : [],
        notes: draft.notes.trim() || undefined,
      };

      if (productId) {
        await updateProduct({
          productId,
          ...common,
          /* An omitted argument means "leave it alone", so emptying the price
             box has to say so explicitly or a product can never stop being
             quotable. */
          ...(priced ? {} : { clearPrice: true }),
        });
      } else {
        await createProduct({ workspaceId: workspace._id, ...common });
      }

      toast.add({
        title: editing
          ? `${draft.name.trim()} saved`
          : `${draft.name.trim()} added to the catalogue`,
        type: "success",
      });

      if (then === "done") {
        router.push(`/w/${workspace.slug}/onboarding/catalogue`);
      } else {
        setDraft(EMPTY_DRAFT);
        onSaved("again");
      }
    } catch (error) {
      toast.add({
        title: "Could not save",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------------ kind */}
      <Card>
        <CardHeader>
          <CardTitle>What are you adding?</CardTitle>
          <CardDescription>
            Both live in the same catalogue. The difference is how an agent
            talks about it — a service has nothing to ship and usually nothing
            to photograph.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Divs rather than buttons, for the same reason the sample cards
              are: a button used as a flex container does not stretch as a grid
              item, so the longer of the two descriptions gets clipped. */}
          <div role="radiogroup" aria-label="What are you adding?" className="grid gap-3 sm:grid-cols-2">
            {(["product", "service"] as const).map((kind) => {
              const picked = draft.kind === kind;
              return (
                <div
                  key={kind}
                  role="radio"
                  tabIndex={0}
                  aria-checked={picked}
                  onClick={() => set("kind", kind)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    set("kind", kind);
                  }}
                  className={cn(
                    "flex h-full cursor-pointer items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
                    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    picked
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-muted/40 ring-1 ring-border hover:bg-muted"
                  )}
                >
                  <CheckCircleIcon
                    weight={picked ? "fill" : "regular"}
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      picked ? "text-primary" : "text-muted-foreground/40"
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {kind === "product" ? "A product" : "A service"}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {kind === "product"
                        ? "Something you make, stock or ship. Usually has variants and a picture."
                        : "Something you do — a visit, an hour, a setup fee. Priced flat or on the brief."}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* --------------------------------------------------------- details */}
      <Card>
        <CardHeader>
          <CardTitle>The basics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormRow label="Name">
            <Input
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder={
                service ? "Site survey and installation" : "Illuminated fascia sign"
              }
            />
          </FormRow>

          <FormRow
            label="Description"
            hint="What an agent answers “what is it?” with. Two sentences beats a paragraph."
          >
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
              placeholder={
                service
                  ? "We measure on site, check the fixing and fit the finished sign. Covers travel within 30 miles."
                  : "Aluminium tray with an acrylic face and LED illumination, made to your shopfront width and installed by us."
              }
            />
          </FormRow>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormRow
              label="Category"
              optional
              hint={service ? "Left empty it goes under Services." : "Left empty it goes under General."}
            >
              <Input
                value={draft.category}
                onChange={(event) => set("category", event.target.value)}
                placeholder={service ? "Services" : "Shopfront signage"}
              />
            </FormRow>
            <FormRow
              label={`Price in ${workspace.currency}`}
              optional
              hint="Leave it empty and the agent has to pass the quote to you — which is the right answer for bespoke work."
            >
              <Input
                value={draft.price}
                onChange={(event) => set("price", event.target.value)}
                placeholder="450"
                aria-invalid={priceBroken}
              />
            </FormRow>
            <FormRow
              label="Unit"
              optional
              hint="Said straight after the price."
            >
              <Input
                value={draft.unit}
                onChange={(event) => set("unit", event.target.value)}
                placeholder={service ? "per visit" : "per linear metre"}
              />
            </FormRow>
          </div>

          {priceBroken ? (
            <p className="text-xs text-destructive">
              That price is not a number. Write it in digits, like 450 or 450.00.
            </p>
          ) : null}

          <ChipListEditor
            label="Tags"
            value={draft.tags}
            onChange={(tags) => set("tags", tags)}
            placeholder="made to measure"
          />
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- variants */}
      <Card>
        <CardHeader>
          <CardTitle>Variants</CardTitle>
          <CardDescription>
            Colours, metals, finishes, sizes — anything the same product comes
            in more than one of.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VariantEditor
            value={draft.variants}
            productName={draft.name}
            onChange={(variants) => set("variants", variants)}
          />
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- images */}
      <Card>
        <CardHeader>
          <CardTitle>Pictures</CardTitle>
          <CardDescription>
            The first one is the thumbnail, and the one an agent offers when a
            customer asks what it looks like.
            {consequences.images.length > 0
              ? ` ${consequences.images.length} variant swatch${
                  consequences.images.length === 1 ? "" : "es"
                } will be added below these when you save.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductImagesEditor
            value={draft.images}
            onChange={(images) => set("images", images)}
          />
        </CardContent>
      </Card>

      {/* ---------------------------------------------------- requirements */}
      <Card>
        <CardHeader>
          <CardTitle>What the agent must ask</CardTitle>
          <CardDescription>
            The agent is handed this checklist and cannot complete an order
            until every required answer is collected. This is the difference
            between a conversation and an order.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {consequences.question ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <CheckCircleIcon weight="fill" className="size-4 shrink-0 text-primary" />
              <p className="text-sm">
                <span className="font-medium">{consequences.question.label}</span>{" "}
                is added automatically from your variants —{" "}
                {consequences.question.options?.join(", ")}.
              </p>
            </div>
          ) : null}

          <RequirementEditor
            value={draft.requirements}
            onChange={(requirements) => set("requirements", requirements)}
          />
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- notes */}
      <Card>
        <CardHeader>
          <CardTitle>Anything the agent should know but not say</CardTitle>
        </CardHeader>
        <CardContent>
          <FormRow
            label="Internal notes"
            optional
            hint="Read by the agent, never quoted to a customer — margins, minimums, the thing that always goes wrong."
          >
            <Textarea
              rows={2}
              value={draft.notes}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="Under 10 pieces carries a small-run surcharge."
            />
          </FormRow>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save("done")} disabled={!ready || saving}>
          {saving ? <Spinner /> : <CheckCircleIcon />}
          {saving ? "Saving…" : editing ? "Save changes" : "Save and go back"}
        </Button>
        {editing ? (
          <Button
            variant="ghost"
            onClick={() => router.push(`/w/${workspace.slug}/onboarding/catalogue`)}
            disabled={saving}
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => void save("again")}
            disabled={!ready || saving}
          >
            <PlusIcon /> Save and add another
          </Button>
        )}
        {!ready && !priceBroken ? (
          <Badge variant="outline" className="text-muted-foreground">
            A name and a description are needed
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
