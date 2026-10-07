"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  GoogleCalendarIcon,
  GoogleDriveIcon,
  GoogleGIcon,
  GoogleSheetsIcon,
} from "@/components/integrations/google-icons";
import {
  MagicFormsIcon,
  MagicRewardIcon,
} from "@/components/integrations/app-icons";
import { INTEGRATION_DETAILS } from "@/components/integrations/integration-details";
import { FormSubmissions } from "@/components/integrations/form-submissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { APPS, type AppSpec } from "@/convex/lib/apps";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  AsteriskIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  NotionLogoIcon,
  PlugsConnectedIcon,
  RobotIcon,
  SlackLogoIcon,
  WarningIcon,
  WebhooksLogoIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * Integrations.
 *
 * A catalogue on the left and, for whichever card is open, a panel on the
 * right that holds everything about it — the connect button, what it can
 * touch, what agents do with it, how to set it up. The cards stay light so
 * the grid can be scanned; the panel is where the work happens.
 *
 * Three kinds of card, and they connect three different ways:
 *
 * - **Magic apps** — a pasted API key, because they are our own products and
 *   have no consent screen to send anyone to. Connecting registers a webhook
 *   back, so results return to the chat.
 * - **Google** — one button: the consent screen, then back here with the
 *   sheet or folder already made and the tools already written.
 * - **Other tools** — there is no built-in connection, and the card does not
 *   pretend otherwise. Each is a short guide to doing it with a custom tool or
 *   the workspace webhook, and shows as connected once one points there.
 *
 * Whatever connecting does, an agent only uses it once its switch is on under
 * Knowledge & tools — "connected but nobody is using it" is the one confusing
 * state this design creates, so the panel says so and links there.
 */

type Group = "magic" | "google" | "other";
type EntryState = "connected" | "attention" | "off";

type IconComponent = (props: { className?: string }) => ReactNode;

type Entry = {
  id: string;
  group: Group;
  name: string;
  blurb: string;
  icon: IconComponent;
  /** The tint behind the icon, echoing the product's own colour. */
  tile: string;
  state: EntryState;
  /** Beside the status in the card's footer — an account, a count. */
  stateDetail?: string;
};

const GROUPS: Array<{ id: Group; label: string; heading: string }> = [
  { id: "magic", label: "Magic Apps", heading: "Magic Apps" },
  { id: "google", label: "Google", heading: "Google" },
  { id: "other", label: "Other", heading: "Other Tools" },
];

const GOOGLE_ICONS: Record<string, IconComponent> = {
  google_sheets: GoogleSheetsIcon,
  google_calendar: GoogleCalendarIcon,
  google_drive: GoogleDriveIcon,
};

const GOOGLE_TILES: Record<string, string> = {
  google_sheets: "bg-emerald-50 dark:bg-emerald-500/10",
  google_calendar: "bg-blue-50 dark:bg-blue-500/10",
  google_drive: "bg-amber-50 dark:bg-amber-500/10",
};

const APP_ICONS: Record<string, IconComponent> = {
  magic_forms: MagicFormsIcon,
  magic_reward: MagicRewardIcon,
};

const APP_TILES: Record<string, string> = {
  magic_forms: "bg-teal-50 dark:bg-teal-500/10",
  magic_reward: "bg-orange-50 dark:bg-orange-500/10",
};

/**
 * The tools with no connection of their own. `hosts` is how a custom tool is
 * recognised as being one of these, so the card can show it as connected.
 */
type OtherTool = {
  id: string;
  name: string;
  blurb: string;
  icon: IconComponent;
  tile: string;
  hosts: string[];
  action: { label: string; path: string };
};

