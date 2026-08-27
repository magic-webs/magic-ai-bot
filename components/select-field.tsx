"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectFieldOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/**
 * The shadcn Select parts wired up for the single-value, labelled-options case
 * that every form in this dashboard needs.
 *
 * Base UI's Select reads `items` to work out what to show on the trigger for the
 * current value, so that mapping is derived here rather than at each call site.
 */
export function SelectField({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  size,
  className,
  contentClassName,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  id?: string;
  size?: "sm" | "default";
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const items = useMemo(
    () =>
      Object.fromEntries(options.map((option) => [option.value, option.label])),
    [options]
  );

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onValueChange(next == null ? "" : String(next))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Grow to fit long option labels instead of truncating to trigger width. */}
      <SelectContent
        className={cn("w-auto min-w-(--anchor-width)", contentClassName)}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
