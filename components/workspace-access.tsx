"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSession } from "@/components/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  KeyIcon,
  CopyIcon,
  ProhibitIcon,
  CheckCircleIcon,
  WarningIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react";

function relative(timestamp: number | null): string {
  if (!timestamp) return "never";
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${what} copied`, type: "success" });
  } catch {
    toast.add({
      title: "Copy failed",
      description: "Select the text and copy it manually.",
      type: "error",
    });
  }
}

/**
 * Shown-once credential handoff. The password only exists in memory here — it
 * is never stored in plaintext and cannot be retrieved again.
 */
function IssuedPasswordDialog({
  issued,
  onClose,
}: {
  issued: { password: string; slug: string } | null;
  onClose: () => void;
}) {
  const signInUrl =
    typeof window === "undefined" ? "/login" : `${window.location.origin}/login`;

  return (
    <Dialog open={Boolean(issued)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workspace password issued</DialogTitle>
          <DialogDescription>
            Copy these details now — the password is stored hashed and cannot be
            shown again. Generate a new one if it is lost.
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                Workspace ID
              </Label>
              <div className="flex gap-1">
                <Input readOnly value={issued.slug} className="font-mono" />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Copy workspace ID"
                  onClick={() => void copy(issued.slug, "Workspace ID")}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                Password
              </Label>
              <div className="flex gap-1">
                <Input
                  readOnly
                  value={issued.password}
                  className="font-mono text-sm tracking-wide"
                />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Copy password"
                  onClick={() => void copy(issued.password, "Password")}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>

            <Separator />

            <Button
              variant="outline"
              onClick={() =>
                void copy(
                  `Sign in at ${signInUrl}\nWorkspace ID: ${issued.slug}\nPassword: ${issued.password}`,
                  "Sign-in details"
                )
              }
            >
              <CopyIcon /> Copy all sign-in details
            </Button>

            <Alert>
              <WarningIcon />
              <AlertTitle>Send it over a channel you trust</AlertTitle>
              <AlertDescription>
                Anyone with these two values can open this workspace. The
                company is prompted to change the password on first sign-in.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function WorkspaceAccessCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: Id<"workspaces">;
  workspaceName: string;
}) {
  const { isAdmin, me } = useSession();
  const access = useQuery(api.authDb.workspaceAccess, { workspaceId });
  const generate = useAction(api.auth.generateWorkspacePassword);
  const setAccess = useAction(api.auth.setWorkspaceAccess);
  const changePassword = useAction(api.auth.changeWorkspacePassword);

  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{
    password: string;
    slug: string;
  } | null>(null);
  const [change, setChange] = useState({ current: "", next: "", confirm: "" });

  if (access === undefined) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> Loading access…
      </div>
    );
  }

  const runGenerate = async () => {
    setBusy(true);
    try {
      const result = await generate({ workspaceId });
      setIssued(result);
    } catch (error) {
      toast.add({
        title: "Could not issue a password",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const runSetStatus = async (status: "active" | "revoked") => {
    setBusy(true);
    try {
      await setAccess({ workspaceId, status });
      toast.add({
        title: status === "revoked" ? "Access revoked" : "Access restored",
        description:
          status === "revoked"
            ? "Any open sessions were signed out immediately."
            : undefined,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not change access",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const runChangePassword = async () => {
    if (change.next !== change.confirm) {
      toast.add({ title: "The new passwords do not match", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await changePassword({
        currentPassword: change.current,
        newPassword: change.next,
      });
      setChange({ current: "", next: "", confirm: "" });
      toast.add({ title: "Password changed", type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not change the password",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <IssuedPasswordDialog issued={issued} onClose={() => setIssued(null)} />

      <div className="flex flex-wrap items-center gap-2">
        {access.hasPassword ? (
          <Badge variant={access.status === "active" ? "default" : "destructive"}>
            {access.status === "active" ? "access active" : "access revoked"}
          </Badge>
        ) : (
          <Badge variant="secondary">no password issued</Badge>
        )}
        {access.mustChangePassword ? (
          <Badge variant="outline">must change on first sign-in</Badge>
        ) : null}
        {access.activeSessions > 0 ? (
          <Badge variant="ghost">
            {access.activeSessions} open session
            {access.activeSessions === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-2 text-[0.625rem] text-muted-foreground sm:grid-cols-3">
        <div>
          <p className="uppercase tracking-wide">Workspace ID</p>
          <p className="font-mono text-foreground">{workspaceName}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Issued</p>
          <p>{relative(access.issuedAt)}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Last sign-in</p>
          <p>{relative(access.lastLoginAt)}</p>
        </div>
      </div>

      {isAdmin ? (
        <>
          <Separator />
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button disabled={busy}>
                    {busy ? <Spinner /> : <KeyIcon />}
                    {access.hasPassword
                      ? "Generate a new password"
                      : "Generate password"}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {access.hasPassword
                      ? "Replace the current password?"
                      : "Issue a workspace password?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {access.hasPassword
                      ? "The existing password stops working immediately and any open sessions are signed out. The new password is shown once."
                      : "A strong password is generated and shown once. Send it to the company along with the workspace ID."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    render={<Button variant="ghost">Cancel</Button>}
                  />
                  <AlertDialogAction
                    render={
                      <Button onClick={() => void runGenerate()}>
                        Generate
                      </Button>
                    }
                  />
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {access.hasPassword ? (
              access.status === "active" ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void runSetStatus("revoked")}
                >
                  <ProhibitIcon /> Revoke access
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void runSetStatus("active")}
                >
                  <CheckCircleIcon /> Restore access
                </Button>
              )
            ) : null}
          </div>
        </>
      ) : null}

      {/* The company changing its own password. */}
      {me?.role === "workspace" ? (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-xs font-medium">Change your password</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Replace the password your administrator issued with one only you
                know.
              </p>
            </div>

            {access.mustChangePassword ? (
              <Alert>
                <WarningIcon />
                <AlertTitle>Still using the issued password</AlertTitle>
                <AlertDescription>
                  Set your own password so the person who issued it can no
                  longer sign in as you.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-current">Current password</Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={change.current}
                  onChange={(event) =>
                    setChange((prev) => ({
                      ...prev,
                      current: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-next">New password</Label>
                <Input
                  id="pw-next"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                  value={change.next}
                  onChange={(event) =>
                    setChange((prev) => ({ ...prev, next: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-confirm">Confirm</Label>
                <Input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={change.confirm}
                  onChange={(event) =>
                    setChange((prev) => ({
                      ...prev,
                      confirm: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <Button
              className="self-start"
              disabled={
                busy ||
                !change.current ||
                change.next.length < 12 ||
                !change.confirm
              }
              onClick={() => void runChangePassword()}
            >
              {busy ? <Spinner /> : <ArrowsClockwiseIcon />} Change password
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
