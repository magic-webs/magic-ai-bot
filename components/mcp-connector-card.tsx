"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CopyIcon,
  PlugsConnectedIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * What an assistant can do here, grouped as the server groups its tools.
 *
 * The platform-administration tools are left out deliberately: the server
 * lists them, but the Convex guards refuse them for a workspace account, so
 * naming them here would be promising an error message.
 */
const TOOL_GROUPS = [
  { group: "Workspace", tools: ["whoami", "get_workspace", "update_workspace"] },
  {
    group: "Agents",
    tools: [
      "list_agents",
      "get_agent",
      "create_agent",
      "update_agent",
      "delete_agent",
      "draft_agent",
      "ensure_front_desk",
      "chat_with_agent",
    ],
  },
  {
    group: "Catalogue",
    tools: [
      "list_products",
      "create_product",
      "update_product",
      "delete_product",
      "import_products",
      "draft_catalogue",
    ],
  },
  {
    group: "Knowledge",
    tools: ["list_knowledge", "add_knowledge", "delete_knowledge"],
  },
  {
    group: "Channels",
    tools: [
      "list_channels",
      "create_channel",
      "update_channel",
      "delete_channel",
    ],
  },
  {
    group: "Custom tools",
    tools: [
      "list_custom_tools",
      "create_custom_tool",
      "update_custom_tool",
      "delete_custom_tool",
    ],
  },
  {
    group: "Operations",
    tools: [
      "list_conversations",
      "read_conversation",
      "list_contacts",
      "list_orders",
      "usage_summary",
    ],
  },
];

/** Three short steps. Deliberately not prose: this is a form to fill in. */
function Steps({ items, note }: { items: string[]; note?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      {note ? (
        <p className="text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}

/** A copyable command. */
function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              toast.add({ title: "Copied", type: "success" });
            } catch {
              toast.add({ title: "Copy failed", type: "error" });
            }
          }}
        >
          <CopyIcon /> Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}

function when(timestamp: number | null): string {
  if (!timestamp) return "never";
  return new Date(timestamp).toLocaleString();
}

/**
 * The workspace's MCP connector.
 *
 * One URL, which is itself the credential: a connector form — claude.ai's,
 * ChatGPT's — has a URL field and nowhere to put a header, so the token lives
 * in the path. Everything on this card follows from that: it is shown once,
 * only its hash is stored, and rotating stops the old URL working immediately.
 */
