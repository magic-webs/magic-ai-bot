"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { SelectFieldOption } from "@/components/select-field";
import { CHAT_MODELS } from "@/convex/lib/shared";

/**
 * The options an agent's model picker offers.
 *
 * The list is no longer a constant — an administrator adds and retires models
 * from /admin/models — so it is read from Convex, with `CHAT_MODELS` as the
 * first paint. That constant is what a fresh deployment's catalogue merges
 * from anyway, so the fallback is the same list in the same order rather than
 * a placeholder that shifts under the cursor once the query lands.
 *
 * `current` is the agent's saved model. An agent configured before the gateway
 * holds a bare id, and one configured with a model since retired holds an id
 * the picker no longer offers; either way, without appending it the trigger
 * would render empty and the next save would silently move the agent onto
 * whichever model the picker happened to show.
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
