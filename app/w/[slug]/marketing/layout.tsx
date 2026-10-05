"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { AgentAvatar } from "@/components/agent-avatar";
import { fail } from "@/components/marketing/calendar";
import { TableSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  CalendarBlankIcon,
  CalendarCheckIcon,
  ChartBarIcon,
  MegaphoneIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
  UsersIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";

const SECTIONS = [
  { href: "", label: "Overview", icon: ChartBarIcon },
  { href: "/audience", label: "Audience", icon: UsersIcon },
  { href: "/campaigns", label: "Campaigns", icon: PaperPlaneTiltIcon },
  { href: "/events", label: "Events", icon: CalendarCheckIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarBlankIcon },
  { href: "/templates", label: "Templates", icon: MegaphoneIcon },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const base = `/w/${workspace.slug}/marketing`;
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const ensureDesk = useMutation(api.marketing.ensureDesk);
  const [creatingDesk, setCreatingDesk] = useState(false);

  const active = (href: string) =>
    href === "" ? pathname === base : pathname.startsWith(`${base}${href}`);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Marketing</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your audience, broadcast campaigns, event sequences and greetings — sent by the
            marketing desk as approved WhatsApp templates, with every delivery, read and reply
            tracked.
          </p>
        </div>
        <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={`${base}${section.href}`}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors [&_svg]:size-4",
                active(section.href)
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <section.icon /> {section.label}
            </Link>
          ))}
        </nav>
      </header>

      {overview === undefined ? (
        <TableSkeleton rows={1} columns={3} />
      ) : overview ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <AgentAvatar name={overview.desk?.botName ?? workspace.name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Marketing desk</p>
            <p className="text-xs text-muted-foreground">
              {overview.channel ? (
                <>
                  <WhatsappLogoIcon className="mr-1 inline size-3.5 align-[-2px]" />
                  Sends from {overview.channel.phone ?? overview.channel.name} to{" "}
                  {overview.audience.whatsapp}
                  {overview.audience.capped ? "+" : ""} subscribed WhatsApp contacts
                </>
              ) : (
                "No WhatsApp number connected — nothing can send until one is."
              )}
            </p>
          </div>
          {overview.desk ? (
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/w/${workspace.slug}/agents/${overview.desk._id}`} />}
            >
              Tone and rules
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={creatingDesk}
              onClick={async () => {
                setCreatingDesk(true);
                try {
                  await ensureDesk({ workspaceId: workspace._id });
                } catch (error) {
                  fail("Could not set up the desk", error);
                } finally {
                  setCreatingDesk(false);
                }
              }}
            >
              {creatingDesk ? <Spinner /> : <SparkleIcon />} Set up the desk
            </Button>
          )}
        </div>
      ) : null}

      {overview && !overview.channel ? (
        <Alert>
          <WarningCircleIcon />
          <AlertTitle>Connect WhatsApp first</AlertTitle>
          <AlertDescription>
            Marketing goes out from the workspace’s WhatsApp number. Add one under{" "}
            <Link className="underline" href={`/w/${workspace.slug}/channels`}>
              Channels
            </Link>{" "}
            and anything scheduled here will send from it.
          </AlertDescription>
        </Alert>
      ) : null}

      {children}
    </div>
  );
}
