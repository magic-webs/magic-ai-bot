"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { PlusIcon, XIcon } from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// A list of short strings — used for rules, guardrails, tone traits, tags.
// ---------------------------------------------------------------------------

export function StringListEditor({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  description?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {value.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5"
            >
              <span className="flex-1 text-sm leading-relaxed">{item}</span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder ?? "Add an item…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          <PlusIcon /> Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip-style variant for short single-word values (tone traits, tags).
// ---------------------------------------------------------------------------

export function ChipListEditor({
  label,
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  };

  const unused = (suggestions ?? []).filter((s) => !value.includes(s));

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {value.map((item) => (
          <Badge key={item} variant="secondary" className="gap-1">
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              className="opacity-60 hover:opacity-100"
              onClick={() => onChange(value.filter((v) => v !== item))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        {value.length === 0 ? (
          <span className="text-sm text-muted-foreground">None yet</span>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder ?? "Add…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
              setDraft("");
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            add(draft);
            setDraft("");
          }}
        >
          <PlusIcon />
        </Button>
      </div>

      {unused.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {unused.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-sm text-muted-foreground"
              onClick={() => add(suggestion)}
            >
              + {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key/value pairs — company facts, product attributes, HTTP headers.
// ---------------------------------------------------------------------------

export type KeyValue = { key: string; value: string };

export function KeyValueEditor({
  label,
  description,
  value,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: {
  label: string;
  description?: string;
  value: KeyValue[];
  onChange: (next: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const patch = (index: number, patchValue: Partial<KeyValue>) => {
    onChange(
      value.map((row, i) => (i === index ? { ...row, ...patchValue } : row))
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {value.map((row, index) => (
        <div key={index} className="flex gap-2">
          <Input
            className="flex-1"
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(event) => patch(index, { key: event.target.value })}
          />
          <Input
            className="flex-[2]"
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(event) => patch(index, { value: event.target.value })}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Remove row"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...value, { key: "", value: "" }])}
      >
        <PlusIcon /> Add row
      </Button>
    </div>
  );
}
