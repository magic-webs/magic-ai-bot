"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  GoogleCalendarIcon,
  GoogleDriveIcon,
  GoogleGIcon,
  GoogleSheetsIcon,
} from "@/components/integrations/google-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  INTEGRATIONS,
  type IntegrationSpec,
} from "@/convex/lib/integrations";
import { cn } from "@/lib/utils";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  PlugsConnectedIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * Integrations.
 *
 * Connecting is one button: Google's consent screen, then back here with the
 * sheet or folder already made and the tools already written. There is nothing
 * to paste, so there is no form on this page.
 *
 * What a card cannot tell you is whether an agent will ever call the tools —
 * that switch is per agent, under Knowledge & tools. So each connected card
 * counts the agents that have it switched on and links there when the answer
 * is none, because "connected but nobody is using it" is the one confusing
 * state this design creates.
 */

const ICONS: Record<string, (props: { className?: string }) => React.ReactNode> =
  {
    google_sheets: GoogleSheetsIcon,
    google_calendar: GoogleCalendarIcon,
    google_drive: GoogleDriveIcon,
  };

type Connection = {
  integration: string;
  accountEmail?: string;
  status: "connected" | "needs_reauth";
  resource?: { id: string; name: string; url?: string };
  lastError?: string;
};

function IntegrationCard({
  integration,
  connection,
  tools,
  agents,
  base,
  disabled,
}: {
  integration: IntegrationSpec;
  connection: Connection | undefined;
  /** The tools this integration owns right now. */
  tools: Doc<"tools">[];
  agents: Doc<"agents">[];
  base: string;
  /** True when the deployment has no Google client configured. */
  disabled: boolean;
}) {
  const workspace = useWorkspace();
  const startConnect = useAction(api.integrations.startGoogleConnect);
  const disconnect = useMutation(api.integrations.disconnect);
  const [busy, setBusy] = useState(false);

  const Icon = ICONS[integration.id];
  const connected = Boolean(connection);
  const stale = connection?.status === "needs_reauth";
  const calls = tools.reduce((sum, tool) => sum + tool.callCount, 0);

  // Agents that can actually call any of this integration's tools.
  const names = new Set(integration.tools.map((tool) => tool.name));
  const usingAgents = agents.filter((agent) =>
    (agent.integrationTools ?? []).some((name) => names.has(name))
  );

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await startConnect({
        workspaceId: workspace._id,
        integration: integration.id,
        // Where Google's callback sends the browser back to. Read here rather
        // than on the server: only the browser knows which host it is on, and
        // that differs between local development, preview and production.
        returnTo: `${window.location.origin}${base}/integrations`,
      });
      window.location.assign(url);
    } catch (error) {
      toast.add({
        title: `Could not start ${integration.name}`,
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
      setBusy(false);
    }
  };

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
    <Card
      className={cn(
        "flex flex-col",
        connected && !stale && "border-primary/30",
        stale && "border-destructive/40"
      )}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          {Icon ? <Icon className="mt-0.5 size-8 shrink-0" /> : null}
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {integration.name}
              {stale ? (
                <Badge variant="destructive" className="gap-1">
                  <WarningIcon weight="fill" className="size-3" /> Reconnect
                </Badge>
              ) : connected ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircleIcon weight="fill" className="size-3" /> Connected
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="mt-1">
              {integration.blurb}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {/* The bullets sell the thing. Once it is connected you already know
            what it does, and three lines of pitch crowd out the two facts that
            still matter: which account, and which agents can use it. */}
        {connected ? (
          <div className="flex flex-col gap-2 text-xs">
            {connection?.accountEmail ? (
              <p className="text-muted-foreground">{connection.accountEmail}</p>
            ) : null}

            {connection?.resource ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="truncate">{connection.resource.name}</span>
                {connection.resource.url ? (
                  <a
                    href={connection.resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
                  >
                    Open <ArrowSquareOutIcon className="size-3" />
                  </a>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5">
              {tools.map((tool) => (
                <code
                  key={tool._id}
                  className="rounded border bg-muted/40 px-1.5 py-0.5"
                >
                  {tool.name}
                </code>
              ))}
              {calls > 0 ? (
                <span className="text-muted-foreground">{calls} calls</span>
              ) : null}
            </div>

            {/* The state this design makes possible: connected, and nobody
                switched on. Say so rather than letting it look finished. */}
            {usingAgents.length === 0 ? (
              <Link
                href={`${base}/agents`}
                className="text-muted-foreground underline underline-offset-4"
              >
                Not on any agent — switch it on
              </Link>
            ) : (
              <p className="text-muted-foreground">
                On for{" "}
                <span className="text-foreground">
                  {usingAgents.map((agent) => agent.name).join(", ")}
                </span>
              </p>
            )}
          </div>
        ) : (
          <>
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
            <p className="text-xs text-muted-foreground">
              {integration.provisions}
            </p>
          </>
        )}

        {stale && connection?.lastError ? (
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>Google refused the last call</AlertTitle>
            <AlertDescription>{connection.lastError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Pushed to the bottom so every card's buttons line up. */}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant={connected && !stale ? "outline" : "default"}
            onClick={() => void connect()}
            disabled={busy || disabled}
          >
            {busy ? <Spinner /> : <GoogleGIcon className="size-4" />}
            {busy
              ? "Opening Google…"
              : connected
                ? "Reconnect"
                : "Connect with Google"}
          </Button>

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
                    The {tools.length} tool{tools.length === 1 ? "" : "s"} it
                    added will be deleted and switched off on every agent, so
                    they stop being able to reach it. Nothing in your Google
                    account is touched —{" "}
                    {connection?.resource
                      ? `${connection.resource.name} stays exactly where it is.`
                      : "your calendar is left alone."}
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
        </div>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/w/${workspace.slug}`;

  const connections = useQuery(api.integrations.list, {
    workspaceId: workspace._id,
  });
  const configured = useQuery(api.integrations.configured, {});
  const tools = useQuery(api.tools.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  // The callback redirects back here with its verdict in the query string.
  // Report it once, then strip it: a refresh should not re-announce a
  // connection made ten minutes ago.
  const connectedParam = params.get("connected");
  const errorParam = params.get("integration_error");
  useEffect(() => {
    if (!connectedParam && !errorParam) return;

    if (connectedParam) {
      const spec = INTEGRATIONS.find((item) => item.id === connectedParam);
      toast.add({
        title: `${spec?.name ?? "Integration"} connected`,
        description:
          "The tools are ready. Switch them on for an agent under Knowledge & tools.",
        type: "success",
      });
    } else if (errorParam) {
      toast.add({
        title: "Could not connect",
        description: errorParam,
        type: "error",
      });
    }

    router.replace(`${base}/integrations`);
  }, [base, connectedParam, errorParam, router]);

  const loading =
    connections === undefined ||
    tools === undefined ||
    agents === undefined ||
    configured === undefined;

  const byId = new Map(
    (connections ?? []).map((connection) => [connection.integration, connection])
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Integrations
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Capabilities your agents can use mid-conversation. Nothing to
            configure — connecting creates what it needs in your own Drive.
          </p>
        </div>
        {loading ? (
          <Spinner />
        ) : byId.size > 0 ? (
          <Badge variant="secondary" className="gap-1.5">
            <PlugsConnectedIcon className="size-3.5" />
            {byId.size} connected
          </Badge>
        ) : null}
      </header>

      {configured && !configured.google ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Google is not set up on this deployment</AlertTitle>
          <AlertDescription>
            Connecting needs an OAuth client. Set{" "}
            <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{" "}
            on the Convex deployment, and add this deployment&apos;s{" "}
            <code>/integrations/google/callback</code> URL as an authorised
            redirect URI in the Google Cloud console.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Google
          </h2>
          <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {INTEGRATIONS.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                connection={byId.get(integration.id)}
                tools={(tools ?? []).filter(
                  (tool) => tool.integration === integration.id
                )}
                agents={agents ?? []}
                base={base}
                disabled={!configured?.google}
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Anything else — Slack, Zapier — is a{" "}
        <Link href={`${base}/tools`} className="underline underline-offset-4">
          custom tool
        </Link>{" "}
        pointed at a webhook.
      </p>
    </div>
  );
}
