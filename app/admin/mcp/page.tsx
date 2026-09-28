"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  ArrowsClockwiseIcon,
  CopyIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * What an assistant holding one of *these* connectors can do.
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
  {
    group: "Leads",
    tools: [
      "list_lead_stages",
      "seed_default_lead_stages",
      "create_lead_stage",
      "update_lead_stage",
      "reorder_lead_stages",
      "delete_lead_stage",
      "list_leads",
      "set_lead_stage",
    ],
  },
];

function when(timestamp: number | null): string {
  if (!timestamp) return "never";
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: `${what} copied`, type: "success" });
  } catch {
    toast.add({
      title: "Copy failed",
      description: "Select the text and copy it manually.",
      type: "error",
    });
  }
}

function fail(title: string, error: unknown) {
  toast.add({
    title,
    description: error instanceof Error ? error.message : String(error),
    type: "error",
  });
}

type Connector = {
  id: Id<"adminMcpTokens">;
  name: string;
  prefix: string;
  issuedAt: number;
  lastUsedAt: number | null;
};

/** One connection: its name, which token is live, and what to do with it. */
function ConnectorRow({
  connector,
  busy,
  onRotate,
  onRevoke,
}: {
  connector: Connector;
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <PlugsConnectedIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{connector.name}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{connector.prefix}…</span>
          <span>Created {when(connector.issuedAt)}</span>
          <span>
            {connector.lastUsedAt
              ? `Last used ${when(connector.lastUsedAt)}`
              : "Never used"}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 gap-1">
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
                access to the platform. Your other connectors keep working, and
                nothing else changes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                render={<Button variant="ghost">Cancel</Button>}
              />
              <AlertDialogAction
                render={
                  <Button variant="destructive" onClick={() => void onRevoke()}>
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

/**
 * The administrator's own MCP connectors.
 *
 * Each is one URL, which is itself the credential: a connector form — claude.ai's,
 * ChatGPT's — has a URL field and nowhere to put a header, so the token lives
 * in the path. Everything here follows from that: it is shown once, only its
 * hash is stored, and rotating stops the old URL working immediately.
 *
 * One per assistant, each with a name. Handing claude.ai and Claude Code the
 * same URL meant rotating one rotated both; separate connectors can be
 * rotated, revoked and recognised on their own.
 *
 * Every one of them signs in as *you*, so it carries administrator rights
 * across every workspace — which is the whole point, and also the thing to be
 * careful with. A company's own connector is a separate token, issued from
 * their workspace settings, and reaches only them.
 */
export default function AdminMcpPage() {
  const connectors = useQuery(api.authDb.adminMcpConnectors, {});
  const issue = useAction(api.auth.issueAdminMcpToken);
  const rotate = useAction(api.auth.rotateAdminMcpToken);
  const revoke = useAction(api.auth.revokeAdminMcpToken);

  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  // Which connector a rotate is in flight for.
  const [rotating, setRotating] = useState<Id<"adminMcpTokens"> | null>(null);
  // Held in memory for this visit only: there is nowhere to read it back from.
  const [fresh, setFresh] = useState<{
    id: Id<"adminMcpTokens">;
    name: string;
    url: string;
  } | null>(null);

  const urlFor = (token: string) => `${window.location.origin}/api/mcp/${token}`;

  const add = async () => {
    const wanted = name.trim();
    if (!wanted || adding) return;
    setAdding(true);
    try {
      const result = await issue({ name: wanted });
      setFresh({ id: result.tokenId, name: wanted, url: urlFor(result.token) });
      setName("");
      toast.add({
        title: `${wanted} added`,
        description: "Copy the URL now — it is not shown again.",
        type: "success",
      });
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
      setFresh({
        id: connector.id,
        name: connector.name,
        url: urlFor(result.token),
      });
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
      // The URL on screen, if it was this one's, is now dead — do not leave
      // it sitting there looking copyable.
      if (fresh?.id === connector.id) setFresh(null);
      toast.add({ title: `${connector.name} revoked`, type: "success" });
    } catch (error) {
      fail("Could not revoke the connector", error);
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

      {/* shrink-0, or the page does not scroll and this card clips instead.
          `Card` carries `overflow-hidden`, and a flex item whose overflow is
          not `visible` gets an automatic minimum size of zero — so rather than
          growing past the scrolling column it shrinks into whatever space is
          left. Nothing overflows, no scrollbar appears, and the content is
          simply cut off. Every card directly in this column carries it. */}
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugsConnectedIcon className="size-4" />
            Your connectors
            {connectors?.length ? (
              <Badge variant="secondary">{connectors.length} active</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            One for each assistant you connect, each with its own URL. All of
            them act with exactly your rights — every workspace, plus the
            platform tools.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {/* Shown once, right after adding or rotating. A refresh loses it,
              which is the point: only the hash is stored, so this is the
              single moment the URL exists anywhere but the clipboard. */}
          {fresh ? (
            <Alert>
              <WarningIcon />
              <AlertTitle>
                Copy the URL for “{fresh.name}” now — it is not shown again
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  This URL is the credential, and it is the whole platform:
                  anyone holding it can create, suspend and delete any
                  workspace. Paste it into that assistant and nowhere else. It
                  has to be reached from the internet — no assistant will
                  connect to <span className="font-mono">localhost</span>.
                </span>
                <div className="flex w-full gap-2">
                  <Input
                    readOnly
                    value={fresh.url}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    size="icon-lg"
                    variant="outline"
                    aria-label="Copy the connector URL"
                    onClick={() => void copy(fresh.url, "URL")}
                  >
                    <CopyIcon />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {/* ------------------------------------------------------ add one */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connector-name">Add a connector</Label>
            <div className="flex gap-2">
              <Input
                id="connector-name"
                value={name}
                maxLength={60}
                placeholder="Name it for where it goes, e.g. Claude.ai or Claude Code"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void add();
                }}
              />
              <Button
                onClick={() => void add()}
                disabled={adding || !name.trim()}
              >
                {adding ? <Spinner /> : <PlusIcon />} Add
              </Button>
            </div>
          </div>

          {/* --------------------------------------------------- the list */}
          {connectors === undefined ? (
            <Spinner />
          ) : connectors.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No connectors yet. Add one above for each assistant you want to
              give access to.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {connectors.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  connector={connector}
                  busy={rotating === connector.id}
                  onRotate={() => void rotateOne(connector)}
                  onRevoke={() => revokeOne(connector)}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                Lost a URL? It cannot be read back — only the hash is stored.
                Rotate that connector to get a new one.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shrink-0">
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
    </div>
  );
}
