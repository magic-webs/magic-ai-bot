"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSession } from "@/components/use-session";
import { SelectField } from "@/components/select-field";
import { TableSkeleton } from "@/components/skeletons";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { toast } from "@/components/ui/toast";
import {
  CopyIcon,
  KeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

type Role = "admin" | "member";

type TeamRow = {
  _id: Id<"admins">;
  email: string;
  name?: string;
  role: Role;
  workspaceIds: Id<"workspaces">[];
  createdAt: number;
  lastLoginAt: number | null;
  twoFactor: boolean;
};

type WorkspaceOption = { _id: Id<"workspaces">; name: string; slug: string };

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin — every workspace and this console" },
  { value: "member", label: "Member — only the workspaces you pick" },
];

function relative(timestamp: number | null): string {
  if (!timestamp) return "never";
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

function randomPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${what} copied`, type: "success" });
  } catch {
    toast.add({ title: "Copy failed", type: "error" });
  }
}

function PasswordField({
  id,
  value,
  onChange,
  email,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  email?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        Password
        <span className="ml-1 font-normal text-muted-foreground">
          — at least 12 characters
        </span>
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          autoComplete="new-password"
          className="font-mono text-xs"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button variant="outline" size="lg" onClick={() => onChange(randomPassword())}>
          <KeyIcon /> Generate
        </Button>
        <Button
          size="icon-lg"
          variant="outline"
          aria-label="Copy the password"
          disabled={!value}
          onClick={() => void copy(value, "Password")}
        >
          <CopyIcon />
        </Button>
      </div>
      {email !== undefined ? (
        <Button
          variant="outline"
          disabled={!value || !email.trim()}
          onClick={() =>
            void copy(
              `Sign in at ${window.location.origin}/login\nEmail: ${email.trim()}\nPassword: ${value}`,
              "Sign-in details"
            )
          }
        >
          <CopyIcon /> Copy all sign-in details
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Copy it before saving — it cannot be read back afterwards.
      </p>
    </div>
  );
}

function WorkspacePicker({
  workspaces,
  selected,
  onChange,
}: {
  workspaces: WorkspaceOption[];
  selected: Id<"workspaces">[];
  onChange: (next: Id<"workspaces">[]) => void;
}) {
  if (workspaces.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no workspaces to assign yet.
      </p>
    );
  }
  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
      {workspaces.map((workspace) => {
        const checked = selected.includes(workspace._id);
        return (
          <label
            key={workspace._id}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(value) =>
                onChange(
                  value === true
                    ? [...selected, workspace._id]
                    : selected.filter((id) => id !== workspace._id)
                )
              }
            />
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              /{workspace.slug}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function MemberDialog({
  workspaces,
  member,
}: {
  workspaces: WorkspaceOption[];
  member?: TeamRow;
}) {
  const createAdmin = useAction(api.auth.createAdmin);
  const updateAccess = useMutation(api.authDb.updateAdminAccess);
  const { me } = useSession();
  const isSelf = Boolean(member && me?.email === member.email);

  const initial = () => ({
    email: member?.email ?? "",
    name: member?.name ?? "",
    password: "",
    role: member?.role ?? ("member" as Role),
    workspaceIds: member?.workspaceIds ?? [],
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(initial);

  const invalid =
    (!member && (!form.email.includes("@") || form.password.length < 12)) ||
    (form.role === "member" && form.workspaceIds.length === 0);

  const submit = async () => {
    setBusy(true);
    try {
      if (member) {
        await updateAccess({
          adminId: member._id,
          name: form.name.trim() || undefined,
          role: form.role,
          workspaceIds: form.role === "member" ? form.workspaceIds : [],
        });
        toast.add({ title: "Access updated", type: "success" });
      } else {
        await createAdmin({
          email: form.email.trim(),
          name: form.name.trim() || undefined,
          password: form.password,
          role: form.role,
          workspaceIds: form.role === "member" ? form.workspaceIds : [],
        });
        toast.add({
          title: `${form.email.trim()} can now sign in`,
          description: "Hand over the password — it is not stored in readable form.",
          type: "success",
        });
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: member ? "Could not update access" : "Could not add the team member",
        description: errorText(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setForm(initial());
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          member ? (
            <Button size="sm" variant="outline">
              <PencilSimpleIcon /> Edit
            </Button>
          ) : (
            <Button>
              <PlusIcon /> Add team member
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.email}` : "Add a team member"}</DialogTitle>
          <DialogDescription>
            Admins reach every workspace and this console. Members sign in to the
            same console but only see the workspaces assigned to them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {member ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-email">Email</Label>
              <Input
                id="team-email"
                type="email"
                autoComplete="off"
                value={form.email}
                placeholder="ops@example.com"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={form.name}
              placeholder="Optional"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-role">Role</Label>
            <SelectField
              id="team-role"
              value={form.role}
              disabled={isSelf}
              options={ROLE_OPTIONS}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, role: value as Role }))
              }
            />
            {isSelf ? (
              <p className="text-xs text-muted-foreground">
                You cannot change your own role.
              </p>
            ) : null}
          </div>

          {form.role === "member" ? (
            <div className="flex flex-col gap-1.5">
              <Label>Workspace access</Label>
              <WorkspacePicker
                workspaces={workspaces}
                selected={form.workspaceIds}
                onChange={(workspaceIds) =>
                  setForm((prev) => ({ ...prev, workspaceIds }))
                }
              />
            </div>
          ) : null}

          {member ? null : (
            <PasswordField
              id="team-password"
              value={form.password}
              email={form.email}
              onChange={(password) => setForm((prev) => ({ ...prev, password }))}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? <Spinner /> : member ? <PencilSimpleIcon /> : <PlusIcon />}
            {member ? "Save" : "Add team member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ member }: { member: TeamRow }) {
  const resetPassword = useAction(api.auth.resetAdminPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      await resetPassword({ adminId: member._id, password });
      toast.add({
        title: "Password reset",
        description: `${member.email} has been signed out everywhere.`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not reset the password",
        description: errorText(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPassword("");
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <KeyIcon /> Password
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset the password for {member.email}</DialogTitle>
          <DialogDescription>
            Their open sessions end and two-factor authentication is turned off,
            so they can sign in with the new password and set it up again.
          </DialogDescription>
        </DialogHeader>
        <PasswordField
          id="reset-password"
          value={password}
          email={member.email}
          onChange={setPassword}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || password.length < 12} onClick={() => void submit()}>
            {busy ? <Spinner /> : <KeyIcon />} Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveButton({ member }: { member: TeamRow }) {
  const removeAdmin = useMutation(api.authDb.removeAdmin);

  const remove = async () => {
    try {
      await removeAdmin({ adminId: member._id });
      toast.add({ title: `${member.email} removed`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not remove the team member",
        description: errorText(error),
        type: "error",
      });
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <TrashIcon /> Remove
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out at once and their login, MCP connectors and
            two-factor setup are deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
          <AlertDialogAction
            render={
              <Button variant="destructive" onClick={() => void remove()}>
                Remove
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminTeamPage() {
  const team = useQuery(api.authDb.listAdmins, {});
  const workspaces = useQuery(api.workspaces.list, {});
  const { me } = useSession();

  const options: WorkspaceOption[] = (workspaces ?? []).map((workspace) => ({
    _id: workspace._id,
    name: workspace.name,
    slug: workspace.slug,
  }));
  const nameById = new Map(options.map((option) => [option._id as string, option.name]));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Team
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The people who run the platform. Give someone the Member role to let
            them into specific workspaces only.
          </p>
        </div>
        <MemberDialog workspaces={options} />
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersThreeIcon className="size-4" /> Team members
          </CardTitle>
          <CardDescription>
            Changes to a role or its workspaces apply on their next request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {team === undefined || workspaces === undefined ? (
            <TableSkeleton columns={5} rows={3} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Workspaces</TableHead>
                    <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((member) => {
                    const isSelf = me?.email === member.email;
                    return (
                      <TableRow key={member._id}>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5 truncate font-medium">
                              {member.name || member.email}
                              {isSelf ? <Badge variant="outline">you</Badge> : null}
                              {member.twoFactor ? (
                                <Badge variant="outline">2FA</Badge>
                              ) : null}
                            </span>
                            {member.name ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {member.email}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.role === "admin" ? "default" : "secondary"}>
                            {member.role === "admin" ? "Admin" : "Member"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-72">
                          {member.role === "admin" ? (
                            <span className="text-sm text-muted-foreground">
                              All workspaces
                            </span>
                          ) : member.workspaceIds.length === 0 ? (
                            <span className="text-sm text-muted-foreground">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {member.workspaceIds.map((id) => (
                                <Badge key={id} variant="outline">
                                  {nameById.get(id) ?? "Deleted workspace"}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {relative(member.lastLoginAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <MemberDialog workspaces={options} member={member} />
                            <ResetPasswordDialog member={member} />
                            {isSelf ? null : <RemoveButton member={member} />}
                          </div>
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
    </div>
  );
}
