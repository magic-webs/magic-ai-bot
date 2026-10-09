"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { McpToolGroup } from "@/mcp/server.mjs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PlugsConnectedIcon,
  PlusIcon,
  ShieldWarningIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useHourBucket } from "@/components/use-now";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function when(timestamp: number): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function fail(title: string, error: unknown) {
  toast.add({ title, description: friendlyError(error), type: "error" });
}

function CopyButton({
  text,
  what,
  label,
}: {
  text: string;
  what: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const run = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.add({
        title: "Copy failed",
        description: "Select the text and copy it manually.",
        type: "error",
      });
    }
  };
  return (
    <Button
      variant="outline"
      size={label ? "default" : "icon-lg"}
      aria-label={`Copy the ${what}`}
      onClick={() => void run()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {label ? (copied ? "Copied" : label) : null}
    </Button>
  );
}

function CodeLine({ value, what }: { value: string; what: string }) {
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value}
        className="font-mono text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <CopyButton text={value} what={what} />
    </div>
  );
}

type Connector = {
  id: Id<"adminMcpTokens">;
  name: string;
  prefix: string;
  issuedAt: number;
  lastUsedAt: number | null;
};

type Fresh = { id: Id<"adminMcpTokens">; name: string; url: string };

function FreshUrl({ fresh, onDismiss }: { fresh: Fresh; onDismiss: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-medium">
            Copy the URL for “{fresh.name}” now. It is not shown again.
          </p>
          <p className="mt-1 text-muted-foreground">
            The URL is the credential and carries your full administrator
            rights. Paste it into that assistant and nowhere else.
          </p>
        </div>
      </div>
      <CodeLine value={fresh.url} what="connector URL" />
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          I have copied it
        </Button>
      </div>
    </div>
  );
}