const OTHER_TOOLS: OtherTool[] = [
  {
    id: "slack",
    name: "Slack",
    blurb: "Get notified in your team.",
    icon: (props) => <SlackLogoIcon weight="fill" {...props} />,
    tile: "bg-fuchsia-50 text-[#611f69] dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
    hosts: ["hooks.slack.com", "slack.com/api"],
    action: { label: "Create a custom tool", path: "/tools" },
  },
  {
    id: "zapier",
    name: "Zapier",
    blurb: "Connect 6,000+ apps.",
    icon: (props) => <AsteriskIcon weight="bold" {...props} />,
    tile: "bg-orange-50 text-[#ff4f00] dark:bg-orange-500/10",
    hosts: ["hooks.zapier.com"],
    action: { label: "Open webhook settings", path: "/settings" },
  },
  {
    id: "webhooks",
    name: "Webhooks",
    blurb: "Trigger from any system.",
    icon: (props) => <WebhooksLogoIcon weight="bold" {...props} />,
    tile: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
    hosts: [],
    action: { label: "Open webhook settings", path: "/settings" },
  },
  {
    id: "notion",
    name: "Notion",
    blurb: "Read and write pages.",
    icon: (props) => <NotionLogoIcon weight="fill" {...props} />,
    tile: "bg-muted text-foreground",
    hosts: ["api.notion.com"],
    action: { label: "Create a custom tool", path: "/tools" },
  },
  {
    id: "mcp",
    name: "Claude & ChatGPT",
    blurb: "Run your workspace from an assistant.",
    icon: (props) => <RobotIcon weight="duotone" {...props} />,
    tile: "bg-primary/10 text-primary",
    hosts: [],
    action: { label: "Open assistant settings", path: "/settings" },
  },
];

type GoogleConnection = FunctionReturnType<typeof api.integrations.list>[number];
type AppConnection = FunctionReturnType<typeof api.apps.list>[number];

