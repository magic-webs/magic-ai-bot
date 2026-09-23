"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { WorkspaceAccessDialog } from "@/components/workspace-access";
import { SelectField } from "@/components/select-field";
import { toast } from "@/components/ui/toast";
import { CardGridSkeleton, TableSkeleton } from "@/components/skeletons";
import {
  BuildingsIcon,
  CardsThreeIcon,
  PlusIcon,
  ArrowRightIcon,
  SparkleIcon,
  TableIcon,
  type Icon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

const LOCALES = ["en-GB", "en-US", "en-IN", "en-AU", "de-DE", "fr-FR", "es-ES"];
const CURRENCIES = ["GBP", "USD", "EUR", "INR", "AUD", "CAD", "AED"];
const TIMEZONES = [
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
];

/**
 * The two ways to read the same list.
 *
 * List is the default: this is the page an administrator opens to find one
 * workspace among all of them, and a table puts four times as many on screen
 * with the slug — the thing you actually search by — in a column of its own.
 * Cards are the better read when there are a dozen and you are surveying
 * rather than looking something up, which is what the page used to assume.
 */
type View = "list" | "cards";

const VIEWS = [
  { value: "list", label: "List", icon: TableIcon },
  { value: "cards", label: "Cards", icon: CardsThreeIcon },
] as const satisfies ReadonlyArray<{
  value: View;
  label: string;
  icon: Icon;
}>;

function CreateWorkspaceDialog() {
  const router = useRouter();
  const createWorkspace = useMutation(api.workspaces.create);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    industry: "",
    description: "",
    website: "",
    supportEmail: "",
    locale: "en-GB",
    currency: "GBP",
    timezone: "Europe/London",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.add({ title: "A workspace name is required", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const { slug } = await createWorkspace({
        name: form.name,
        tagline: form.tagline || undefined,
        industry: form.industry || undefined,
        description: form.description || undefined,
        website: form.website || undefined,
        supportEmail: form.supportEmail || undefined,
        locale: form.locale,
        currency: form.currency,
        timezone: form.timezone,
        facts: [],
      });
      toast.add({ title: `${form.name} created`, type: "success" });
      setOpen(false);
      router.push(`/w/${slug}`);
    } catch (error) {
      toast.add({
        title: "Could not create the workspace",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><PlusIcon /> New workspace</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            A workspace is one company or project. Its agents, knowledge,
            catalogue, orders and channels all live inside it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">Company or project name</Label>
            <Input
              id="ws-name"
              value={form.name}
              placeholder="Northwind Print Co"
              onChange={(event) => set("name")(event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-tagline">Tagline</Label>
              <Input
                id="ws-tagline"
                value={form.tagline}
                placeholder="Commercial print & packaging"
                onChange={(event) => set("tagline")(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-industry">Industry</Label>
              <Input
                id="ws-industry"
                value={form.industry}
                placeholder="Commercial printing"
                onChange={(event) => set("industry")(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-description">
              What the business does
              <span className="ml-1 font-normal text-muted-foreground">
                — agents are grounded in this
              </span>
            </Label>
            <Textarea
              id="ws-description"
              rows={3}
              value={form.description}
              placeholder="Northwind supplies business stationery, marketing print and branded merchandise to UK businesses. Quotes are prepared by the sales team."
              onChange={(event) => set("description")(event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-website">Website</Label>
              <Input
                id="ws-website"
                value={form.website}
                placeholder="https://example.com"
                onChange={(event) => set("website")(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-email">Support email</Label>
              <Input
                id="ws-email"
                value={form.supportEmail}
                placeholder="hello@example.com"
                onChange={(event) => set("supportEmail")(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-locale">Locale</Label>
              <SelectField
                id="ws-locale"
                className="w-full"
                value={form.locale}
                onValueChange={set("locale")}
                options={LOCALES.map((locale) => ({
                  value: locale,
                  label: locale,
                }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-currency">Currency</Label>
              <SelectField
                id="ws-currency"
                className="w-full"
                value={form.currency}
                onValueChange={set("currency")}
                options={CURRENCIES.map((currency) => ({
                  value: currency,
                  label: currency,
                }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-tz">Timezone</Label>
              <SelectField
                id="ws-tz"
                className="w-full"
                value={form.timezone}
                onValueChange={set("timezone")}
                options={TIMEZONES.map((timezone) => ({
                  value: timezone,
                  label: timezone,
                }))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />} Create workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminWorkspacesPage() {
  // The layout has already established that this is an administrator, so the
  // query is asked outright rather than skipped on a role check.
  const workspaces = useQuery(api.workspaces.list, {});
  const seedDemo = useMutation(api.workspaces.seedDemo);
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [view, setView] = useState<View>("list");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Workspaces
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One company or project each, with its own agents and data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Icons only, each carrying its name as a tooltip and an
              aria-label: two labelled buttons plus the create button would
              run this row wider than the heading beside it. */}
          <ToggleGroup
            value={[view]}
            onValueChange={(value) => {
              const next = value[0] as View | undefined;
              if (next) setView(next);
            }}
            className="rounded-lg border p-0.5"
          >
            {VIEWS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                title={`${option.label} view`}
                aria-label={`${option.label} view`}
              >
                <option.icon className="size-4" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <CreateWorkspaceDialog />
        </div>
      </header>

      {workspaces === undefined ? (
        view === "cards" ? (
          <CardGridSkeleton
            count={4}
            className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          />
        ) : (
          <TableSkeleton rows={8} columns={5} />
        )
      ) : workspaces.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingsIcon />
            </EmptyMedia>
            <EmptyTitle>No workspaces yet</EmptyTitle>
            <EmptyDescription>
              Create one for the company or project you want a bot for, or start
              from a sample workspace to see how it fits together.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              <CreateWorkspaceDialog />
              <Button
                variant="outline"
                disabled={seeding}
                onClick={async () => {
                  setSeeding(true);
                  try {
                    const { slug } = await seedDemo({});
                    router.push(`/w/${slug}`);
                  } finally {
                    setSeeding(false);
                  }
                }}
              >
                {seeding ? <Spinner /> : <SparkleIcon />} Start from a sample
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      ) : view === "list" ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Workspace</TableHead>
                <TableHead className="min-w-36">Slug</TableHead>
                <TableHead className="min-w-52">What it does</TableHead>
                <TableHead className="min-w-24">Created</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((workspace) => (
                <TableRow key={workspace._id}>
                  <TableCell className="max-w-56 min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {workspace.name}
                      </span>
                      {workspace.status === "archived" ? (
                        <Badge variant="secondary">archived</Badge>
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell className="font-mono text-xs text-muted-foreground">
                    /{workspace.slug}
                  </TableCell>

                  <TableCell className="max-w-72 min-w-0">
                    {/* Same fallback chain the card's description uses, so a
                        workspace does not read as blank in one view and
                        described in the other. */}
                    <span className="line-clamp-1 text-sm text-muted-foreground">
                      {workspace.tagline ||
                        workspace.description ||
                        workspace.industry ||
                        "No description yet"}
                    </span>
                  </TableCell>

                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDistanceToNow(workspace.createdAt, {
                      addSuffix: true,
                    })}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <WorkspaceAccessDialog
                        workspaceId={workspace._id}
                        name={workspace.name}
                        slug={workspace.slug}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/w/${workspace.slug}`} />}
                      >
                        Open <ArrowRightIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {workspaces.map((workspace) => (
            <Card key={workspace._id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{workspace.name}</span>
                  {workspace.status === "archived" ? (
                    <Badge variant="secondary">archived</Badge>
                  ) : null}
                </CardTitle>
                <CardDescription className="line-clamp-2">
                  {workspace.tagline ||
                    workspace.description ||
                    workspace.industry ||
                    "No description yet"}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  /{workspace.slug}
                </span>
                <Separator />
                <div className="flex items-center justify-between gap-1">
                  <WorkspaceAccessDialog
                    workspaceId={workspace._id}
                    name={workspace.name}
                    slug={workspace.slug}
                  />
                  <Button
                    size="lg"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/w/${workspace.slug}`} />}
                  >
                    Open <ArrowRightIcon />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
