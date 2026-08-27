"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  RobotIcon,
  ShieldCheckIcon,
  WarningIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";

async function post(payload: Record<string, string | undefined>) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { redirectTo?: string; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Sign in failed.");
  return data.redirectTo ?? "/";
}

function LoginForm() {
  const params = useSearchParams();
  const nextPath = params.get("next");
  const needsSetup = useQuery(api.authDb.needsSetup);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "" });
  const [setup, setSetup] = useState({ email: "", name: "", password: "" });

  const go = async (isSetup: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const redirectTo = isSetup
        ? await post({
            mode: "setup",
            email: setup.email,
            name: setup.name,
            password: setup.password,
          })
        : await post({
            username: form.username,
            password: form.password,
          });

      // Honour ?next= only when it sits inside the area this session can open,
      // so a stale link cannot bounce someone somewhere they have no access to.
      const target =
        nextPath && nextPath.startsWith(redirectTo) ? nextPath : redirectTo;

      // A full document navigation, not router.replace: the Convex auth hook
      // established "signed out" while this page was rendering, and only a
      // fresh document makes it re-read the new session cookie.
      window.location.assign(target);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-12">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <RobotIcon className="size-4" />
        </span>
        <span className="font-heading text-sm font-semibold tracking-tight">
          Magic AI Bot
        </span>
      </Link>

      <Card className="w-full max-w-sm">
        {needsSetup === undefined ? (
          <CardContent className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
            <Spinner /> Loading…
          </CardContent>
        ) : needsSetup ? (
          <>
            <CardHeader>
              <CardTitle>Set up your account</CardTitle>
              <CardDescription>
                This is a fresh installation. Create the owner account to get
                started — this form closes once it exists.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error ? (
                <Alert variant="destructive">
                  <WarningIcon />
                  <AlertTitle>Could not finish setup</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-name">Your name</Label>
                <Input
                  id="setup-name"
                  value={setup.name}
                  onChange={(event) =>
                    setSetup((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-email">Email</Label>
                <Input
                  id="setup-email"
                  type="email"
                  autoComplete="username"
                  value={setup.email}
                  placeholder="you@company.com"
                  onChange={(event) =>
                    setSetup((prev) => ({ ...prev, email: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-password">Password</Label>
                <Input
                  id="setup-password"
                  type="password"
                  autoComplete="new-password"
                  value={setup.password}
                  placeholder="At least 12 characters"
                  onChange={(event) =>
                    setSetup((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void go(true);
                  }}
                />
              </div>
              <Button onClick={() => void go(true)} disabled={busy}>
                {busy ? <Spinner /> : <ShieldCheckIcon />} Create account
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>
                Use the username and password you were given.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error ? (
                <Alert variant="destructive">
                  <WarningIcon />
                  <AlertTitle>Sign in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  value={form.username}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      username: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void go(false);
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void go(false);
                  }}
                />
              </div>

              <Button
                onClick={() => void go(false)}
                disabled={busy || !form.username.trim() || !form.password}
              >
                {busy ? <Spinner /> : <ArrowRightIcon />} Sign in
              </Button>

              <Separator />
              <p className="text-[0.625rem] text-muted-foreground">
                Forgotten your password? Passwords are stored hashed and cannot
                be recovered — ask for a new one to be issued.
              </p>
            </CardContent>
          </>
        )}
      </Card>

      <Link href="/" className="text-[0.625rem] text-muted-foreground underline">
        Back to the website
      </Link>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center gap-2 bg-muted/30 text-xs text-muted-foreground">
          <Spinner /> Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
