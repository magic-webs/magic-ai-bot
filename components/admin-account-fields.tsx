"use client";

import { formatDistanceToNow } from "date-fns";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { CopyIcon, KeyIcon } from "@phosphor-icons/react";

export type WorkspaceOption = { _id: Id<"workspaces">; name: string; slug: string };

export function relative(timestamp: number | null): string {
  if (!timestamp) return "never";
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

export function randomPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${what} copied`, type: "success" });
  } catch {
    toast.add({ title: "Copy failed", type: "error" });
  }
}

export function PasswordField({
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

export function WorkspacePicker({
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