function catalogueCount(connection: AppConnection, app: AppSpec): string {
  const items = plural(connection.items.length, app.noun);
  return connection.groups.length > 0
    ? `${items} · ${plural(connection.groups.length, "group")}`
    : items;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const fail = (title: string, error: unknown) =>
  toast.add({
    title,
    description: friendlyError(error),
    type: "error",
  });

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function IntegrationsPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/w/${workspace.slug}`;
  const dockRef = useRef<HTMLDivElement>(null);

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
  const appConnections = useQuery(api.apps.list, {
    workspaceId: workspace._id,
  });
  const mcpConnector = useQuery(api.authDb.mcpConnector, {
    workspaceId: workspace._id,
  });

  const [group, setGroup] = useState<Group | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
    configured === undefined ||
    appConnections === undefined ||
    mcpConnector === undefined;

  const googleById = new Map(
    (connections ?? []).map((connection) => [connection.integration, connection])
  );
  const appsById = new Map(
    (appConnections ?? []).map((connection) => [connection.app, connection])
  );
  // Hand-written HTTP tools only: an integration's own rows are counted on
  // its own card.
  const customTools = (tools ?? []).filter((tool) => !tool.integration);
  const toolsFor = (other: OtherTool) =>
    customTools.filter((tool) =>
      other.hosts.some((host) => tool.http?.urlTemplate.includes(host))
    );

  const entries: Entry[] = [
    ...APPS.map((app): Entry => {
      const connection = appsById.get(app.id);
      return {
        id: app.id,
        group: "magic",
        name: app.name,
        blurb: app.blurb,
        icon: APP_ICONS[app.id],
        tile: APP_TILES[app.id],
        state: !connection
          ? "off"
          : connection.status === "error"
            ? "attention"
            : "connected",
        stateDetail: connection ? catalogueCount(connection, app) : undefined,
      };
    }),
    ...INTEGRATIONS.map((integration): Entry => {
      const connection = googleById.get(integration.id);
      return {
        id: integration.id,
        group: "google",
        name: integration.name,
        blurb: integration.blurb,
        icon: GOOGLE_ICONS[integration.id],
        tile: GOOGLE_TILES[integration.id],
        state: !connection
          ? "off"
          : connection.status === "needs_reauth"
            ? "attention"
            : "connected",
        stateDetail: connection?.accountEmail,
      };
    }),
    ...OTHER_TOOLS.map((other): Entry => {
      const matched = toolsFor(other);
      const hook = workspace.webhookUrl?.trim() ?? "";
      const connected =
        other.id === "webhooks"
          ? Boolean(hook)
          : other.id === "mcp"
            ? Boolean(mcpConnector)
            : matched.length > 0 ||
              other.hosts.some((host) => hook.includes(host));
      return {
        id: other.id,
        group: "other",
        name: other.name,
        blurb: other.blurb,
        icon: other.icon,
        tile: other.tile,
        state: connected ? "connected" : "off",
        stateDetail:
          matched.length > 0 ? plural(matched.length, "custom tool") : undefined,
      };
    }),
  ];

  const needle = search.trim().toLowerCase();
  const visible = entries.filter(
    (entry) =>
      (group === "all" || entry.group === group) &&
      (!needle ||
        entry.name.toLowerCase().includes(needle) ||
        entry.blurb.toLowerCase().includes(needle))
  );
  const connectedCount = entries.filter(
    (entry) => entry.state !== "off"
  ).length;
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The catalogue and the panel share this row. `relative` is what the
          panel docks against — the same arrangement as the agent map. */}
      <div ref={dockRef} className="relative flex min-h-0 min-w-0 flex-1">
        <div className="@container flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <InputGroup className="h-11 max-w-xl rounded-xl bg-muted/40">
            <InputGroupAddon>
              <MagnifyingGlassIcon className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search integrations…"
              aria-label="Search integrations"
            />
          </InputGroup>

          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                <PlugsConnectedIcon className="size-3.5" /> Integrations
              </span>
              <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">
                Integrations
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                Connect powerful tools to extend your agents. Allow your agents
                to take action, read data, and create content across the tools
                you use every day.
              </p>
            </div>
            {loading ? (
              <Spinner />
            ) : (
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 text-sm font-medium text-primary">
                <span className="size-2 rounded-full bg-emerald-500" />
                {connectedCount} connected
              </span>
            )}
          </header>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
            <FilterChip
              active={group === "all"}
              onClick={() => setGroup("all")}
              label="All"
            />
            {GROUPS.map((item) => (
              <FilterChip
                key={item.id}
                active={group === item.id}
                onClick={() => setGroup(item.id)}
                label={item.label}
                count={entries.filter((entry) => entry.group === item.id).length}
              />
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed p-6">
              <p className="text-sm font-medium">
                Nothing matches “{search.trim()}”.
              </p>
              <p className="text-sm text-muted-foreground">
                Anything not listed can be reached with a{" "}
                <Link
                  href={`${base}/tools`}
                  className="text-foreground underline underline-offset-4"
                >
                  custom tool
                </Link>{" "}
                pointed at its API or a webhook.
              </p>
            </div>
          ) : (
            GROUPS.map((item) => {
              const rows = visible.filter((entry) => entry.group === item.id);
              if (rows.length === 0) return null;
              return (
                <section key={item.id} className="flex flex-col gap-3">
                  <h2 className="font-heading text-lg font-semibold tracking-tight">
                    {item.heading}
                  </h2>
                  <div
                    className={cn(
                      "grid items-stretch gap-4",
                      // Sized by the room the catalogue has, not the window:
                      // the panel takes 28rem of it while it is open.
                      item.id === "magic"
                        ? "@lg:grid-cols-2"
                        : item.id === "google"
                          ? "@lg:grid-cols-2 @3xl:grid-cols-3"
                          : "@md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4"
                    )}
                  >
                    {rows.map((entry) => (
                      <CatalogueCard
                        key={entry.id}
                        entry={entry}
                        selected={entry.id === selectedId}
                        onOpen={() => setSelectedId(entry.id)}
                        agentsHref={`${base}/agents`}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {/* Reserves the panel's width in flow, so the catalogue narrows beside
            it rather than sitting underneath. Below lg the panel overlays. */}
        {selected ? (
          <div className="hidden w-md shrink-0 lg:block" aria-hidden />
        ) : null}

        <Sheet
          open={Boolean(selected)}
          // A panel beside the catalogue, not a layer over it: the grid stays
          // live, and picking another card swaps what the panel shows.
          modal={false}
          onOpenChange={(open, details) => {
            if (open) return;
            if (
              details.reason === "outside-press" ||
              details.reason === "focus-out"
            ) {
              return;
            }
            setSelectedId(null);
          }}
        >
          <SheetContent
            side="right"
            container={dockRef}
            showOverlay={false}
            // Written with SheetContent's own variant chain so tailwind-merge
            // replaces its max-w-sm rather than losing to it — see the agent
            // map, where the same mismatch left a 4rem gap.
            className="absolute inset-y-0 right-0 h-full gap-0 border-l p-0 shadow-xl data-[side=right]:w-full data-[side=right]:sm:w-md data-[side=right]:sm:max-w-md lg:shadow-none"
          >
            {selected ? (
              <DetailPanel
                key={selected.id}
                entry={selected}
                base={base}
                agents={agents ?? []}
                tools={tools ?? []}
                customTools={
                  selected.group === "other"
                    ? toolsFor(
                        OTHER_TOOLS.find((other) => other.id === selected.id)!
                      )
                    : []
                }
                googleConnection={googleById.get(selected.id)}
                googleConfigured={Boolean(configured?.google)}
                appConnection={appsById.get(selected.id as AppSpec["id"])}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-primary/25 bg-primary/10 text-primary"
          : "bg-background text-foreground hover:bg-muted"
      )}
    >
      {label}
      {count !== undefined ? (
        <span
          className={cn(
            "rounded-full px-1.5 text-xs tabular-nums",
            active ? "bg-primary/15" : "bg-muted text-muted-foreground"
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function Tile({
  entry,
  size = "md",
}: {
  entry: Entry;
  size?: "md" | "lg";
}) {
  const Icon = entry.icon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "lg"
          ? "size-16 rounded-2xl border bg-background shadow-sm"
          : "size-12 rounded-xl",
        size === "md" && entry.tile
      )}
    >
      <Icon className={size === "lg" ? "size-10" : "size-7"} />
    </span>
  );
}

function StateLine({ entry }: { entry: Entry }) {
  if (entry.state === "attention") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <WarningIcon weight="fill" className="size-3.5" /> Needs attention
      </span>
    );
  }
  if (entry.state === "connected") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
        <CheckCircleIcon weight="fill" className="size-3.5 shrink-0" />
        <span className="truncate">
          Connected
          {entry.stateDetail ? (
            <span className="text-muted-foreground"> · {entry.stateDetail}</span>
          ) : null}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <CircleIcon className="size-3.5" /> Not connected
    </span>
  );
}

function CatalogueCard({
  entry,
  selected,
  onOpen,
  agentsHref,
}: {
  entry: Entry;
  selected: boolean;
  onOpen: () => void;
  agentsHref: string;
}) {
  return (
    // A div rather than a button, because the menu inside it is a button of
    // its own and buttons do not nest.
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group/card relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-all outline-none hover:border-primary/30 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-primary/50 ring-3 ring-primary/15"
      )}
    >
      <div className="flex items-start gap-3.5">
        <Tile entry={entry} />
        <div className="min-w-0 flex-1 pr-7">
          <p className="flex flex-wrap items-center gap-2 font-heading text-base font-semibold">
            {entry.name}
            {entry.state === "connected" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            ) : null}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {entry.blurb}
          </p>
        </div>
      </div>

      <div className="mt-auto pt-1 text-xs">
        <StateLine entry={entry} />
      </div>

      <div
        className="absolute top-3 right-3"
        // Keeps a click on the menu from also opening the panel.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Actions for ${entry.name}`}
                className="text-muted-foreground"
              />
            }
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>View details</DropdownMenuItem>
            {entry.group !== "other" && entry.state !== "off" ? (
              <DropdownMenuItem render={<Link href={agentsHref} />}>
                Switch on for an agent
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function DetailPanel({
  entry,
  base,
  agents,
  tools,
  customTools,
  googleConnection,
  googleConfigured,
  appConnection,
}: {
  entry: Entry;
  base: string;
  agents: Doc<"agents">[];
  tools: Doc<"tools">[];
  customTools: Doc<"tools">[];
  googleConnection: GoogleConnection | undefined;
  googleConfigured: boolean;
  appConnection: AppConnection | undefined;
}) {
  const detail = INTEGRATION_DETAILS[entry.id];
  const app = entry.group === "magic" ? APPS.find((a) => a.id === entry.id) : undefined;
  const google =
    entry.group === "google"
      ? INTEGRATIONS.find((integration) => integration.id === entry.id)
      : undefined;
  const other =
    entry.group === "other"
      ? OTHER_TOOLS.find((tool) => tool.id === entry.id)
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {/* SheetContent draws its own close button in the corner. */}
        <div className="flex items-start gap-4 pr-8">
          <Tile entry={entry} size="lg" />
          <div className="min-w-0">
            <SheetTitle className="font-heading text-2xl font-bold tracking-tight">
              {entry.name}
            </SheetTitle>
            <SheetDescription className="mt-1">{entry.blurb}</SheetDescription>
          </div>
        </div>

        {app ? (
          <>
            <AppAction app={app} connection={appConnection} />
            {app.id === "magic_forms" && appConnection ? (
              <FormSubmissions base={base} />
            ) : null}
          </>
        ) : google ? (
          <GoogleAction
            integration={google}
            connection={googleConnection}
            configured={googleConfigured}
          />
        ) : other ? (
          <Button
            size="lg"
            className="h-11 w-full rounded-lg"
            nativeButton={false}
            render={<Link href={`${base}${other.action.path}`} />}
          >
            {other.action.label}
            <ArrowSquareOutIcon />
          </Button>
        ) : null}

        {detail ? (
          <Tabs defaultValue="overview" className="gap-3">
            <TabsList className="h-10! w-full justify-start gap-1 rounded-xl bg-transparent p-0">
              <PanelTab value="overview">Overview</PanelTab>
              <PanelTab value="permissions">Permissions</PanelTab>
              <PanelTab value="agents">What agents can do</PanelTab>
              <PanelTab value="faq">FAQ</PanelTab>
            </TabsList>

            <TabsContent value="overview">
              <div className="flex flex-col gap-4 rounded-xl border p-4">
                {detail.features.map((feature) => (
                  <div key={feature.title} className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <feature.icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{feature.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {feature.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="permissions">
              <div className="flex flex-col gap-4 rounded-xl border p-4 text-sm">
                <div className="flex flex-col gap-2">
                  <p className="font-semibold">It can</p>
                  {detail.permissions.can.map((line) => (
                    <p key={line} className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      <span className="text-muted-foreground">{line}</span>
                    </p>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="font-semibold">It never</p>
                  {detail.permissions.never.map((line) => (
                    <p key={line} className="flex items-start gap-2">
                      <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <span className="text-muted-foreground">{line}</span>
                    </p>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="agents">
              <AgentsTab
                base={base}
                agents={agents}
                app={app}
                appConnection={appConnection}
                google={google}
                googleTools={tools.filter(
                  (tool) => google && tool.integration === google.id
                )}
                customTools={customTools}
              />
            </TabsContent>

            <TabsContent value="faq">
              <div className="flex flex-col divide-y rounded-xl border">
                {detail.faq.map((item) => (
                  <div key={item.q} className="p-4">
                    <p className="text-sm font-semibold">{item.q}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.a}</p>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        ) : null}

        {detail ? (
          <div className="flex flex-col gap-3 border-t pt-5">
            <h3 className="font-heading text-base font-semibold">
              How to connect
            </h3>
            <ol className="flex flex-col gap-3">
              {detail.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="pt-1">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-1 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <CheckCircleIcon
                weight="fill"
                className="mt-0.5 size-5 shrink-0 text-emerald-600"
              />
              <span>{detail.note}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PanelTab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-9 flex-none rounded-lg px-2.5 data-active:bg-primary/10 data-active:text-primary data-active:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

/** Which agents have a tool switched on, or a nudge to switch it on. */
function UsedBy({
  agents,
  names,
  base,
}: {
  agents: Doc<"agents">[];
  names: string[];
  base: string;
}) {
  const using = agents.filter((agent) =>
    (agent.integrationTools ?? []).some((name) => names.includes(name))
  );
  if (using.length === 0) {
    return (
      <Link
        href={`${base}/agents`}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        Not on any agent yet — switch it on under Knowledge & tools
      </Link>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      On for{" "}
      <span className="text-foreground">
        {using.map((agent) => agent.name).join(", ")}
      </span>
    </p>
  );
}

function AgentsTab({
  base,
  agents,
  app,
  appConnection,
  google,
  googleTools,
  customTools,
}: {
  base: string;
  agents: Doc<"agents">[];
  app: AppSpec | undefined;
  appConnection: AppConnection | undefined;
  google: IntegrationSpec | undefined;
  googleTools: Doc<"tools">[];
  customTools: Doc<"tools">[];
}) {
  const toolRow = (name: string, label: string, body: string) => (
    <div key={name} className="flex flex-col gap-1 p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <code className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs">
          {name}
        </code>
        <span className="font-medium">{label}</span>
      </p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );

  if (app) {
    const items = appConnection?.items ?? [];
    const groups = appConnection?.groups ?? [];
    return (
      <div className="flex flex-col gap-3">
        <div className="divide-y rounded-xl border">
          {toolRow(app.toolName, app.toolLabel, app.toolSummary)}
          {items.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 p-4">
              {items.map((item) => (
                <span
                  key={item.key}
                  className="max-w-full truncate rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
                  title={item.kind ?? undefined}
                >
                  {item.title}
                </span>
              ))}
            </div>
          ) : null}
          {groups.length > 0 ? (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-xs font-medium text-muted-foreground">Groups</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((group) => (
                  <span
                    key={group.key}
                    className="max-w-full truncate rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs"
                    title={group.forms.join(", ")}
                  >
                    {group.title}
                    <span className="text-muted-foreground">
                      {" "}
                      · {plural(group.forms.length, app.noun)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {appConnection ? (
          <UsedBy agents={agents} names={[app.toolName]} base={base} />
        ) : null}
      </div>
    );
  }

  if (google) {
    const calls = googleTools.reduce((sum, tool) => sum + tool.callCount, 0);
    return (
      <div className="flex flex-col gap-3">
        <div className="divide-y rounded-xl border">
          {google.tools.map((tool) =>
            toolRow(tool.name, tool.displayName, tool.description)
          )}
        </div>
        {googleTools.length > 0 ? (
          <>
            <UsedBy
              agents={agents}
              names={google.tools.map((tool) => tool.name)}
              base={base}
            />
            {calls > 0 ? (
              <p className="text-xs text-muted-foreground">
                {plural(calls, "call")} so far
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        An agent calls a custom tool when the customer asks for what its “when
        to use” describes, and only if it is switched on for that agent.
      </p>
      {customTools.length > 0 ? (
        <div className="divide-y rounded-xl border">
          {customTools.map((tool) =>
            toolRow(tool.name, tool.displayName, tool.description)
          )}
        </div>
      ) : null}
      <Link
        href={`${base}/tools`}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        Open Custom tools
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

function GoogleAction({
  integration,
  connection,
  configured,
}: {
  integration: IntegrationSpec;
  connection: GoogleConnection | undefined;
  /** False when the deployment has no Google client configured. */
  configured: boolean;
}) {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const startConnect = useAction(api.integrations.startGoogleConnect);
  const disconnect = useMutation(api.integrations.disconnect);
  const [busy, setBusy] = useState(false);

  const connected = Boolean(connection);
  const stale = connection?.status === "needs_reauth";

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
      fail(`Could not start ${integration.name}`, error);
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
        description: `${plural(result.removed, "tool")} removed. Agents can no longer reach it.`,
        type: "success",
      });
    } catch (error) {
      fail("Could not disconnect", error);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!configured ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Google sign-in isn&apos;t available yet</AlertTitle>
          <AlertDescription>Contact support.</AlertDescription>
        </Alert>
      ) : null}

      {stale && connection?.lastError ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Google refused the last call</AlertTitle>
          <AlertDescription>{connection.lastError}</AlertDescription>
        </Alert>
      ) : null}

      {connected && connection ? (
        <ConnectedBox>
          {connection.accountEmail ? (
            <p className="truncate font-medium">{connection.accountEmail}</p>
          ) : null}
          {connection.resource ? (
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-muted-foreground">
              <span className="truncate">{connection.resource.name}</span>
              {connection.resource.url ? (
                <a
                  href={connection.resource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  Open <ArrowSquareOutIcon className="size-3" />
                </a>
              ) : null}
            </p>
          ) : null}
        </ConnectedBox>
      ) : null}

      <Button
        size="lg"
        variant={connected && !stale ? "outline" : "default"}
        className="h-11 w-full rounded-lg"
        onClick={() => void connect()}
        disabled={busy || !configured}
      >
        {busy ? (
          <Spinner />
        ) : (
          <span className="flex size-5 items-center justify-center rounded-full bg-white">
            <GoogleGIcon className="size-3.5" />
          </span>
        )}
        {busy
          ? "Opening Google…"
          : connected
            ? "Reconnect with Google"
            : "Connect with Google"}
      </Button>

      {connected ? (
        <DisconnectButton
          name={integration.name}
          onConfirm={drop}
          description={`The ${plural(integration.tools.length, "tool")} it added will be deleted and switched off on every agent. Nothing in your Google account is touched${connection?.resource ? ` — ${connection.resource.name} stays exactly where it is` : ""}.`}
        />
      ) : null}
    </div>
  );
}

function AppAction({
  app,
  connection,
}: {
  app: AppSpec;
  connection: AppConnection | undefined;
}) {
  const workspace = useWorkspace();
  const connect = useAction(api.apps.connect);
  const refresh = useAction(api.apps.refresh);
  const disconnect = useAction(api.apps.disconnect);
  const setReply = useMutation(api.apps.setReplyOnResult);

  const [apiKey, setApiKey] = useState("");
  // A connected app hides the key field behind "Replace key", so it is not
  // mistaken for a setting that has to be filled in again.
  const [askingKey, setAskingKey] = useState(false);
  const [busy, setBusy] = useState<"connect" | "refresh" | null>(null);

  const connected = Boolean(connection);
  const showKeyField = !connected || askingKey;

  const submitKey = async () => {
    if (!apiKey.trim()) return;
    setBusy("connect");
    try {
      const result = await connect({
        workspaceId: workspace._id,
        app: app.id,
        apiKey,
      });
      setApiKey("");
      setAskingKey(false);
      toast.add({
        title: `${app.name} connected`,
        description: `${result.account.name} — ${plural(result.count, app.noun)} ready. Switch it on for an agent under Knowledge & tools.`,
        type: "success",
      });
    } catch (error) {
      fail(`Could not connect ${app.name}`, error);
    } finally {
      setBusy(null);
    }
  };

  const reload = async () => {
    setBusy("refresh");
    try {
      const result = await refresh({ workspaceId: workspace._id, app: app.id });
      toast.add({ title: plural(result.count, app.noun), type: "success" });
    } catch (error) {
      fail("Could not refresh", error);
    } finally {
      setBusy(null);
    }
  };

  const drop = async () => {
    try {
      const result = await disconnect({ workspaceId: workspace._id, app: app.id });
      toast.add({
        title: `${app.name} disconnected`,
        description: result.unsubscribed
          ? "Agents can no longer send it, and it no longer reports back here."
          : `Agents can no longer send it. ${app.name} could not be reached to remove the webhook, but anything it sends is now refused.`,
        type: "success",
      });
    } catch (error) {
      fail("Could not disconnect", error);
    }
  };

  const toggleReply = async (value: boolean) => {
    try {
      await setReply({ workspaceId: workspace._id, app: app.id, value });
    } catch (error) {
      fail("Could not save", error);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {connection?.status === "error" && connection.lastError ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>{app.name} refused the last call</AlertTitle>
          <AlertDescription>{connection.lastError}</AlertDescription>
        </Alert>
      ) : null}

      {connection ? (
        <ConnectedBox>
          <p className="truncate font-medium">
            {connection.account.name}{" "}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              ({connection.account.slug})
            </span>
          </p>
          <p className="text-muted-foreground">
            {catalogueCount(connection, app)} ·{" "}
            {connection.sentCount} sent · {connection.resultCount} came back
          </p>
        </ConnectedBox>
      ) : null}

      {showKeyField ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitKey();
          }}
        >
          <Label htmlFor={`${app.id}-key`}>API key</Label>
          <Input
            id={`${app.id}-key`}
            type="password"
            autoComplete="off"
            className="h-10 font-mono"
            placeholder={`${app.keyPrefix}…`}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button
            type="submit"
            size="lg"
            className="h-11 w-full rounded-lg"
            disabled={!apiKey.trim() || busy !== null}
          >
            {busy === "connect" ? <Spinner /> : <PlugsConnectedIcon />}
            {busy === "connect"
              ? "Connecting…"
              : connected
                ? "Use this key"
                : `Connect ${app.name}`}
          </Button>
        </form>
      ) : null}

      {connection ? (
        <>
          <div className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Reply when it comes back</p>
              <p className="text-xs text-muted-foreground">
                The agent answers the result in the chat. Off, it is only
                written into the thread.
              </p>
            </div>
            <Switch
              checked={connection.replyOnResult}
              onCheckedChange={(value) => void toggleReply(value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => void reload()}
              disabled={busy !== null}
            >
              {busy === "refresh" ? <Spinner /> : <ArrowsClockwiseIcon />}
              Refresh {app.noun}s
            </Button>
            {!askingKey ? (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setAskingKey(true)}
              >
                Replace key
              </Button>
            ) : null}
          </div>

          <DisconnectButton
            name={app.name}
            onConfirm={drop}
            description={`${app.toolName} is switched off on every agent, and ${app.name} stops reporting results here. Links already sent keep working for the customer, but what they send back will not reach the chat. Nothing in ${app.name} is deleted.`}
          />
        </>
      ) : null}
    </div>
  );
}

function ConnectedBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
      <CheckCircleIcon
        weight="fill"
        className="mt-0.5 size-5 shrink-0 text-emerald-600"
      />
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
    </div>
  );
}

function DisconnectButton({
  name,
  description,
  onConfirm,
}: {
  name: string;
  description: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" className="w-full text-muted-foreground">
            Disconnect {name}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm()}>
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
