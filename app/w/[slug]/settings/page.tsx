"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { KeyValueEditor, type KeyValue } from "@/components/editors";
import { WorkspaceAccessCard } from "@/components/workspace-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  FloppyDiskIcon,
  TrashIcon,
  PaperPlaneTiltIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react";

export default function WorkspaceSettingsPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const updateWorkspace = useMutation(api.workspaces.update);
  const removeWorkspace = useMutation(api.workspaces.remove);
  const rotateSecret = useMutation(api.workspaces.rotateWebhookSecret);
  const sendTest = useAction(api.webhooks.sendTest);
  const events = useQuery(api.webhooks.listByWorkspace, {
    workspaceId: workspace._id,
    limit: 20,
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({
    name: workspace.name,
    tagline: workspace.tagline ?? "",
    industry: workspace.industry ?? "",
    description: workspace.description ?? "",
    website: workspace.website ?? "",
    supportEmail: workspace.supportEmail ?? "",
    supportPhone: workspace.supportPhone ?? "",
    address: workspace.address ?? "",
    locale: workspace.locale,
    timezone: workspace.timezone,
    currency: workspace.currency,
    webhookUrl: workspace.webhookUrl ?? "",
    facts: workspace.facts as KeyValue[],
  });

  // Re-seed the form if a different workspace is opened. Adjusting state during
  // render is the supported pattern; React re-runs this pass immediately.
  const [formFor, setFormFor] = useState<string>(workspace._id);
  if (formFor !== workspace._id) {
    setFormFor(workspace._id);
    setForm({
      name: workspace.name,
      tagline: workspace.tagline ?? "",
      industry: workspace.industry ?? "",
      description: workspace.description ?? "",
      website: workspace.website ?? "",
      supportEmail: workspace.supportEmail ?? "",
      supportPhone: workspace.supportPhone ?? "",
      address: workspace.address ?? "",
      locale: workspace.locale,
      timezone: workspace.timezone,
      currency: workspace.currency,
      webhookUrl: workspace.webhookUrl ?? "",
      facts: workspace.facts as KeyValue[],
    });
  }

  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await updateWorkspace({
        workspaceId: workspace._id,
        name: form.name,
        tagline: form.tagline,
        industry: form.industry,
        description: form.description,
        website: form.website,
        supportEmail: form.supportEmail,
        supportPhone: form.supportPhone,
        address: form.address,
        locale: form.locale,
        timezone: form.timezone,
        currency: form.currency,
        webhookUrl: form.webhookUrl,
        facts: form.facts.filter((fact) => fact.key.trim()),
      });
      toast.add({ title: "Workspace saved", type: "success" });
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      {/* Sticky so Save stays reachable however far down the form you are. */}
      <header className="sticky top-0 z-20 flex flex-wrap items-end justify-between gap-3 border-b bg-background/95 px-6 py-4 backdrop-blur">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            Workspace settings
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everything here is injected into every agent&apos;s system prompt, so
            it is worth being specific.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <FloppyDiskIcon />} Save
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-5 p-6">
      <Tabs defaultValue="profile" className="gap-4">
        <TabsList>
          <TabsTrigger value="profile">Company</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="webhook">Webhook</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Company profile</CardTitle>
              <CardDescription>
                Who the business is, what it sells, and how customers reach a human.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-name">Name</Label>
                  <Input
                    id="s-name"
                    value={form.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-tagline">Tagline</Label>
                  <Input
                    id="s-tagline"
                    value={form.tagline}
                    onChange={(event) => set("tagline", event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-industry">Industry</Label>
                  <Input
                    id="s-industry"
                    value={form.industry}
                    onChange={(event) => set("industry", event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-description">What the business does</Label>
                <Textarea
                  id="s-description"
                  rows={4}
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-website">Website</Label>
                  <Input
                    id="s-website"
                    value={form.website}
                    onChange={(event) => set("website", event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-email">Support email</Label>
                  <Input
                    id="s-email"
                    value={form.supportEmail}
                    onChange={(event) => set("supportEmail", event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-phone">Support phone</Label>
                  <Input
                    id="s-phone"
                    value={form.supportPhone}
                    onChange={(event) => set("supportPhone", event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-address">Address</Label>
                  <Input
                    id="s-address"
                    value={form.address}
                    onChange={(event) => set("address", event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-locale">Locale</Label>
                  <Input
                    id="s-locale"
                    className="font-mono"
                    value={form.locale}
                    onChange={(event) => set("locale", event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Drives spelling conventions, e.g. en-GB gives &ldquo;colour&rdquo;.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-timezone">Timezone</Label>
                  <Input
                    id="s-timezone"
                    className="font-mono"
                    value={form.timezone}
                    onChange={(event) => set("timezone", event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-currency">Currency</Label>
                  <Input
                    id="s-currency"
                    className="font-mono"
                    value={form.currency}
                    onChange={(event) => set("currency", event.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <KeyValueEditor
                label="Company facts"
                description="Short, checkable facts every agent may state — delivery areas, minimum order, opening hours, lead times."
                value={form.facts}
                onChange={(next) => set("facts", next)}
                keyPlaceholder="Delivery"
                valuePlaceholder="UK mainland only, 3–7 working days"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>Workspace access</CardTitle>
              <CardDescription>
                How the company signs in to this workspace. Passwords are generated
                by an administrator, shown once, and stored hashed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkspaceAccessCard
                workspaceId={workspace._id}
                workspaceName={workspace.slug}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhook">
          <Card>
            <CardHeader>
              <CardTitle>Outbound webhook</CardTitle>
              <CardDescription>
                Captured orders and escalations are POSTed here as JSON, signed with{" "}
                <span className="font-mono">X-Magic-Signature: sha256=…</span> (HMAC
                of the raw body using the workspace secret).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-webhook">Endpoint URL</Label>
                <Input
                  id="s-webhook"
                  className="font-mono"
                  value={form.webhookUrl}
                  placeholder="https://your-crm.example.com/hooks/magic"
                  onChange={(event) => set("webhookUrl", event.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testing || !workspace.webhookUrl}
                  onClick={async () => {
                    setTesting(true);
                    try {
                      const result = await sendTest({
                        workspaceId: workspace._id,
                      });
                      toast.add({
                        title: result.success
                          ? `Delivered — HTTP ${result.responseStatus}`
                          : "Delivery failed",
                        description: result.error ?? result.reason,
                        type: result.success ? "success" : "error",
                      });
                    } finally {
                      setTesting(false);
                    }
                  }}
                >
                  {testing ? <Spinner /> : <PaperPlaneTiltIcon />} Send test event
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await rotateSecret({ workspaceId: workspace._id });
                    toast.add({
                      title: "Signing secret rotated",
                      description:
                        "Update the shared secret on your receiver or signature checks will fail.",
                      type: "warning",
                    });
                  }}
                >
                  <ArrowsClockwiseIcon /> Rotate signing secret
                </Button>
              </div>

              <Separator />

              <div>
                <h3 className="mb-2 text-sm font-medium">Recent deliveries</h3>
                {events === undefined ? (
                  <Spinner />
                ) : events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing sent yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Event</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>When</TableHead>
                          <TableHead>Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {events.map((event) => (
                          <TableRow key={event._id}>
                            <TableCell className="font-mono">
                              {event.event}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  event.status === "sent"
                                    ? "default"
                                    : event.status === "skipped"
                                      ? "secondary"
                                      : "destructive"
                                }
                              >
                                {event.status}
                                {event.responseStatus
                                  ? ` ${event.responseStatus}`
                                  : ""}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(event.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                              {event.error ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger">
          <Card>
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>
                Deleting a workspace removes its agents, knowledge, catalogue,
                orders, conversations, tools and channels.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="destructive">
                      <TrashIcon /> Delete this workspace
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Everything in this workspace is permanently removed. This
                      cannot be undone.
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
                            await removeWorkspace({
                              workspaceId: workspace._id,
                            });
                            toast.add({
                              title: "Workspace deleted",
                              type: "success",
                            });
                            router.push("/");
                          }}
                        >
                          Delete permanently
                        </Button>
                      }
                    />
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
