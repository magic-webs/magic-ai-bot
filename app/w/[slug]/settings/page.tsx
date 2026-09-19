"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { WorkspaceAccessCard } from "@/components/workspace-access";
import { McpConnectorCard } from "@/components/mcp-connector-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { THEMES } from "@/components/workspace-theme";
import { cn } from "@/lib/utils";
import {
  FloppyDiskIcon,
  TrashIcon,
  PaperPlaneTiltIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react";

export default function WorkspaceSettingsPage() {
  const workspace = useWorkspace();
  const updateWorkspace = useMutation(api.workspaces.update);
  const rotateSecret = useMutation(api.workspaces.rotateWebhookSecret);
  const sendTest = useAction(api.webhooks.sendTest);
  const events = useQuery(api.webhooks.listByWorkspace, {
    workspaceId: workspace._id,
    limit: 20,
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({
    theme: workspace.theme ?? "",
    webhookUrl: workspace.webhookUrl ?? "",
  });

  // Re-seed the form if a different workspace is opened. Adjusting state during
  // render is the supported pattern; React re-runs this pass immediately.
  const [formFor, setFormFor] = useState<string>(workspace._id);
  if (formFor !== workspace._id) {
    setFormFor(workspace._id);
    setForm({
      theme: workspace.theme ?? "",
      webhookUrl: workspace.webhookUrl ?? "",
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
        // Sent as "" rather than undefined when the default is chosen: an
        // undefined arg is dropped before it reaches the mutation, so the
        // stored theme would never clear.
        theme: form.theme,
        webhookUrl: form.webhookUrl,
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
      <header className="sticky top-0 z-20 flex flex-wrap items-end justify-between gap-3 border-b bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Workspace settings
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Access, delivery and appearance. The company profile agents answer
            from lives under Build.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <FloppyDiskIcon />} Save
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
        <Tabs defaultValue="access" className="gap-4">
          <TabsList>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="webhook">Webhook</TabsTrigger>
            <TabsTrigger value="assistant">Assistant</TabsTrigger>
            <TabsTrigger value="theme">Theme</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>

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
                    size="lg"
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
                    size="lg"
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
          <TabsContent value="assistant">
            <McpConnectorCard
              workspaceId={workspace._id}
              workspaceName={workspace.name}
            />
          </TabsContent>
          <TabsContent value="theme">
            <Card>
              <CardHeader>
                <CardTitle>Theme</CardTitle>
                <CardDescription>
                  The palette this workspace&apos;s console renders in. Light
                  and dark are chosen separately, by your system.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {THEMES.map((option) => {
                    const value = option.id ?? "";
                    const selected = form.theme === value;
                    return (
                      <button
                        key={option.name}
                        type="button"
                        onClick={() => set("theme", value)}
                        aria-pressed={selected}
                        className={cn(
                          "flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors",
                          selected
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-border hover:border-foreground/20"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{option.name}</span>
                          {selected ? (
                            <Badge>selected</Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {option.description}
                        </p>
                        {/* Scoping the swatch row to the theme lets each one
                            preview its own tokens rather than the active ones. */}
                        <div
                          data-theme={option.id ?? "default"}
                          className="flex gap-1.5"
                        >
                          {option.swatches.map((colour) => (
                            <span
                              key={colour}
                              className="size-7 flex-1 rounded-md"
                              style={{ background: colour }}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Save to apply. The change takes effect immediately for
                  everyone who opens this workspace.
                </p>
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
                <DeleteWorkspace />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Deleting a workspace, behind the workspace's own name.
 *
 * Everything else on this page is reversible; this is the one control that
 * takes a company's agents, catalogue, orders and transcripts with it. A
 * confirmation you clear by clicking "yes" is the same single gesture as the
 * button that opened it, so the name has to be typed out — which is also what
 * stops the wrong workspace being deleted by somebody who had two tabs open.
 */
function DeleteWorkspace() {
  const workspace = useWorkspace();
  const router = useRouter();
  const removeWorkspace = useMutation(api.workspaces.remove);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Case and surrounding space are forgiven. The point is a deliberate act,
  // not a spelling test — and a workspace called "ZeroStyle" should not need
  // the capital S remembered.
  const matches =
    typed.trim().toLowerCase() === workspace.name.trim().toLowerCase();

  const submit = async () => {
    if (!matches || deleting) return;
    setDeleting(true);
    try {
      await removeWorkspace({ workspaceId: workspace._id });
      toast.add({ title: "Workspace deleted", type: "success" });
      router.push("/");
    } catch (caught) {
      toast.add({
        title: "Could not delete the workspace",
        description: caught instanceof Error ? caught.message : String(caught),
        type: "error",
      });
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Cleared on the way out, so reopening never finds the box already
        // filled in from the last time somebody thought about it.
        if (!next) setTyped("");
      }}
    >
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
            Everything in this workspace is permanently removed. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delete-confirm" className="text-sm font-normal">
            Type{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>{" "}
            to confirm
          </Label>
          <Input
            id="delete-confirm"
            value={typed}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Workspace name"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              // Enter only once the name is right, which is the same bar the
              // button answers to.
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
          <AlertDialogAction
            render={
              <Button
                variant="destructive"
                disabled={!matches || deleting}
                onClick={() => void submit()}
              >
                {deleting ? <Spinner /> : null} Delete permanently
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
