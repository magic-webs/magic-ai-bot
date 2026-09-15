"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  ArrowsClockwiseIcon,
  CopyIcon,
  PlugsConnectedIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * What an assistant holding *this* connector can do.
 *
 * The workspace card leaves the platform tools out, because a company's token
 * is refused for them. Here they are the point, so they lead.
 */
const TOOL_GROUPS = [
  {
    group: "Platform administration",
    admin: true,
    tools: [
      "create_workspace",
      "issue_workspace_password",
      "set_workspace_access",
      "set_workspace_status",
      "delete_workspace",
      "workspace_access_report",
      "platform_usage",
    ],
  },
  {
    group: "Context",
    tools: ["whoami", "list_workspaces", "get_workspace", "update_workspace"],
  },
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
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
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
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

/**
 * The administrator's own MCP connector.
 *
 * One URL, which is itself the credential: a connector form — claude.ai's,
 * ChatGPT's — has a URL field and nowhere to put a header, so the token lives
 * in the path. Everything here follows from that: it is shown once, only its
 * hash is stored, and rotating stops the old URL working immediately.
 *
 * It signs in as *you*, so it carries administrator rights across every
 * workspace — which is the whole point, and also the thing to be careful with.
 * A company's own connector is a separate token, issued from their workspace
 * settings, and reaches only them.
 */
export default function AdminMcpPage() {
  const connector = useQuery(api.authDb.adminMcpConnector, {});
  const issue = useAction(api.auth.issueAdminMcpToken);
  const revoke = useAction(api.auth.revokeAdminMcpToken);

  const [busy, setBusy] = useState(false);
  // Held in memory for this visit only: there is nowhere to read it back from.
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    try {
      const result = await issue({});
      setFreshUrl(`${window.location.origin}/api/mcp/${result.token}`);
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
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          MCP connector
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Give an assistant — claude.ai, ChatGPT, Claude Code — a connector to
          this platform and it can run it for you: create tenants, issue their
          logins, build their agents and catalogues, and read what everything is
          costing.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugsConnectedIcon className="size-4" />
            Your connector
            {connector ? <Badge variant="secondary">active</Badge> : null}
          </CardTitle>
          <CardDescription>
            Issued to your administrator account, so it acts with exactly your
            rights — every workspace, plus the platform tools.
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
                  This URL is the credential, and it is the whole platform:
                  anyone holding it can create, suspend and delete any
                  workspace. Paste it into your assistant and nowhere else.
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
              <p className="text-sm text-muted-foreground">No connector yet.</p>
              <Button onClick={() => void generate()} disabled={busy}>
                {busy ? <Spinner /> : <PlugsConnectedIcon />} Create the
                connector
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
                  <Label className="text-xs text-muted-foreground">
                    Created
                  </Label>
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
                      <AlertDialogTitle>
                        Revoke your connector?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        The URL stops working at once and any assistant using it
                        loses access to the platform. Nothing else changes — no
                        workspace, and no other administrator&apos;s connector.
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
                              await revoke({});
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
                    "Add, then enable it in a new chat and ask “list my workspaces”.",
                  ]}
                  note="On Team and Enterprise an Owner adds it under Organization settings → Connectors first, and members then enable it — which, for an administrator's connector, hands the whole platform to whoever that includes."
                />
              </TabsContent>

              <TabsContent value="chatgpt" className="pt-3">
                <Steps
                  items={[
                    "Settings → Connectors → Create.",
                    "Name it, keep Connection on “Server URL”, and paste the URL.",
                    "Leave Authentication on “No Auth”, tick the risk acknowledgement, then Create.",
                  ]}
                  note="This endpoint speaks Streamable HTTP, the current MCP transport, and also opens an event stream on GET."
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
              The assistant reaches this URL from its own servers, so it has to
              be a public address — no connector will reach{" "}
              <span className="font-mono">localhost</span>.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>What the assistant can do</CardTitle>
            <CardDescription>
              Your permissions, checked by the same Convex guards the dashboard
              runs — on every call.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {TOOL_GROUPS.map((section) => (
              <div key={section.group} className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-xs font-medium">
                  {section.group}
                  {section.admin ? (
                    <Badge variant="destructive">administrator only</Badge>
                  ) : null}
                </p>
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
              The tenant-level tools will not guess a workspace: archiving,
              re-credentialing and deleting all require an explicit slug, and{" "}
              <span className="font-mono">delete_workspace</span> also wants the
              workspace&apos;s exact name — so a confused caller cannot take out
              a company on one wrong argument.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Keep it narrow</CardTitle>
            <CardDescription>
              What this URL is worth, and the two alternatives to handing it out.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Anyone holding the URL has everything you have. If it is ever
              pasted somewhere shared, rotate it here — that is enough, and it
              is instant.
            </p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>
                One company only? Issue{" "}
                <Link href="/admin/workspaces" className="underline">
                  their own connector
                </Link>{" "}
                from that workspace&apos;s settings instead. It reaches just
                them, and the platform tools stay refused.
              </li>
              <li>
                Prefer a connector nobody can revoke out from under the
                deployment? The environment route still exists —{" "}
                <span className="font-mono text-xs">
                  MAGIC_AI_BOT_MCP_TOKEN
                </span>{" "}
                with an admin{" "}
                <span className="font-mono text-xs">
                  MAGIC_AI_BOT_USERNAME
                </span>
                /
                <span className="font-mono text-xs">
                  MAGIC_AI_BOT_PASSWORD
                </span>
                . Unset, that route 404s and only the connectors on this page
                exist.
              </li>
            </ul>
            <p className="text-xs">
              <span className="font-mono">mcp/README.md</span> has the rest,
              including running the server over stdio for a local assistant.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
