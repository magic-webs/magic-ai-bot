import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A colleague's face.
 *
 * The counterpart to AgentAvatar, and deliberately not the same thing: agents
 * are drawn from six rendered busts, people are photographs. With no photo it
 * falls back to initials on a tinted circle rather than to a stock silhouette
 * — a real name reads as a person, and a grey outline of a head does not.
 */

const TINTS = [
  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200",
  "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200",
  "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200",
  "bg-teal-100 text-teal-900 dark:bg-teal-500/15 dark:text-teal-200",
] as const;

/** Stable, and only has to be stable — not well distributed. */
function hashOf(name: string): number {
  const seed = name.trim().toLowerCase() || "teammate";
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return hash;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // First and last, so "Priya Raman Iyer" is PI rather than PR.
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function TeamAvatar({
  name,
  photo,
  size = 56,
  className,
}: {
  name: string;
  photo?: string | null;
  size?: number;
  className?: string;
}) {
  const tint = TINTS[hashOf(name) % TINTS.length];

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        !photo && tint,
        className
      )}
      style={{ width: size, height: size }}
    >
      {photo ? (
        // `unoptimized`: these are uploads on a Convex storage URL and links to
        // hosts nobody has whitelisted in next.config, which the optimizer
        // refuses outright.
        <Image
          src={photo}
          alt={name}
          width={size}
          height={size}
          unoptimized
          className="size-full object-cover"
        />
      ) : (
        <span
          className="font-heading font-semibold"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}
