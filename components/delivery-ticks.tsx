"use client";

import {
  CheckIcon,
  ChecksIcon,
  ClockIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

export type Delivery = Doc<"messages">["delivery"];

const LABEL: Record<NonNullable<Delivery>, string> = {
  pending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Not delivered",
};

/** WhatsApp's own receipts. A message from before receipts were kept reads as sent. */
export function DeliveryTicks({
  status,
  error,
  className,
}: {
  status: Delivery;
  error?: string;
  className?: string;
}) {
  const label = status ? LABEL[status] : LABEL.sent;
  const title = status === "failed" && error ? `${label} — ${error}` : label;
  const base = cn("size-3 shrink-0", className);

  if (status === "pending") {
    return <ClockIcon aria-label={label} className={cn(base, "opacity-60")} />;
  }
  if (status === "failed") {
    return (
      <span title={title} className="inline-flex">
        <WarningCircleIcon
          aria-label={title}
          weight="fill"
          className={cn(base, "text-destructive")}
        />
      </span>
    );
  }
  if (status === "delivered" || status === "read") {
    return (
      <span title={title} className="inline-flex">
        <ChecksIcon
          aria-label={label}
          weight="bold"
          className={cn(base, status === "read" ? "text-[#53bdeb]" : "opacity-60")}
        />
      </span>
    );
  }
  return (
    <span title={title} className="inline-flex">
      <CheckIcon aria-label={label} weight="bold" className={cn(base, "opacity-60")} />
    </span>
  );
}
