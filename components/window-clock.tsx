"use client";

import { WHATSAPP_FREE_FORM_WINDOW_HOURS } from "@/convex/lib/shared";
import { useNowSeconds } from "@/components/handback-timer";
import { cn } from "@/lib/utils";

const WINDOW_MS = WHATSAPP_FREE_FORM_WINDOW_HOURS * 60 * 60_000;

/**
 * The 24-hour reply window as a clock: the ring drains as the window runs
 * out and the hand sweeps once a minute. Amber in the last hour, red once it
 * has closed.
 */
export function WindowClock({
  lastInboundAt,
  size = 40,
  className,
}: {
  lastInboundAt: number | null;
  size?: number;
  className?: string;
}) {
  const now = useNowSeconds();
  if (now === 0) {
    return <span style={{ width: size, height: size }} className="shrink-0" />;
  }

  const left = lastInboundAt ? Math.max(0, lastInboundAt + WINDOW_MS - now) : 0;
  const open = left > 0;
  const urgent = open && left < 60 * 60_000;
  const detailed = size >= 28;

  const ring = detailed ? 8 : 12;
  const radius = 50 - ring / 2;
  const circumference = 2 * Math.PI * radius;
  // Counted from the customer's message rather than taken modulo a minute,
  // so the hand keeps turning forwards instead of unwinding at the top.
  const hand = open && lastInboundAt ? ((now - lastInboundAt) / 1000) * 6 : 0;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={open ? "Reply window open" : "Reply window closed"}
      className={cn(
        "shrink-0",
        !open ? "text-destructive" : urgent ? "text-amber-500" : "text-primary",
        className
      )}
    >
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={ring}
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={ring}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - left / WINDOW_MS)}
        transform="rotate(-90 50 50)"
        className={cn(
          "transition-[stroke-dashoffset] duration-1000 ease-linear",
          urgent && "motion-safe:animate-pulse"
        )}
      />
      {detailed
        ? Array.from({ length: 12 }, (_, hour) => (
            <line
              key={hour}
              x1="50"
              y1={ring + 5}
              x2="50"
              y2={ring + (hour % 3 === 0 ? 13 : 10)}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={hour % 3 === 0 ? 3.5 : 2.5}
              strokeLinecap="round"
              transform={`rotate(${hour * 30} 50 50)`}
            />
          ))
        : null}
      <line
        x1="50"
        y1="50"
        x2="50"
        y2={detailed ? 24 : 22}
        stroke="currentColor"
        strokeWidth={detailed ? 5 : 10}
        strokeLinecap="round"
        style={{
          transform: `rotate(${hand}deg)`,
          transformOrigin: "50px 50px",
          transformBox: "view-box",
        }}
        className={open ? "motion-safe:transition-transform motion-safe:duration-1000 motion-safe:ease-linear" : undefined}
      />
      <circle cx="50" cy="50" r={detailed ? 5 : 9} fill="currentColor" />
    </svg>
  );
}
