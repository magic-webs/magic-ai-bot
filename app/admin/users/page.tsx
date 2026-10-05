"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PasswordField,
  WorkspacePicker,
  errorText,
  relative,
  type WorkspaceOption,
} from "@/components/admin-account-fields";
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
  KeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";

type UserRow = {
  _id: Id<"users">;
  email: string;
  name?: string;
  workspaceIds: Id<"workspaces">[];
  createdAt: number;
  lastLoginAt: number | null;
  twoFactor: boolean;
};

function UserDialog({
  workspaces,
  user,
}: {
  workspaces: WorkspaceOption[];
  user?: UserRow;
}) {
  const createUser = useAction(api.auth.createUser);
  const updateUser = useMutation(api.users.update);

  const initial = () => ({
    email: user?.email ?? "",
    name: user?.name ?? "",
    password: "",
    workspaceIds: user?.workspaceIds ?? [],
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(initial);

  const invalid =
    (!user && (!form.email.includes("@") || form.password.length < 12)) ||
    form.workspaceIds.length === 0;

  const submit = async () => {
    setBusy(true);
    try {
      if (user) {
        await updateUser({
          userId: user._id,
          name: form.name.trim() || undefined,
          workspaceIds: form.workspaceIds,
        });
        toast.add({ title: "User updated", type: "success" });
      } else {
        await createUser({
          email: form.email.trim(),
          name: form.name.trim() || undefined,
          password: form.password,
          workspaceIds: form.workspaceIds,
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
        title: user ? "Could not update the user" : "Could not add the user",
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
          user ? (
            <Button size="sm" variant="outline">
              <PencilSimpleIcon /> Edit
            </Button>
          ) : (
            <Button>
              <PlusIcon /> Add user
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.email}` : "Add a user"}</DialogTitle>
          <DialogDescription>
            A user signs in with their email and runs the workspaces you give
            them, switching between them from the sidebar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {user ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                autoComplete="off"
                value={form.email}
                placeholder="owner@company.com"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              value={form.name}
              placeholder="Optional"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Workspaces</Label>
            <WorkspacePicker
              workspaces={workspaces}
              selected={form.workspaceIds}
              onChange={(workspaceIds) =>
                setForm((prev) => ({ ...prev, workspaceIds }))
              }
            />
          </div>

          {user ? null : (
            <PasswordField
              id="user-password"
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
            {busy ? <Spinner /> : user ? <PencilSimpleIcon /> : <PlusIcon />}
            {user ? "Save" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user }: { user: UserRow }) {
  const resetPassword = useAction(api.auth.resetUserPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      await resetPassword({ userId: user._id, password });
      toast.add({
        title: "Password reset",
        description: `${user.email} has been signed out everywhere.`,
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
          <DialogTitle>Reset the password for {user.email}</DialogTitle>
          <DialogDescription>
            Their open sessions end and two-factor authentication is turned off,
            so they can sign in with the new password and set it up again.
          </DialogDescription>
        </DialogHeader>
        <PasswordField
          id="reset-user-password"
          value={password}
          email={user.email}
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

function RemoveButton({ user }: { user: UserRow }) {
  const removeUser = useMutation(api.users.remove);

  const remove = async () => {
    try {
      await removeUser({ userId: user._id });
      toast.add({ title: `${user.email} removed`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not remove the user",
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
          <AlertDialogTitle>Remove {user.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out at once and their login is deleted. Their
            workspaces and everything in them stay as they are.
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

export default function AdminUsersPage() {
  const users = useQuery(api.users.list, {});
  const workspaces = useQuery(api.workspaces.list, {});

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
            Users
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Your customers&apos; own logins. Each one signs in with an email and
            password and owns the workspaces you assign.
          </p>
        </div>
        <UserDialog workspaces={options} />
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircleIcon className="size-4" /> Users
          </CardTitle>
          <CardDescription>
            Changes to a user&apos;s workspaces apply on their next request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users === undefined || workspaces === undefined ? (
            <TableSkeleton columns={4} rows={3} />
          ) : users.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No users yet. Add one to hand a customer their own login.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Workspaces</TableHead>
                    <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user._id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1.5 truncate font-medium">
                            {user.name || user.email}
                            {user.twoFactor ? <Badge variant="outline">2FA</Badge> : null}
                          </span>
                          {user.name ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {user.email}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-72">
                        <div className="flex flex-wrap gap-1">
                          {user.workspaceIds.map((id) => (
                            <Badge key={id} variant="outline">
                              {nameById.get(id) ?? "Deleted workspace"}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {relative(user.lastLoginAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <UserDialog workspaces={options} user={user} />
                          <ResetPasswordDialog user={user} />
                          <RemoveButton user={user} />
                        </div>
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
