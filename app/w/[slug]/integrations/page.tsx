"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { ConnectDialog } from "@/components/integrations/connect-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import {
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  type Integration,
} from "@/lib/integrations";
import { cn } from "@/lib/utils";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  LinkSimpleIcon,
  PlugsConnectedIcon,
  SlidersIcon,
} from "@phosphor-icons/react";

/**
 * Integrations.
 *
 * Every card here is a recipe for the custom-tool machinery the platform
 * already has — connecting one writes `tools` rows tagged with the
 * integration's id, and the engine's HTTP executor runs them at reply time.
 * Nothing on this page is a new runtime.
 *
 * Which is also why "connected" is not a stored flag: it is simply whether
 * those tools exist. A tool deleted from the Custom tools page shows up here
 * as disconnected without anything having to keep the two in step.
 */

type ToolRow = Doc<"tools"> & { agentName?: string };

function IntegrationCard({
  integration,
  tools,
  base,
}: {
  integration: Integration;
  /** The tools this integration owns right now. */
  tools: ToolRow[];
  base: string;
}) {
  const workspace = useWorkspace();
  const disconnect = useMutation(api.tools.disconnectIntegration);

  const connected = tools.length > 0;
  const calls = tools.reduce((sum, tool) => sum + tool.callCount, 0);
  const paused = connected && tools.every((tool) => tool.status !== "enabled");

  const drop = async () => {
    try {
      const result = await disconnect({
        workspaceId: workspace._id,
        integration: integration.id,
      });
      toast.add({
        title: `${integration.name} disconnected`,
        description: `${result.removed} tool${result.removed === 1 ? "" : "s"} removed. Agents can no longer reach it.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not disconnect",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  return (
    <Card className={cn("flex flex-col", connected && "border-primary/30")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {integration.name}
          {integration.kind === "surface" ? (
            <Badge variant="outline">elsewhere</Badge>
          ) : connected ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircleIcon weight="fill" className="size-3" /> Connected
            </Badge>
          ) : null}
          {paused ? <Badge variant="outline">paused</Badge> : null}
        </CardTitle>
        <CardDescription>{integration.blurb}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <ul className="flex flex-col gap-1.5">
          {integration.gives.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm">
              <CheckCircleIcon
                weight="fill"
                className="mt-0.5 size-4 shrink-0 text-primary/60"
              />
              <span className="text-muted-foreground">{line}</span>
            </li>
          ))}
        </ul>

        {connected ? (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">
                Tools your agents can call
                {calls > 0 ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · called {calls} time{calls === 1 ? "" : "s"}
                  </span>
                ) : null}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tools.map((tool) => (
                  <code
                    key={tool._id}
                    className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs"
                  >
                    {tool.name}
                  </code>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* Pushed to the bottom so every card's buttons line up. */}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {integration.kind === "surface" ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={integration.href?.(base) ?? base} />}
            >
              <ArrowSquareOutIcon /> {integration.hrefLabel ?? "Open"}
            </Button>
          ) : (
            <>
              <ConnectDialog
                integration={integration}
                connectedTools={tools}
                trigger={
                  <Button variant={connected ? "outline" : "default"} size="sm">
                    {connected ? <SlidersIcon /> : <LinkSimpleIcon />}
                    {connected ? "Reconfigure" : "Connect"}
                  </Button>
                }
              />

              {connected ? (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="ghost" size="sm">
                        Disconnect
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Disconnect {integration.name}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        The {tools.length} tool
                        {tools.length === 1 ? "" : "s"} it added will be deleted
                        and your agents will stop being able to reach it. The
                        script you deployed keeps running until you remove it at
                        the other end — nothing here can turn it off for you.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void drop()}>
                        Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const tools = useQuery(api.tools.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const connectedCount = INTEGRATIONS.filter(
    (integration) =>
      integration.kind === "tools" &&
      (tools ?? []).some((tool) => tool.integration === integration.id)
  ).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Integrations
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Give your agents a way to reach the tools you already run. Each one
            adds a capability an agent can use mid-conversation — booking a
            meeting, logging an enquiry, finding a document — not just a report
            you read afterwards.
          </p>
        </div>
        {tools === undefined ? (
          <Spinner />
        ) : connectedCount > 0 ? (
          <Badge variant="secondary" className="gap-1.5">
            <PlugsConnectedIcon className="size-3.5" />
            {connectedCount} connected
          </Badge>
        ) : null}
      </header>

      {tools === undefined ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      ) : (
        INTEGRATION_CATEGORIES.map((category) => {
          const inCategory = INTEGRATIONS.filter(
            (integration) => integration.category === category
          );
          if (inCategory.length === 0) return null;

          return (
            <section key={category} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                {category}
              </h2>
              <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
                {inCategory.map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    tools={tools.filter(
                      (tool) => tool.integration === integration.id
                    )}
                    base={base}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      <p className="text-xs text-muted-foreground">
        Anything not here can still be reached: a{" "}
        <Link
          href={`${base}/tools`}
          className="underline underline-offset-4"
        >
          custom tool
        </Link>{" "}
        will call any HTTP endpoint, and the integrations above are the same
        mechanism with the fiddly parts filled in.
      </p>
    </div>
  );
}
