"use client";

import { useMemo } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  CURRENCIES,
  LOCALES,
  allTimezones,
  timezoneCity,
  timezoneOffset,
} from "@/convex/lib/regional";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";

/**
 * Currency, locale and timezone, picked rather than typed.
 *
 * A searchable list rather than SelectField: there are four hundred timezones,
 * and "Dar" should find Dar es Salaam without scrolling through Africa. The
 * trigger is drawn to match SelectField's, so a form mixing the two reads as
 * one set of controls.
 */

type Option = { value: string; label: string; hint?: string };

// SelectTrigger's classes, so the two sit side by side without a seam.
const TRIGGER =
  "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50";

/** Letters and digits only, so "dar_es" and "Dar es" find the same zone. */
const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9+]+/g, " ");

function SearchSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  // A stored value the list does not offer still has to show — a workspace
  // set up with a code typed by hand must not open onto an empty trigger, or
  // saving the form would look like it cleared the field.
  const items = useMemo(
    () =>
      !value || options.some((option) => option.value === value)
        ? options
        : [{ value, label: value }, ...options],
    [options, value]
  );
  const selected = items.find((option) => option.value === value) ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      disabled={disabled}
      onValueChange={(next) => {
        const picked = next as Option | null;
        if (picked) onValueChange(picked.value);
      }}
      isItemEqualToValue={(a: Option, b: Option) => a.value === b.value}
      itemToStringLabel={(option: Option) => option.label}
      // Codes and hints are searchable, not just the label: "TZS", "GMT+3"
      // and "Africa/Dar" all have to land somewhere.
      filter={(option: Option, query: string) =>
        fold(`${option.value} ${option.label} ${option.hint ?? ""}`).includes(
          fold(query).trim()
        )
      }
      autoHighlight
    >
      <ComboboxPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        // The full value on hover: in a narrow three-up row the trigger
        // truncates "Dar es Salaam · Africa GMT+3" to its first word.
        title={
          selected
            ? [selected.label, selected.hint].filter(Boolean).join(" ")
            : undefined
        }
        className={cn(TRIGGER, className)}
      >
        <span className="min-w-0 flex-1 truncate">
          <ComboboxPrimitive.Value placeholder={placeholder}>
            {(option: Option | null) =>
              option ? (
                <>
                  {option.label}
                  {option.hint ? (
                    <span className="ml-1.5 text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )
            }
          </ComboboxPrimitive.Value>
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="pointer-events-none size-4 shrink-0 text-muted-foreground"
        />
      </ComboboxPrimitive.Trigger>

      <ComboboxContent className="w-auto min-w-[max(var(--anchor-width),18rem)]">
        <ComboboxInput showTrigger={false} placeholder={searchPlaceholder} />
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(option: Option) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.hint}
                </span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

type PickerProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

const CURRENCY_OPTIONS: Option[] = CURRENCIES.map((currency) => ({
  value: currency.value,
  label: `${currency.value} · ${currency.label}`,
}));

export function CurrencyPicker(props: PickerProps) {
  return (
    <SearchSelect
      {...props}
      options={CURRENCY_OPTIONS}
      placeholder="Pick a currency"
      searchPlaceholder="Search, e.g. TZS or shilling"
      emptyLabel="No currency matches."
    />
  );
}

const LOCALE_OPTIONS: Option[] = LOCALES.map((locale) => ({
  value: locale.value,
  label: locale.label,
  hint: locale.value,
}));

export function LocalePicker(props: PickerProps) {
  return (
    <SearchSelect
      {...props}
      options={LOCALE_OPTIONS}
      placeholder="Pick a locale"
      searchPlaceholder="Search, e.g. Swahili or en-TZ"
      emptyLabel="No locale matches."
    />
  );
}

export function TimezonePicker(props: PickerProps) {
  // Built once per mount: four hundred zones, each asked for its offset. The
  // offset is today's, so a zone on summer time reads as it does right now.
  const options = useMemo<Option[]>(() => {
    const now = new Date();
    return allTimezones().map((zone) => {
      const region = zone.includes("/") ? zone.split("/")[0] : null;
      return {
        value: zone,
        label: region ? `${timezoneCity(zone)} · ${region}` : zone,
        hint: timezoneOffset(zone, now) ?? undefined,
      };
    });
  }, []);

  return (
    <SearchSelect
      {...props}
      options={options}
      placeholder="Pick a timezone"
      searchPlaceholder="Search a city, e.g. Dar es Salaam"
      emptyLabel="No timezone matches."
    />
  );
}
