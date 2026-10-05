"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CheckIcon, MinusCircleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { plural, type Category } from "./shared";

export type AudienceChoice = {
  audienceIds: Id<"audiences">[];
  categories: string[];
  tags: string[];
  excludeAudienceIds: Id<"audiences">[];
};

export const EVERYONE: AudienceChoice = {
  audienceIds: [],
  categories: [],
  tags: [],
  excludeAudienceIds: [],
};

export function isEveryone(choice: AudienceChoice) {
  return choice.audienceIds.length === 0 && choice.categories.length === 0 && choice.tags.length === 0;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Chip({
  active,
  excluded,
  onClick,
  children,
  count,
}: {
  active: boolean;
  excluded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        excluded
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : active
            ? "border-primary bg-primary/10 text-primary"
            : "border-border hover:bg-muted/50"
      )}
    >
      {excluded ? <MinusCircleIcon className="size-3.5" /> : active ? <CheckIcon className="size-3.5" /> : null}
      {children}
      {count !== undefined ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
    </button>
  );
}

export function AudiencePicker({
  value,
  onChange,
  categories,
}: {
  value: AudienceChoice;
  onChange: (next: AudienceChoice) => void;
  categories: Category[];
}) {
  const workspace = useWorkspace();
  const audiences = useQuery(api.audience.list, { workspaceId: workspace._id });
  const summary = useQuery(api.audience.tags, { workspaceId: workspace._id });
  const everyone = isEveryone(value);

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        variant="outline"
        value={[everyone ? "everyone" : "some"]}
        onValueChange={(next) => {
          if (next[0] === "everyone") onChange({ ...EVERYONE, excludeAudienceIds: value.excludeAudienceIds });
          if (next[0] === "some" && everyone && categories[0]) {
            onChange({ ...value, categories: [categories[0].key] });
          }
        }}
      >
        <ToggleGroupItem value="everyone">Everyone subscribed</ToggleGroupItem>
        <ToggleGroupItem value="some">Choose who</ToggleGroupItem>
      </ToggleGroup>

      {!everyone ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Categories</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => (
                <Chip
                  key={category.key}
                  active={value.categories.includes(category.key)}
                  count={summary?.categories[category.key]}
                  onClick={() => onChange({ ...value, categories: toggle(value.categories, category.key) })}
                >
                  {category.label}
                </Chip>
              ))}
            </div>
          </div>
          {audiences && audiences.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Lists</p>
              <div className="flex flex-wrap gap-1.5">
                {audiences.map((audience) => (
                  <Chip
                    key={audience._id}
                    active={value.audienceIds.includes(audience._id)}
                    count={audience.memberCount}
                    onClick={() =>
                      onChange({
                        ...value,
                        audienceIds: toggle(value.audienceIds, audience._id),
                        excludeAudienceIds: value.excludeAudienceIds.filter((id) => id !== audience._id),
                      })
                    }
                  >
                    {audience.name}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          {summary && summary.tags.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {summary.tags.slice(0, 30).map((row) => (
                  <Chip
                    key={row.tag}
                    active={value.tags.includes(row.tag)}
                    count={row.count}
                    onClick={() => onChange({ ...value, tags: toggle(value.tags, row.tag) })}
                  >
                    {row.tag}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Anyone matching at least one choice is included.
          </p>
        </div>
      ) : null}

      {audiences && audiences.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Leave out anyone on</p>
          <div className="flex flex-wrap gap-1.5">
            {audiences
              .filter((audience) => !value.audienceIds.includes(audience._id))
              .map((audience) => (
                <Chip
                  key={audience._id}
                  active={false}
                  excluded={value.excludeAudienceIds.includes(audience._id)}
                  onClick={() =>
                    onChange({
                      ...value,
                      excludeAudienceIds: toggle(value.excludeAudienceIds, audience._id),
                    })
                  }
                >
                  {audience.name}
                </Chip>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AudienceCount({ value }: { value: AudienceChoice }) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const size = useQuery(api.audience.size, { workspaceId: workspace._id, audience: value, now });
  if (!size) return <Spinner />;
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <Badge>{plural(size.reachable, "person", "people")}{size.partial ? "+" : ""}</Badge>
      {size.optedOut ? (
        <span className="text-xs text-muted-foreground">{size.optedOut} unsubscribed left out</span>
      ) : null}
      {size.overCap ? (
        <span className="text-xs text-muted-foreground">{size.overCap} over the weekly limit</span>
      ) : null}
    </span>
  );
}
