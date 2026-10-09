"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { SelectFieldOption } from "@/components/select-field";
import { CHAT_MODELS } from "@/convex/lib/shared";

/**
 * The options an agent's model picker offers.
 *
 * Read from Convex, because an administrator can relabel the chat models and
 * take them out of the picker from /admin/models, with `CHAT_MODELS` as the
 * first paint.
 *
 * `current` is the agent's saved model. One saved with a model the picker no
 * longer offers is appended, or the trigger would render empty and the next
 * save would silently move the agent onto whichever model it happened to show.
 */
export function useChatModelOptions(current?: string): SelectFieldOption[] {
  const catalogue = useQuery(api.models.catalogue, {});

  return useMemo(() => {
    const models = catalogue ?? CHAT_MODELS.map((model) => ({ ...model }));
    const options = models.map((model) => ({
      value: model.id,
      label: model.label,
    }));
    if (current && !options.some((option) => option.value === current)) {
      options.push({ value: current, label: `${current} (current)` });
    }
    return options;
  }, [catalogue, current]);
}
