import { CATEGORY_LABELS, type MessageCategory } from "@/convex/lib/billing";
import { cn } from "@/lib/utils";

/**
 * One colour per billing category, used for the dot, the badge and the bar,
 * so a category reads as the same thing on every billing surface.
 *
 * Categorical hues at matched lightness, with a dark step each, rather than
 * the workspace primary: the workspace palette is one hue, and four shades of
 * it would read as a ranking rather than four kinds of message.
 */
const TONE: Record<MessageCategory, { dot: string; badge: string; bar: string }> = {
  service: {
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
    bar: "bg-emerald-500",
  },
  utility: {
    dot: "bg-sky-500",
    badge:
      "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25",
    bar: "bg-sky-500",
  },
  marketing: {
    dot: "bg-amber-500",
    badge:
      "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
    bar: "bg-amber-500",
  },
  authentication: {
    dot: "bg-violet-500",
    badge:
      "bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/25",
    bar: "bg-violet-500",
  },
};

export function categoryBarClass(category: MessageCategory): string {
  return TONE[category].bar;
}

export function CategoryDot({
  category,
  className,
}: {
  category: MessageCategory;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE[category].dot, className)}
    />
  );
}

export function CategoryBadge({ category }: { category: MessageCategory }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE[category].badge
      )}
    >
      <CategoryDot category={category} />
      {CATEGORY_LABELS[category]}
    </span>
  );
}
