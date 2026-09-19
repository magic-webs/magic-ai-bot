"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/select-field";
import { PlusIcon, XIcon } from "@phosphor-icons/react";

/**
 * One question an agent has to get an answer to.
 *
 * The same shape backs a product's specification checklist and a record book's
 * details, because they are the same thing seen twice: a list of things to ask
 * for before you are allowed to write the row. The editor lives here rather
 * than in either page so the two cannot drift.
 */
export type CollectedField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean" | "date";
  required: boolean;
  options?: string[];
  example?: string;
};

/** "Paper weight" → "paper_weight". The key is what the model sees. */
export function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function FieldListEditor({
  value,
  onChange,
  label,
  description,
  addLabel = "Add question",
  labelPlaceholder = "Label — e.g. Paper weight",
  examplePlaceholder = "Example answer — helps the agent phrase the question",
}: {
  value: CollectedField[];
  onChange: (next: CollectedField[]) => void;
  label: string;
  description?: React.ReactNode;
  addLabel?: string;
  labelPlaceholder?: string;
  examplePlaceholder?: string;
}) {
  const patch = (index: number, next: Partial<CollectedField>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
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
              placeholder={labelPlaceholder}
              onChange={(event) =>
                patch(index, {
                  label: event.target.value,
                  // Only while the key is still untouched: once someone has
                  // corrected it by hand, retyping the label must not undo it.
                  key: field.key || keyFromLabel(event.target.value),
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
                patch(index, { type: next as CollectedField["type"] })
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
              size="icon-lg"
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
              <span className="text-xs text-muted-foreground">required</span>
            </div>
            <Input
              className="min-w-40 flex-1"
              value={field.example ?? ""}
              placeholder={examplePlaceholder}
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
        size="lg"
        className="self-start"
        onClick={() =>
          onChange([
            ...value,
            { key: "", label: "", type: "text", required: true },
          ])
        }
      >
        <PlusIcon /> {addLabel}
      </Button>
    </div>
  );
}
