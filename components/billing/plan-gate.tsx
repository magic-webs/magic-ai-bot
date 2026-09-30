"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useHourBucket } from "@/components/use-now";
import { useSession } from "@/components/use-session";
import { daysFrom, formatDay, inr } from "@/components/billing/plan-bits";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { LockKeyIcon, WalletIcon, WarningIcon } from "@phosphor-icons/react";

/** How close a trial's end has to be before the dashboard mentions it. */
const TRIAL_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The platform fee's say over the dashboard: a banner when something about
 * the account needs attention, and the lock when the plan has lapsed.
 *
 * The lock is the dashboard only, and it leaves Billing open — that is where
 * the way out is. Agents keep answering customers underneath it; nothing
 * here touches them. An administrator is never locked out, since they are the
 * one who can fix it, but sees the banner that says the company is.
 *
 * Rendered while the answer loads rather than holding the page back: this is
 * a nudge on every page, and a round trip in front of each would be felt
 * everywhere to catch the few accounts it applies to.
 */
export function PlanGate({
  workspaceId,
  base,
  children,
}: {
  workspaceId: Id<"workspaces">;
  base: string;
  children: React.ReactNode;
}) {
  const now = useHourBucket();
  const pathname = usePathname();
  const session = useSession();
  const status = useQuery(api.subscriptions.access, { workspaceId, now });

  const billing = `${base}/billing`;
  const onBilling = pathname.startsWith(billing);
  const isAdmin = session.isAdmin;
  const isMember = session.me?.role === "member";

  if (!status) return <>{children}</>;
  const { access } = status;

  if (access.state === "locked" && !onBilling && !isAdmin) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>{access.reason}</EmptyTitle>
            <EmptyDescription>
              Your agents are still answering customers. The dashboard opens
              again as soon as a plan is active
              {isMember ? " — ask whoever manages the account to renew it." : "."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href={billing} />}>
              {isMember ? "See the plan" : "Choose a plan"}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const banner = bannerFor(status, now, isAdmin);
  return (
    <>
      {banner ? (
        <div
          role="status"
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm",
            banner.tone === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          )}
        >
          {banner.wallet ? (
            <WalletIcon className="size-4 shrink-0" />
          ) : (
            <WarningIcon className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1">{banner.text}</span>
          {onBilling ? null : (
            <Link
              href={banner.wallet ? `${billing}?tab=wallet` : billing}
              className="shrink-0 font-medium underline underline-offset-2"
            >
              {banner.action}
            </Link>
          )}
        </div>
      ) : null}
      {children}
    </>
  );
}

type Status = NonNullable<FunctionReturnType<typeof api.subscriptions.access>>;

/** The one thing most worth saying, or nothing. */
function bannerFor(
  status: Status,
  now: number,
  isAdmin: boolean
): { text: string; action: string; tone: "danger" | "warning"; wallet?: boolean } | null {
  const { access } = status;

  if (access.state === "locked") {
    // Only an administrator gets this far on a locked account.
    return {
      text: `This workspace is locked for its users. ${access.reason}`,
      action: "Billing",
      tone: "danger",
    };
  }
  if (access.state === "grace" && access.until) {
    return {
      text: `${access.reason} The dashboard locks on ${formatDay(access.until)} unless it is paid.`,
      action: isAdmin ? "Billing" : "Fix payment",
      tone: "danger",
    };
  }
  if (access.state === "trial" && access.until && access.until - now < TRIAL_NOTICE_MS) {
    return {
      text: `Your free trial ends ${daysFrom(access.until, now)}, on ${formatDay(access.until)}.`,
      action: "Choose a plan",
      tone: "warning",
    };
  }
  if (status.lowBalance) {
    const balance = inr(status.balanceMicros);
    return {
      text: status.rechargeInFlight
        ? `Wallet balance is ${balance}. An auto-recharge is on its way.`
        : status.balanceMicros <= 0
          ? `Your wallet is at ${balance}. Templates are held back until it is topped up.`
          : `Wallet balance is low: ${balance}.`,
      action: "Top up",
      tone: status.balanceMicros <= 0 ? "danger" : "warning",
      wallet: true,
    };
  }
  return null;
}
