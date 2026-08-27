"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
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

function Stat({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: number | string;
  sub?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-ring"
    >
      <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-xl font-semibold tabular-nums">
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[0.625rem] text-muted-foreground">{sub}</p>
      ) : null}
    </Link>
  );
}

export default function WorkspaceOverviewPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const summary = useQuery(api.workspaces.summary, {
    workspaceId: workspace._id,
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
      description:
        "Paste policies, upload a PDF or point at a URL. It gets embedded for retrieval.",
      href: `${base}/knowledge`,
      icon: BooksIcon,
    },
    {
      done: (summary?.products ?? 0) > 0,
      label: "Load the catalogue",
      description:
        "Products and the spec questions the agent must ask for each one.",
      href: `${base}/products`,
      icon: PackageIcon,
    },
    {
      done: (summary?.liveChannels ?? 0) > 0,
      label: "Connect WhatsApp",
      description: "WABA ID, phone number ID and access token.",
      href: `${base}/channels`,
      icon: WhatsappLogoIcon,
    },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {workspace.name}
        </h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          {workspace.description ??
            workspace.tagline ??
            "Add a description in Settings so agents know what this business does."}
        </p>
      </header>

      {summary === undefined ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading…
        </div>
      ) : (
        <>
          {!workspace.description ? (
            <Alert>
              <WarningIcon />
              <AlertTitle>No company description yet</AlertTitle>
              <AlertDescription>
                Agents are grounded in the workspace description and facts. Fill
                them in under{" "}
                <Link href={`${base}/settings`} className="underline">
                  Settings
                </Link>{" "}
                for noticeably better answers.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Agents"
              value={summary.agents}
              sub={`${summary.activeAgents} active`}
              href={`${base}/agents`}
            />
            <Stat
              label="Knowledge"
              value={summary.knowledgeSources}
              sub={`${summary.knowledgeChunks} embedded chunks`}
              href={`${base}/knowledge`}
            />
            <Stat
              label="Catalogue"
              value={summary.products}
              sub="active products"
              href={`${base}/products`}
            />
            <Stat
              label="Orders"
              value={summary.orders}
              sub={`${summary.newOrders} new`}
              href={`${base}/orders`}
            />
            <Stat
              label="Custom tools"
              value={summary.tools}
              sub={`${summary.enabledTools} enabled`}
              href={`${base}/tools`}
            />
            <Stat
              label="Channels"
              value={summary.channels}
              sub={`${summary.liveChannels} live`}
              href={`${base}/channels`}
            />
            <Stat
              label="Conversations"
              value={summary.conversations}
              sub={`${summary.escalated} escalated`}
              href={`${base}/conversations`}
            />
            <Stat
              label="Contacts"
              value={summary.contacts}
              sub="known people"
              href={`${base}/conversations`}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Setup checklist</CardTitle>
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
                  Open one to configure its knowledge, tone and tools, or to test
                  it in the web playground.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {agents === undefined ? (
                  <Spinner />
                ) : agents.length === 0 ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-xs text-muted-foreground">
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
                    {agents.slice(0, 6).map((agent) => (
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
                            render={
                              <Link href={`${base}/agents/${agent._id}/test`} />
                            }
                          >
                            <ChatsIcon /> Test
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
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
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent order activity</CardTitle>
              <CardDescription>
                Orders the agents captured, newest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecentOrders />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function RecentOrders() {
  const workspace = useWorkspace();
  const orders = useQuery(api.orders.listByWorkspace, {
    workspaceId: workspace._id,
    limit: 6,
  });

  if (orders === undefined) return <Spinner />;
  if (orders.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No orders captured yet. Once an agent calls <code>create_order</code>,
        they appear here and fire the workspace webhook.
      </p>
    );
  }

  return (
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
                .map((item) => `${item.quantity} × ${item.productName}`)
                .join(", ")}
            </ItemDescription>
          </ItemContent>
          <span className="text-[0.625rem] text-muted-foreground">
            {new Date(order.createdAt).toLocaleDateString()}
          </span>
        </Item>
      ))}
    </ItemGroup>
  );
}
