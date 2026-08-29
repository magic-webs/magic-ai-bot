"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  RobotIcon,
  BooksIcon,
  PackageIcon,
  ReceiptIcon,
  WrenchIcon,
  WhatsappLogoIcon,
  ChatsIcon,
  ArrowRightIcon,
  WarningIcon,
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
  const orders = useQuery(api.orders.listByWorkspace, {
    workspaceId: workspace._id,
    limit: 5,
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
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            {workspace.name}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {workspace.description ??
              workspace.tagline ??
              "Add a description in Settings so agents know what this business does."}
          </p>
        </div>

        {/* One filter row, above everything it scopes. */}
        <div className="flex items-center gap-2">
          <Label htmlFor="range" className="text-sm">
            Period
          </Label>
          <SelectField
            id="range"
            value={range}
            onValueChange={setRange}
            options={RANGES}
          />
        </div>
      </header>

      {!workspace.description ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>No company description yet</AlertTitle>
          <AlertDescription>
            Agents are grounded in the workspace description and facts. Fill them
            in under{" "}
            <Link href={`${base}/settings`} className="underline">
              Settings
            </Link>{" "}
            for noticeably better answers.
          </AlertDescription>
        </Alert>
      ) : null}

      {stats === undefined ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading activity…
        </div>
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
                <CardDescription>
                  Every inbound and outbound message across WhatsApp and the web
                  playground.
                </CardDescription>
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
                <CardTitle>Where conversations arrive</CardTitle>
                <CardDescription>All time, by channel.</CardDescription>
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
                <CardDescription>
                  Every order the agents have captured, all time.
                </CardDescription>
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
                <CardDescription>
                  Custom tools your agents actually call.
                </CardDescription>
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
                  Setup checklist
                  {remaining === 0 ? (
                    <Badge variant="secondary">complete</Badge>
                  ) : (
                    <Badge variant="outline">{remaining} left</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  What this workspace still needs before it can go live.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ItemGroup>
                  {setupSteps.map((step) => {
                    const Icon = step.icon;
                    return (
                      <Item key={step.label} variant="outline">
                        <ItemMedia variant="icon">
                          <Icon />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle className="flex items-center gap-2">
                            {step.label}
                            {step.done ? (
                              <Badge variant="secondary">done</Badge>
                            ) : null}
                          </ItemTitle>
                          <ItemDescription>{step.description}</ItemDescription>
                        </ItemContent>
                        <Button
                          size="sm"
                          variant={step.done ? "ghost" : "outline"}
                          nativeButton={false}
                          render={<Link href={step.href} />}
                        >
                          {step.done ? "Review" : "Set up"} <ArrowRightIcon />
                        </Button>
                      </Item>
                    );
                  })}
                </ItemGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agents</CardTitle>
                <CardDescription>
                  Open one to configure it, or test it in the web playground.
                </CardDescription>
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
                      size="sm"
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
                        <ItemContent>
                          <ItemTitle className="flex items-center gap-2">
                            {agent.botName}
                            <Badge
                              variant={
                                agent.status === "active"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {agent.status}
                            </Badge>
                          </ItemTitle>
                          <ItemDescription>{agent.role}</ItemDescription>
                        </ItemContent>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            nativeButton={false}
                            render={
                              <Link href={`${base}/agents/${agent._id}/test`} />
                            }
                          >
                            <ChatsIcon /> Test
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
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

          {/* ------------------------------------------------ recent orders */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Recent orders
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  nativeButton={false}
                  render={<Link href={`${base}/orders`} />}
                >
                  View all <ArrowRightIcon />
                </Button>
              </CardTitle>
              <CardDescription>
                Enquiries the agents captured, newest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {orders === undefined ? (
                <Spinner />
              ) : orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No orders captured yet. Once an agent calls{" "}
                  <code>create_order</code>, they appear here and fire the
                  workspace webhook.
                </p>
              ) : (
                <ItemGroup>
                  {orders.map((order) => (
                    <Item key={order._id} variant="outline">
                      <ItemMedia variant="icon">
                        <ReceiptIcon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="flex items-center gap-2">
                          <span className="font-mono">{order.orderNumber}</span>
                          <Badge variant="secondary">{order.status}</Badge>
                        </ItemTitle>
                        <ItemDescription>
                          {order.customer.name} ·{" "}
                          {order.items
                            .map(
                              (item) =>
                                `${item.quantity} × ${item.productName}`
                            )
                            .join(", ")}
                        </ItemDescription>
                      </ItemContent>
                      <span className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </span>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
