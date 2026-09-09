"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { useHourBucket } from "@/components/use-now";
import {
  ActivityChart,
  ChannelSplit,
  RankedBars,
  StatTile,
} from "@/components/dashboard-charts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { DashboardSkeleton } from "@/components/skeletons";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  BooksIcon,
  CaretRightIcon,
  ChatsIcon,
  CheckCircleIcon,
  CircleIcon,
  PackageIcon,
  RobotIcon,
  WarningIcon,
  WhatsappLogoIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  quoted: "Quoted",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function WorkspaceOverviewPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const [range, setRange] = useState("14");

  // Convex queries must not read the wall clock, so `now` is an argument.
  // Rounded to the hour, it keeps the query cache key stable.
  const now = useHourBucket();

  const summary = useQuery(api.workspaces.summary, {
    workspaceId: workspace._id,
  });
  const stats = useQuery(api.analytics.dashboard, {
    workspaceId: workspace._id,
    days: Number(range),
    now,
  });
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const setupSteps = [
    {
      done: (summary?.agents ?? 0) > 0,
      label: "Create an agent",
      description: "Give it a name, a job and a tone of voice.",
      href: `${base}/agents`,
      icon: RobotIcon,
    },
    {
      done: (summary?.knowledgeChunks ?? 0) > 0,
      label: "Add knowledge",
      description: "Paste policies, upload a PDF or point at a URL.",
      href: `${base}/knowledge`,
      icon: BooksIcon,
    },
    {
      done: (summary?.products ?? 0) > 0,
      label: "Load the catalogue",
      description: "Products and the details to collect for each.",
      href: `${base}/products`,
      icon: PackageIcon,
    },
    {
      done: (summary?.liveChannels ?? 0) > 0,
      label: "Connect WhatsApp",
      description: "Phone number ID and access token.",
      href: `${base}/channels`,
      icon: WhatsappLogoIcon,
    },
  ];
  const remaining = setupSteps.filter((step) => !step.done).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {workspace.name}
          </h1>
          {/* One line, clamped. The tagline is written to be one; the
              description is a paragraph for the agents' system prompt and ran
              to six lines across the top of the dashboard. */}
          {workspace.tagline ? (
            <p className="mt-0.5 line-clamp-1 max-w-2xl text-sm text-muted-foreground">
              {workspace.tagline}
            </p>
          ) : null}
        </div>

        {/* The label was the word "Period" next to a control that already
            reads "Last 14 days". Kept for screen readers only. */}
        <SelectField
          id="range"
          aria-label="Period"
          value={range}
          onValueChange={setRange}
          options={RANGES}
        />
      </header>

      {/* Was a three-line alert at the top of every visit. The same fact
          fits on one line, and the link is the part that matters. */}
      {!workspace.description ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>
            Agents answer better with a company description —{" "}
            <Link href={`${base}/settings`} className="underline">
              add one in Settings
            </Link>
          </AlertTitle>
        </Alert>
      ) : null}

      {stats === undefined ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* ------------------------------------------------------ KPI row */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Messages"
              value={stats.totals.messages}
              previous={stats.previous.messages}
              data={stats.daily}
              dataKey="messages"
            />
            <StatTile
              label="Conversations"
              value={stats.totals.conversations}
              previous={stats.previous.conversations}
              data={stats.daily}
              dataKey="conversations"
            />
            <StatTile
              label="Orders captured"
              value={stats.totals.orders}
              previous={stats.previous.orders}
              data={stats.daily}
              dataKey="orders"
            />
            <StatTile
              label="Avg reply time"
              value={
                stats.totals.avgLatencyMs === null
                  ? null
                  : Math.round(stats.totals.avgLatencyMs / 100) / 10
              }
              previous={
                stats.previous.avgLatencyMs === null
                  ? null
                  : Math.round(stats.previous.avgLatencyMs / 100) / 10
              }
              suffix="s"
              lowerIsBetter
              data={stats.daily}
              dataKey="replySeconds"
            />
          </section>

          {/* ------------------------------------------------------- charts */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Messages per day</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityChart
                  data={stats.daily}
                  windowDays={stats.windowDays}
                  truncated={stats.messagesTruncated}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Channels</CardTitle>
              </CardHeader>
              <CardContent>
                <ChannelSplit
                  whatsapp={stats.channels.whatsapp}
                  web={stats.channels.web}
                />
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Orders by status</CardTitle>
              </CardHeader>
              <CardContent>
                <RankedBars
                  data={stats.ordersByStatus}
                  categoryKey="status"
                  valueKey="count"
                  valueLabel="Orders"
                  formatCategory={(value) => STATUS_LABELS[value] ?? value}
                  emptyLabel="Orders appear once an agent completes an enquiry."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Most-used tools</CardTitle>
              </CardHeader>
              <CardContent>
                <RankedBars
                  data={stats.toolUsage}
                  categoryKey="name"
                  valueKey="calls"
                  valueLabel="Calls"
                  emptyLabel="Enable a custom tool and it will show up here once called."
                />
              </CardContent>
            </Card>
          </section>

          {/* -------------------------------------------- setup and agents */}
          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Setup
                  <Badge variant={remaining === 0 ? "secondary" : "outline"}>
                    {setupSteps.length - remaining}/{setupSteps.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Each step is one row and the row is the link. It used to be
                    a title, a sentence explaining it and a button beside it —
                    three pieces of text per step, twelve for four steps, to
                    say what a tick and a name say on their own. */}
                <ul className="flex flex-col">
                  {setupSteps.map((step) => {
                    const Icon = step.icon;
                    return (
                      <li key={step.label}>
                        <Link
                          href={step.href}
                          className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
                        >
                          {step.done ? (
                            <CheckCircleIcon
                              weight="fill"
                              className="size-4.5 shrink-0 text-primary"
                            />
                          ) : (
                            <CircleIcon className="size-4.5 shrink-0 text-muted-foreground/50" />
                          )}
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span
                            className={cn(
                              "truncate text-sm",
                              step.done && "text-muted-foreground"
                            )}
                          >
                            {step.label}
                          </span>
                          <CaretRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agents</CardTitle>
              </CardHeader>
              <CardContent>
                {agents === undefined ? (
                  <Spinner />
                ) : agents.length === 0 ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-muted-foreground">
                      No agents yet.
                    </p>
                    <Button
                      size="lg"
                      nativeButton={false}
                      render={<Link href={`${base}/agents`} />}
                    >
                      <RobotIcon /> Create the first agent
                    </Button>
                  </div>
                ) : (
                  <ItemGroup>
                    {agents.slice(0, 5).map((agent) => (
                      <Item key={agent._id} variant="outline">
                        <ItemMedia variant="icon">
                          <RobotIcon />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{agent.botName}</span>
                            {/* Only the exception is worth a word. An agent
                                that is live is the normal case and said so
                                five times down this list. */}
                            {agent.status !== "active" ? (
                              <Badge variant="secondary">{agent.status}</Badge>
                            ) : null}
                          </ItemTitle>
                          <ItemDescription className="truncate">
                            {agent.role}
                          </ItemDescription>
                        </ItemContent>
                        {/* Icon-only, with the label on hover: the two words
                            were repeated on every row. */}
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="icon-lg"
                            variant="outline"
                            aria-label={`Test ${agent.botName}`}
                            title="Test in the playground"
                            nativeButton={false}
                            render={
                              <Link href={`${base}/agents/${agent._id}/test`} />
                            }
                          >
                            <ChatsIcon />
                          </Button>
                          <Button
                            size="icon-lg"
                            variant="ghost"
                            aria-label={`Configure ${agent.botName}`}
                            title="Configure"
                            nativeButton={false}
                            render={
                              <Link href={`${base}/agents/${agent._id}`} />
                            }
                          >
                            <WrenchIcon />
                          </Button>
                        </div>
                      </Item>
                    ))}
                  </ItemGroup>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