function ConnectorRow({
  connector,
  busy,
  onRotate,
  onRevoke,
}: {
  connector: Connector;
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const now = useHourBucket();
  const recent =
    connector.lastUsedAt !== null && now - connector.lastUsedAt < RECENT_MS;
  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            recent ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{connector.name}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{connector.prefix}…</span>
            <span>Created {when(connector.issuedAt)}</span>
            <span>
              {connector.lastUsedAt
                ? `Used ${when(connector.lastUsedAt)}`
                : "Never used"}
            </span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 pl-5 sm:pl-0">
        <Button size="sm" variant="outline" disabled={busy} onClick={onRotate}>
          {busy ? <Spinner /> : <ArrowsClockwiseIcon />} Rotate
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="sm" variant="ghost" disabled={busy}>
                <TrashIcon /> Revoke
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke “{connector.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Its URL stops working at once and the assistant using it loses
                access to the platform. Your other connectors keep working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                render={<Button variant="ghost">Cancel</Button>}
              />
              <AlertDialogAction
                render={
                  <Button variant="destructive" onClick={onRevoke}>
                    Revoke
                  </Button>
                }
              />
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function ConnectorsCard({
  onFresh,
  fresh,
}: {
  fresh: Fresh | null;
  onFresh: (fresh: Fresh | null) => void;
}) {
  const connectors = useQuery(api.authDb.adminMcpConnectors, {});
  const issue = useAction(api.auth.issueAdminMcpToken);
  const rotate = useAction(api.auth.rotateAdminMcpToken);
  const revoke = useAction(api.auth.revokeAdminMcpToken);

  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [rotating, setRotating] = useState<Id<"adminMcpTokens"> | null>(null);

  const urlFor = (token: string) => `${window.location.origin}/api/mcp/${token}`;

  const add = async () => {
    const wanted = name.trim();
    if (!wanted || adding) return;
    setAdding(true);
    try {
      const result = await issue({ name: wanted });
      onFresh({ id: result.tokenId, name: wanted, url: urlFor(result.token) });
      setName("");
    } catch (error) {
      fail("Could not add the connector", error);
    } finally {
      setAdding(false);
    }
  };

  const rotateOne = async (connector: Connector) => {
    setRotating(connector.id);
    try {
      const result = await rotate({ tokenId: connector.id });
      onFresh({ id: connector.id, name: connector.name, url: urlFor(result.token) });
      toast.add({
        title: `${connector.name} rotated`,
        description: "Its previous URL stopped working immediately.",
        type: "success",
      });
    } catch (error) {
      fail("Could not rotate the connector", error);
    } finally {
      setRotating(null);
    }
  };

  const revokeOne = async (connector: Connector) => {
    try {
      await revoke({ tokenId: connector.id });
      if (fresh?.id === connector.id) onFresh(null);
      toast.add({ title: `${connector.name} revoked`, type: "success" });
    } catch (error) {
      fail("Could not revoke the connector", error);
    }
  };

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugsConnectedIcon className="size-4 text-muted-foreground" />
          Your connectors
          {connectors?.length ? (
            <Badge variant="secondary">{connectors.length}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          One per assistant, so each can be rotated or revoked on its own.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {fresh ? <FreshUrl fresh={fresh} onDismiss={() => onFresh(null)} /> : null}

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Label htmlFor="connector-name">New connector</Label>
          <div className="flex gap-2">
            <Input
              id="connector-name"
              value={name}
              maxLength={60}
              placeholder="Name it for where it goes, e.g. Claude.ai"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={adding || !name.trim()}>
              {adding ? <Spinner /> : <PlusIcon />} Add
            </Button>
          </div>
        </form>

        <Separator />

        {connectors === undefined ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : connectors.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center">
            <PlugsConnectedIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No connectors yet</p>
            <p className="text-xs text-muted-foreground">
              Add one for each assistant you want to give access to.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y">
            {connectors.map((connector) => (
              <ConnectorRow
                key={connector.id}
                connector={connector}
                busy={rotating === connector.id}
                onRotate={() => void rotateOne(connector)}
                onRevoke={() => void revokeOne(connector)}
              />
            ))}
          </div>
        )}

        {connectors?.length ? (
          <p className="text-xs text-muted-foreground">
            Lost a URL? Only its hash is stored, so it cannot be read back.
            Rotate that connector to get a new one.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </li>
  );
}

function SetupCard({ url }: { url: string | null }) {
  const shown = url ?? "<connector URL>";
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>Connect an assistant</CardTitle>
        <CardDescription>
          The URL has to be reachable from the internet. No assistant connects
          to <span className="font-mono">localhost</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="claude">
          <TabsList>
            <TabsTrigger value="claude">Claude.ai</TabsTrigger>
            <TabsTrigger value="code">Claude Code</TabsTrigger>
            <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
          </TabsList>
          <TabsContent value="claude">
            <ol className="mt-3 flex flex-col gap-3">
              <Step n={1}>Add a connector here and copy its URL.</Step>
              <Step n={2}>
                In Claude, open <strong>Settings → Connectors</strong> and choose{" "}
                <strong>Add custom connector</strong>.
              </Step>
              <Step n={3}>
                Name it, paste the URL, and leave the OAuth fields empty.
              </Step>
            </ol>
          </TabsContent>
          <TabsContent value="code">
            <ol className="mt-3 flex flex-col gap-3">
              <Step n={1}>Add a connector here and copy its URL.</Step>
              <Step n={2}>
                <p>Run in a terminal:</p>
                <div className="mt-2">
                  <CodeLine
                    value={`claude mcp add --transport http magic-agent ${shown}`}
                    what="command"
                  />
                </div>
              </Step>
            </ol>
          </TabsContent>
          <TabsContent value="chatgpt">
            <ol className="mt-3 flex flex-col gap-3">
              <Step n={1}>Add a connector here and copy its URL.</Step>
              <Step n={2}>
                In ChatGPT, turn on developer mode under{" "}
                <strong>Settings → Apps &amp; Connectors → Advanced</strong>.
              </Step>
              <Step n={3}>
                Create a connector, paste the URL, and set authentication to
                none.
              </Step>
            </ol>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ToolsCard({ groups }: { groups: McpToolGroup[] }) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const total = groups.reduce((sum, group) => sum + group.tools.length, 0);

  const filtered = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          tools: term
            ? group.tools.filter((tool) =>
                `${tool.name} ${tool.title} ${tool.description}`
                  .toLowerCase()
                  .includes(term)
              )
            : group.tools,
        }))
        .filter((group) => group.tools.length > 0),
    [groups, term]
  );

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          What the assistant can do
          <Badge variant="secondary">{total} tools</Badge>
        </CardTitle>
        <CardDescription>
          Every call is checked by the same server-side guards the dashboard
          runs, with your permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="relative max-w-sm">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search tools"
            className="pl-8"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tool matches “{search}”.</p>
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {filtered.map((group) => (
              <details
                key={group.title}
                open={term ? true : undefined}
                className="group/tools"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                  <CaretRightIcon className="size-3.5 text-muted-foreground transition-transform group-open/tools:rotate-90" />
                  {group.title}
                  {group.admin ? (
                    <Badge variant="destructive">Administrator only</Badge>
                  ) : null}
                  <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                    {group.tools.length}
                  </span>
                </summary>
                <ul className="flex flex-col divide-y border-t">
                  {group.tools.map((tool) => (
                    <li key={tool.name} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:gap-4">
                      <div className="flex shrink-0 items-center gap-1.5 sm:w-64">
                        <code className="font-mono text-xs break-all">{tool.name}</code>
                        {tool.readOnly ? (
                          <EyeIcon
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-label="Read-only"
                          />
                        ) : null}
                        {tool.destructive ? (
                          <ShieldWarningIcon
                            className="size-3.5 shrink-0 text-destructive"
                            aria-label="Destructive"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 text-xs">
                        <p className="font-medium">{tool.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                          {tool.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <EyeIcon className="size-3.5" /> Read-only
          </span>
          <span className="flex items-center gap-1">
            <ShieldWarningIcon className="size-3.5 text-destructive" /> Destructive
          </span>
          <span>
            Workspace-level destructive tools need an explicit slug, and{" "}
            <span className="font-mono">delete_workspace</span> also needs the
            exact name.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The administrator's own MCP connectors. Each URL is itself the credential —
 * connector forms have nowhere to put a header — so it is shown once, only its
 * hash is stored, and rotating stops the old URL working immediately.
 */
export function AdminMcp({ tools }: { tools: McpToolGroup[] }) {
  const [fresh, setFresh] = useState<Fresh | null>(null);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          MCP connector
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Give an assistant like Claude or ChatGPT a connector and it can run
          the platform for you: create workspaces, issue logins, build agents and
          catalogues, and read what everything costs.
        </p>
      </header>

      <div className="grid shrink-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <ConnectorsCard fresh={fresh} onFresh={setFresh} />
        <SetupCard url={fresh?.url ?? null} />
      </div>

      <ToolsCard groups={tools} />
    </div>
  );
}
