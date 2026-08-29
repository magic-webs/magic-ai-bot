"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsagePanel } from "@/components/usage-panel";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/components/use-session";
import { WorkspaceAccessCard } from "@/components/workspace-access";
import { SelectField } from "@/components/select-field";
import { toast } from "@/components/ui/toast";
import {
  BuildingsIcon,
  CoinsIcon,
  PlusIcon,
  ArrowRightIcon,
  SparkleIcon,
  KeyIcon,
  SignOutIcon,
  RobotIcon,
} from "@phosphor-icons/react";

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

function AccessDialog({
  workspaceId,
  name,
  slug,
}: {
  workspaceId: Id<"workspaces">;
  name: string;
  slug: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <KeyIcon /> Access
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Workspace access — {name}</DialogTitle>
          <DialogDescription>
            Issue the company a password for this workspace, or revoke it. They
            sign in with the workspace ID and the password you generate.
          </DialogDescription>
        </DialogHeader>
        <WorkspaceAccessCard workspaceId={workspaceId} workspaceName={slug} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminWorkspacesPage() {
  const session = useSession();
  // Only an administrator may list every workspace, so don't even ask
  // otherwise — the hint cookie that routed us here is not authoritative.
  const workspaces = useQuery(
    api.workspaces.list,
    session.isAdmin ? {} : "skip"
  );
  const seedDemo = useMutation(api.workspaces.seedDemo);
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);

  if (session.isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </main>
    );
  }

  if (!session.isAdmin) {
    return (
      <main className="flex min-h-svh items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingsIcon />
            </EmptyMedia>
            <EmptyTitle>This area is for administrators</EmptyTitle>
            <EmptyDescription>
              You are signed in to a single workspace. Open it to manage its
              agents, knowledge and channels.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex gap-2">
              {session.me?.workspaceSlug ? (
                <Button
                  nativeButton={false}
                  render={<Link href={`/w/${session.me.workspaceSlug}`} />}
                >
                  Open my workspace <ArrowRightIcon />
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void session.signOut()}>
                Sign out
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <RobotIcon className="size-3.5" />
          </span>
          <span className="font-heading text-sm font-semibold tracking-tight">
            Magic AI Bot
          </span>
          <Badge variant="secondary">administrator</Badge>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {session.me?.label ?? ""}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void session.signOut()}>
            <SignOutIcon /> Sign out
          </Button>
        </div>
      </div>

      <Tabs defaultValue="workspaces" className="gap-5">
        <TabsList>
          <TabsTrigger value="workspaces">
            <BuildingsIcon /> Workspaces
          </TabsTrigger>
          <TabsTrigger value="usage">
            <CoinsIcon /> Tokens &amp; cost
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workspaces" className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
              Magic AI Bot
            </p>
            <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
              Workspaces
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Each workspace is one company or project: its own agents, knowledge
              base, catalogue, orders, custom tools and WhatsApp numbers.
            </p>
          </div>
          <CreateWorkspaceDialog />
        </header>

        {workspaces === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading workspaces…
          </div>
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                    <AccessDialog
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        </TabsContent>

        <TabsContent value="usage">
          <UsagePanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}
