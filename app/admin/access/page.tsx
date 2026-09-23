"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "@/components/ui/toast";
import { WorkspaceAccessDialog } from "@/components/workspace-access";
import {
  CopyIcon,
  KeyIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react";

function relative(timestamp: number | null): string {
  if (!timestamp) return "never";
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

/** 24 random characters, so the field is never filled with a guessable one. */
function randomPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function AddAdminDialog() {
  const createAdmin = useAction(api.auth.createAdmin);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "" });

  const submit = async () => {
    if (!form.email.includes("@")) {
      toast.add({ title: "An email address is required", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await createAdmin({
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        password: form.password,
      });
      toast.add({
        title: `${form.email.trim()} can now sign in`,
        description: "Hand over the password — it is not stored in readable form.",
        type: "success",
      });
      setOpen(false);
      setForm({ email: "", name: "", password: "" });
    } catch (error) {
      toast.add({
        title: "Could not add the administrator",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon /> Add administrator
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>
            An administrator reaches every workspace and can create, suspend and
            delete them. They sign in with this email address.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="off"
              value={form.email}
              placeholder="ops@example.com"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-name">Name</Label>
            <Input
              id="admin-name"
              value={form.name}
              placeholder="Optional"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-password">
              Password
              <span className="ml-1 font-normal text-muted-foreground">
                — at least 12 characters
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="admin-password"
                autoComplete="new-password"
                className="font-mono text-xs"
                value={form.password}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  setForm((prev) => ({ ...prev, password: randomPassword() }))
                }
              >
                <KeyIcon /> Generate
              </Button>
              <Button
                size="icon-lg"
                variant="outline"
                aria-label="Copy the password"
                disabled={!form.password}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(form.password);
                    toast.add({ title: "Password copied", type: "success" });
                  } catch {
                    toast.add({ title: "Copy failed", type: "error" });
                  }
                }}
              >
                <CopyIcon />
              </Button>
            </div>
            {/* Only the hash is kept, so this field is the one chance to record
                it. Said here rather than in a toast afterwards. */}
            <p className="text-xs text-muted-foreground">
              Copy it before saving — it cannot be read back afterwards.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || form.password.length < 12 || !form.email}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : <PlusIcon />} Add administrator
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "destructive" }> = {
  active: { label: "active", variant: "secondary" },
  revoked: { label: "revoked", variant: "destructive" },
};

/**
 * Who can sign in, on both sides of the platform: the companies, and the
 * administrators who run it.
 *
 * Both tables answer the same support question — "why can they not get in?" —
 * so they sit on one page rather than being two places to look.
 */
export default function AdminAccessPage() {
  const workspaces = useQuery(api.workspaces.list, {});
  const access = useQuery(api.authDb.accessSummary, {});
  const admins = useQuery(api.authDb.listAdmins, {});

  const accessById = new Map(
    (access ?? []).map((row) => [row.workspaceId as string, row])
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Access
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every password is stored hashed and shown exactly once, at the moment
          it is issued. Revoking a workspace signs out its open sessions
          immediately.
        </p>
      </header>

      {/* shrink-0, or this page does not scroll. `Card` carries
          `overflow-hidden`, and a flex item whose overflow is not `visible`
          gets an automatic minimum size of zero — so instead of growing past
          the scrolling column and making it scroll, the card shrank into
          whatever space was left and clipped its own table. Nothing
          overflowed, so no scrollbar appeared and the list just stopped
          mid-row. The same trap the agent map's canvas documents. */}
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="size-4" /> Workspace sign-ins
          </CardTitle>
          <CardDescription>
            A company signs in with its workspace ID and the password you issue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspaces === undefined || access === undefined ? (
            <TableSkeleton columns={5} />
          ) : workspaces.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyIcon />
                </EmptyMedia>
                <EmptyTitle>No workspaces yet</EmptyTitle>
                <EmptyDescription>
                  Create a workspace and it appears here with its sign-in state.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Password</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspaces.map((workspace) => {
                    const row = accessById.get(workspace._id as string);
                    const badge = row ? STATUS_BADGE[row.status] : undefined;
                    return (
                      <TableRow key={workspace._id}>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <Link
                              href={`/w/${workspace.slug}`}
                              className="truncate font-medium hover:underline"
                            >
                              {workspace.name}
                            </Link>
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              /{workspace.slug}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {badge ? (
                              <Badge variant={badge.variant}>
                                {badge.label}
                              </Badge>
                            ) : (
                              <Badge variant="outline">not issued</Badge>
                            )}
                            {row?.mustChangePassword ? (
                              <Badge variant="outline">must change</Badge>
                            ) : null}
                            {workspace.status === "archived" ? (
                              <Badge variant="secondary">archived</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {relative(row?.issuedAt ?? null)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {relative(row?.lastLoginAt ?? null)}
                        </TableCell>
                        <TableCell className="text-right">
                          <WorkspaceAccessDialog
                            workspaceId={workspace._id}
                            name={workspace.name}
                            slug={workspace.slug}
                            trigger={
                              <Button size="sm" variant="outline">
                                <KeyIcon /> Manage
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* shrink-0 for the same reason as the card above. */}
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" /> Administrators
          </CardTitle>
          <CardDescription>
            Full access to every workspace and to this console.
          </CardDescription>
          <div className="mt-2">
            <AddAdminDialog />
          </div>
        </CardHeader>
        <CardContent>
          {admins === undefined ? (
            <TableSkeleton columns={4} rows={2} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>Last sign-in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.map((admin) => (
                    <TableRow key={admin._id}>
                      <TableCell className="font-medium">
                        {admin.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {admin.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {relative(admin.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {relative(admin.lastLoginAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
