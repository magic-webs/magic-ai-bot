"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { KeyValueEditor, ChipListEditor, type KeyValue } from "@/components/editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { SelectField } from "@/components/select-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import {
  PackageIcon,
  PlusIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  UploadSimpleIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";

type RequirementField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean" | "date";
  required: boolean;
  options?: string[];
  example?: string;
};

// ---------------------------------------------------------------------------
// The spec questions the agent must collect for a product.
// ---------------------------------------------------------------------------

function RequirementFieldsEditor({
  value,
  onChange,
}: {
  value: RequirementField[];
  onChange: (next: RequirementField[]) => void;
}) {
  const patch = (index: number, next: Partial<RequirementField>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label className="text-xs font-medium">Specification questions</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The agent is handed this checklist by{" "}
          <code>get_product_requirements</code> and must collect every required
          field before it can create an order.
        </p>
      </div>

      {value.map((field, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-md border border-border p-2"
        >
          <div className="flex gap-2">
            <Input
              className="flex-1"
              value={field.label}
              placeholder="Label — e.g. Paper weight"
              onChange={(event) =>
                patch(index, {
                  label: event.target.value,
                  key:
                    field.key ||
                    event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_|_$/g, ""),
                })
              }
            />
            <Input
              className="w-36 font-mono"
              value={field.key}
              placeholder="key"
              onChange={(event) => patch(index, { key: event.target.value })}
            />
            <SelectField
              className="w-28"
              aria-label="Field type"
              value={field.type}
              onValueChange={(next) =>
                patch(index, { type: next as RequirementField["type"] })
              }
              options={[
                { value: "text", label: "text" },
                { value: "number", label: "number" },
                { value: "select", label: "select" },
                { value: "boolean", label: "yes/no" },
                { value: "date", label: "date" },
              ]}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove field"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <XIcon />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Switch
                size="sm"
                checked={field.required}
                onCheckedChange={(checked) =>
                  patch(index, { required: checked })
                }
              />
              <span className="text-[0.625rem] text-muted-foreground">
                required
              </span>
            </div>
            <Input
              className="min-w-40 flex-1"
              value={field.example ?? ""}
              placeholder="Example answer — helps the agent phrase the question"
              onChange={(event) =>
                patch(index, { example: event.target.value })
              }
            />
            {field.type === "select" ? (
              <Input
                className="min-w-40 flex-1"
                value={(field.options ?? []).join(", ")}
                placeholder="Options, comma separated"
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
        <PlusIcon /> Add question
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

type ProductForm = {
  name: string;
  sku: string;
  category: string;
  description: string;
  price: string;
  unit: string;
  exampleSpec: string;
  notes: string;
  tags: string[];
  attributes: KeyValue[];
  requirementFields: RequirementField[];
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  category: "",
  description: "",
  price: "",
  unit: "",
  exampleSpec: "",
  notes: "",
  tags: [],
  attributes: [],
  requirementFields: [],
};

function ProductDialog({
  product,
  trigger,
}: {
  product?: Doc<"products">;
  trigger: React.ReactElement;
}) {
  const workspace = useWorkspace();
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ProductForm>(
    product
      ? {
          name: product.name,
          sku: product.sku ?? "",
          category: product.category,
          description: product.description,
          price: product.price !== undefined ? String(product.price) : "",
          unit: product.unit ?? "",
          exampleSpec: product.exampleSpec ?? "",
          notes: product.notes ?? "",
          tags: product.tags,
          attributes: product.attributes,
          requirementFields: product.requirementFields,
        }
      : emptyForm
  );

  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.add({ title: "A product name is required", type: "error" });
      return;
    }
    const parsedPrice = form.price.trim() ? Number(form.price) : undefined;
    if (parsedPrice !== undefined && !Number.isFinite(parsedPrice)) {
      toast.add({ title: "Price must be a number", type: "error" });
      return;
    }

    const payload = {
      name: form.name,
      sku: form.sku || undefined,
      category: form.category || undefined,
      description: form.description || undefined,
      price: parsedPrice,
      currency: parsedPrice !== undefined ? workspace.currency : undefined,
      unit: form.unit || undefined,
      exampleSpec: form.exampleSpec || undefined,
      notes: form.notes || undefined,
      tags: form.tags,
      attributes: form.attributes.filter((a) => a.key.trim()),
      requirementFields: form.requirementFields.filter((f) => f.key.trim()),
    };

    setBusy(true);
    try {
      if (product) {
        await updateProduct({ productId: product._id, ...payload });
        toast.add({ title: "Product updated", type: "success" });
      } else {
        await createProduct({ workspaceId: workspace._id, ...payload });
        toast.add({ title: "Product added", type: "success" });
        setForm(emptyForm);
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {product ? `Edit ${product.name}` : "Add a product"}
          </DialogTitle>
          <DialogDescription>
            Leave the price empty if the team quotes manually — the agent is then
            told never to quote.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={form.name}
                placeholder="Business cards"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-category">Category</Label>
              <Input
                id="p-category"
                value={form.category}
                placeholder="Business stationery"
                onChange={(event) => set("category", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-description">Description</Label>
            <Textarea
              id="p-description"
              rows={2}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-sku">SKU</Label>
              <Input
                id="p-sku"
                value={form.sku}
                onChange={(event) => set("sku", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-price">Price ({workspace.currency})</Label>
              <Input
                id="p-price"
                value={form.price}
                placeholder="Leave empty for manual quoting"
                onChange={(event) => set("price", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-unit">Unit</Label>
              <Input
                id="p-unit"
                value={form.unit}
                placeholder="per 1000"
                onChange={(event) => set("unit", event.target.value)}
              />
            </div>
          </div>

          <Separator />

          <RequirementFieldsEditor
            value={form.requirementFields}
            onChange={(next) => set("requirementFields", next)}
          />

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-example">Example specification</Label>
            <Input
              id="p-example"
              value={form.exampleSpec}
              placeholder="55 × 85mm, 4 colour on 450gsm silk, matt laminated both sides"
              onChange={(event) => set("exampleSpec", event.target.value)}
            />
            <p className="text-[0.625rem] text-muted-foreground">
              Given to the agent so it can offer a typical spec instead of asking
              blind.
            </p>
          </div>

          <ChipListEditor
            label="Tags"
            value={form.tags}
            onChange={(next) => set("tags", next)}
            placeholder="corporate"
          />

          <KeyValueEditor
            label="Attributes"
            description="Extra facts the agent may state — lead time, minimum order, finish options."
            value={form.attributes}
            onChange={(next) => set("attributes", next)}
            keyPlaceholder="Lead time"
            valuePlaceholder="5 working days"
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-notes">Internal notes for the agent</Label>
            <Textarea
              id="p-notes"
              rows={2}
              value={form.notes}
              placeholder="Always ask whether they need matching letterheads."
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {product ? "Save changes" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk import + AI draft
// ---------------------------------------------------------------------------

function ImportDialog() {
  const workspace = useWorkspace();
  const bulkImport = useMutation(api.products.bulkImport);
  const draftCatalogue = useAction(api.ai.draftCatalogue);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState("");
  const [brief, setBrief] = useState("");

  const runImport = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        throw new Error("The JSON must be an array of product objects.");
      }
      const result = await bulkImport({
        workspaceId: workspace._id,
        products: parsed,
      });
      toast.add({
        title: `${result.created} added, ${result.updated} updated`,
        type: "success",
      });
      setJson("");
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Import failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const runDraft = async () => {
    setBusy(true);
    try {
      const result = await draftCatalogue({
        workspaceId: workspace._id,
        brief: brief || undefined,
      });
      toast.add({
        title: `${result.created} products drafted`,
        description: "Review each one and adjust the spec questions.",
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Drafting failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <UploadSimpleIcon /> Import
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Populate the catalogue</DialogTitle>
          <DialogDescription>
            Paste JSON exported from your own system, or let the model draft a
            starter catalogue from the workspace description.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="draft">
          <TabsList className="w-full">
            <TabsTrigger value="draft">
              <SparkleIcon /> Draft with AI
            </TabsTrigger>
            <TabsTrigger value="json">
              <UploadSimpleIcon /> Paste JSON
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draft" className="flex flex-col gap-3 pt-3">
            <Textarea
              rows={4}
              value={brief}
              placeholder="Optional: anything specific about the range — e.g. we only do litho, no digital; packaging is our biggest line."
              onChange={(event) => setBrief(event.target.value)}
            />
            <Button onClick={runDraft} disabled={busy}>
              {busy ? <Spinner /> : <SparkleIcon />} Draft the catalogue
            </Button>
          </TabsContent>

          <TabsContent value="json" className="flex flex-col gap-3 pt-3">
            <Textarea
              rows={10}
              className="font-mono"
              value={json}
              placeholder={`[\n  {\n    "name": "Business cards",\n    "category": "Stationery",\n    "description": "Printed both sides on 450gsm silk",\n    "requirementFields": [\n      { "key": "quantity", "label": "Quantity", "type": "number", "required": true }\n    ]\n  }\n]`}
              onChange={(event) => setJson(event.target.value)}
            />
            <p className="text-[0.625rem] text-muted-foreground">
              Products are matched by name — an existing product with the same
              name is updated rather than duplicated.
            </p>
            <Button onClick={runImport} disabled={busy}>
              {busy ? <Spinner /> : <UploadSimpleIcon />} Import
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export default function ProductsPage() {
  const workspace = useWorkspace();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const products = useQuery(api.products.listByWorkspace, {
    workspaceId: workspace._id,
    search: search.trim() || undefined,
    category: category === "all" ? undefined : category,
  });
  const categories = useQuery(api.products.categories, {
    workspaceId: workspace._id,
  });
  const removeProduct = useMutation(api.products.remove);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            Catalogue
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            What the agents are allowed to talk about, and the exact
            specifications they must collect for each product.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportDialog />
          <ProductDialog
            trigger={
              <Button>
                <PlusIcon /> Add product
              </Button>
            }
          />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search the catalogue…"
            className="pl-7"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <SelectField
          value={category}
          aria-label="Filter by category"
          onValueChange={setCategory}
          options={[
            { value: "all", label: "All categories" },
            ...(categories ?? []).map((name) => ({
              value: name,
              label: name,
            })),
          ]}
        />
      </div>

      {products === undefined ? (
        <Spinner />
      ) : products.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon />
            </EmptyMedia>
            <EmptyTitle>
              {search ? "No products match" : "The catalogue is empty"}
            </EmptyTitle>
            <EmptyDescription>
              {search
                ? "Try a different search term."
                : "Agents refuse to discuss products that aren't listed here. Add them manually, paste JSON, or let the model draft a starter set."}
            </EmptyDescription>
          </EmptyHeader>
          {!search ? (
            <EmptyContent>
              <div className="flex gap-2">
                <ImportDialog />
                <ProductDialog
                  trigger={
                    <Button>
                      <PlusIcon /> Add product
                    </Button>
                  }
                />
              </div>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Spec questions</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product._id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{product.name}</span>
                      <span className="line-clamp-1 text-[0.625rem] text-muted-foreground">
                        {product.description || "No description"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{product.category}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {product.price !== undefined ? (
                      <span>
                        {product.currency ?? workspace.currency}{" "}
                        {product.price.toFixed(2)}
                        {product.unit ? (
                          <span className="text-muted-foreground">
                            {" "}
                            {product.unit}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">quoted</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {product.requirementFields.length === 0 ? (
                        <span className="text-[0.625rem] text-muted-foreground">
                          none — the agent will improvise
                        </span>
                      ) : (
                        product.requirementFields.map((field) => (
                          <Badge
                            key={field.key}
                            variant={field.required ? "outline" : "ghost"}
                            className="font-mono text-[0.625rem]"
                          >
                            {field.key}
                            {field.required ? "*" : ""}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <ProductDialog
                        product={product}
                        trigger={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${product.name}`}
                          >
                            <PencilSimpleIcon />
                          </Button>
                        }
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${product.name}`}
                        onClick={async () => {
                          await removeProduct({
                            productId: product._id as Id<"products">,
                          });
                          toast.add({
                            title: "Product deleted",
                            type: "success",
                          });
                        }}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