export function McpConnectorCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: Id<"workspaces">;
  workspaceName: string;
}) {
  const connector = useQuery(api.authDb.mcpConnector, { workspaceId });
  const issue = useAction(api.auth.issueMcpToken);
  const revoke = useAction(api.auth.revokeMcpToken);

  const [busy, setBusy] = useState(false);
  // Held in memory for this visit only: there is nowhere to read it back from.
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    try {
      const result = await issue({ workspaceId });
      const origin =
        typeof window === "undefined" ? "" : window.location.origin;
      setFreshUrl(`${origin}/api/mcp/${result.token}`);
      toast.add({
        title: connector ? "Connector rotated" : "Connector created",
        description: connector
          ? "The previous URL stopped working immediately."
          : "Copy the URL now — it is not shown again.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not create the connector",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugsConnectedIcon className="size-4" />
          Connect an AI assistant
          {connector ? <Badge variant="secondary">active</Badge> : null}
        </CardTitle>
        <CardDescription>
          Give an assistant a connector for {workspaceName} and it can build
          and check this workspace for you — agents, the catalogue, knowledge,
          channels and custom tools.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Shown once, right after issuing. A refresh loses it, which is the
            point: only the hash is stored, so this is the single moment the
            URL exists anywhere but the clipboard. */}
        {freshUrl ? (
          <Alert>
            <WarningIcon />
            <AlertTitle>Copy this now — it is not shown again</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                This URL is the credential. Anyone holding it has this
                workspace, so paste it into your assistant and nowhere else.
              </span>
              <div className="flex w-full gap-2">
                <Input
                  readOnly
                  value={freshUrl}
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  size="icon-lg"
                  variant="outline"
                  aria-label="Copy the connector URL"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(freshUrl);
                      toast.add({ title: "URL copied", type: "success" });
                    } catch {
                      toast.add({
                        title: "Copy failed",
                        description: "Select the text and copy it manually.",
                        type: "error",
                      });
                    }
                  }}
                >
                  <CopyIcon />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {connector === undefined ? (
          <Spinner />
        ) : connector === null ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              No connector yet.
            </p>
            <Button onClick={() => void generate()} disabled={busy}>
              {busy ? <Spinner /> : <PlugsConnectedIcon />} Create the connector
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Token</Label>
                <p className="font-mono text-sm">{connector.prefix}…</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Created</Label>
                <p className="text-sm">{when(connector.issuedAt)}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">
                  Last used
                </Label>
                <p className="text-sm">{when(connector.lastUsedAt)}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void generate()}
                disabled={busy}
              >
                {busy ? <Spinner /> : <ArrowsClockwiseIcon />} Rotate
              </Button>

              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="ghost">
                      <TrashIcon /> Revoke
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke the connector?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The URL stops working at once and any assistant using it
                      loses access to {workspaceName}. Nothing else changes —
                      create a new connector whenever you want one.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      render={<Button variant="ghost">Cancel</Button>}
                    />
                    <AlertDialogAction
                      render={
                        <Button
                          variant="destructive"
                          onClick={async () => {
                            await revoke({ workspaceId });
                            setFreshUrl(null);
                            toast.add({
                              title: "Connector revoked",
                              type: "success",
                            });
                          }}
                        >
                          Revoke
                        </Button>
                      }
                    />
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <p className="text-xs text-muted-foreground">
              Lost the URL? It cannot be read back — only the hash is stored.
              Rotate to get a new one.
            </p>
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-2">
          <Label>Where are you adding it?</Label>
          <Tabs defaultValue="claude">
            <TabsList className="w-full">
              <TabsTrigger value="claude">Claude.ai</TabsTrigger>
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="code">Claude Code</TabsTrigger>
              <TabsTrigger value="other">Other</TabsTrigger>
            </TabsList>

            <TabsContent value="claude" className="pt-3">
              <Steps
                items={[
                  "Customize → Connectors → “+” → Add custom connector.",
                  "Paste the URL. Leave the OAuth fields under Advanced empty — the token in the URL is the credential.",
                  "Add, then enable it in a new chat and ask “list my agents”.",
                ]}
                note="On Team and Enterprise an Owner adds it under Organization settings → Connectors first, and members then enable it."
              />
            </TabsContent>

            <TabsContent value="chatgpt" className="pt-3">
              <Steps
                items={[
                  "Settings → Connectors → Create.",
                  "Name it, keep Connection on “Server URL”, and paste the URL.",
                  "Leave Authentication on “No Auth”, tick the risk acknowledgement, then Create.",
                ]}
                note="This endpoint speaks Streamable HTTP, the current MCP transport, and also opens an event stream on GET. If ChatGPT rejects the URL, tell us — the server can expose a legacy /sse endpoint as well."
              />
            </TabsContent>

            <TabsContent value="code" className="pt-3">
              <Snippet
                label="Run this once"
                code={`claude mcp add --transport http magic-agent ${
                  freshUrl ?? "<your connector URL>"
                }`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Add <span className="font-mono">--scope user</span> to reach it
                from every project rather than this one.
              </p>
            </TabsContent>

            <TabsContent value="other" className="pt-3">
              <Steps
                items={[
                  "Add it as a remote MCP server over Streamable HTTP.",
                  "No headers and no OAuth: the token in the path is the whole credential.",
                  "POST carries the calls; GET opens the event stream.",
                ]}
              />
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            The assistant reaches this URL from its own servers, so it has to be
            a public address — no connector will reach{" "}
            <span className="font-mono">localhost</span>.
          </p>
        </div>

        <Separator />

        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group/tools -ml-2 text-muted-foreground"
              />
            }
          >
            <CaretRightIcon className="transition-transform group-data-panel-open/tools:rotate-90" />
            What the assistant can do
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-3 pt-3">
              {TOOL_GROUPS.map((section) => (
                <div key={section.group} className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium">{section.group}</p>
                  <div className="flex flex-wrap gap-1">
                    {section.tools.map((tool) => (
                      <Badge
                        key={tool}
                        variant="secondary"
                        className="font-mono text-[11px]"
                      >
                        {tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Exactly this workspace&apos;s permissions — the same guards the
                dashboard runs, checked on every call. It cannot reach another
                company, and the platform tools for creating or deleting
                companies are refused.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
