import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The agent faces, shared with the mobile app.
 *
 * Same six files and the same choosing rule as
 * magic-agent-app/src/components/agent-avatar.tsx, so an agent wears one face
 * across the dashboard and the app. They are rendered 3D busts on transparent
 * backgrounds, which is why they are cut out over a tinted circle rather than
 * boxed into a photo frame.
 */

const FEMALE = [
  "/images/3d-avatars/female-1.png",
  "/images/3d-avatars/female-2.png",
  "/images/3d-avatars/female-3.png",
] as const;

const MALE = [
  "/images/3d-avatars/male-1.png",
  "/images/3d-avatars/male-2.png",
  "/images/3d-avatars/male-3.png",
] as const;

/** Every face, for an agent whose record predates the gender field. */
const EITHER = [...FEMALE, ...MALE] as const;

/** male-1: the waving one. Kept for whoever greets first. */
const GREETER = MALE[0];

export type AgentGender = "male" | "female";

/** Stable, and only has to be stable — not well distributed. */
function hashOf(name: string): number {
  const seed = name.trim().toLowerCase() || "agent";
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return hash;
}

/**
 * Which face an agent gets.
 *
 * `gender` comes off the agent record and decides which set is drawn from;
 * within a set the choice is hashed on the bot name, so an agent keeps its face
 * across reloads. With no gender the hash runs over all six rather than
 * guessing from the name — name-to-gender inference is wrong often enough
 * across languages that a stable arbitrary face is the better failure.
 */
export function agentAvatarSrc(
  name: string,
  options: { gender?: AgentGender | null; greeter?: boolean } = {}
): string {
  const { gender, greeter = false } = options;
  if (greeter && gender !== "female") return GREETER;
  const set = gender === "female" ? FEMALE : gender === "male" ? MALE : EITHER;
  return set[hashOf(name) % set.length];
}

/** Tints for the circle behind the cutout, picked off the same hash. */
const TINTS = [
  "bg-amber-100 dark:bg-amber-500/15",
  "bg-emerald-100 dark:bg-emerald-500/15",
  "bg-sky-100 dark:bg-sky-500/15",
  "bg-violet-100 dark:bg-violet-500/15",
  "bg-rose-100 dark:bg-rose-500/15",
  "bg-teal-100 dark:bg-teal-500/15",
] as const;

export function AgentAvatar({
  name,
  gender,
  greeter = false,
  size = 56,
  className,
}: {
  name: string;
  gender?: AgentGender | null;
  greeter?: boolean;
  size?: number;
  className?: string;
}) {
  const src = agentAvatarSrc(name, { gender, greeter });
  const tint = TINTS[hashOf(name) % TINTS.length];

  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        tint,
        className
      )}
    >
      {/* Oversized and pushed down: the busts are framed head-and-shoulders, so
          scaling to fit leaves the head small and floating in the circle.
          Filling it and cropping at the shoulders reads as a portrait. */}
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        style={{
          width: size * 1.18,
          height: size * 1.18,
          marginTop: size * 0.14,
        }}
        className="max-w-none object-contain"
      />
    </span>
  );
}
