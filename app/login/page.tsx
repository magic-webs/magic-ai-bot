"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
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
import { Logo } from "@/components/logo";
import {
  ShieldCheckIcon,
  WarningIcon,
  ArrowRightIcon,
  DevicesIcon,
  SignOutIcon,
} from "@phosphor-icons/react";

type ActiveSession = { device: string | null; lastUsedAt: number };

/** What one step of signing in comes back with. */
type Step =
  | { step: "done"; redirectTo: string }
  | { step: "twoFactor" }
  | { step: "sessionActive"; activeSession: ActiveSession };

class SignInError extends Error {
  constructor(
    message: string,
    /** The half-done sign-in is gone; only starting over will help. */
    readonly restart: boolean
  ) {
    super(message);
  }
}

async function post(
  payload: Record<string, string | boolean | undefined>
): Promise<Step> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as {
    redirectTo?: string;
    step?: "twoFactor" | "sessionActive";
    activeSession?: ActiveSession;
    error?: string;
    restart?: boolean;
  };
  if (!response.ok) {
    throw new SignInError(data.error ?? "Sign in failed.", Boolean(data.restart));
  }
  if (data.step === "twoFactor") return { step: "twoFactor" };
  if (data.step === "sessionActive" && data.activeSession) {
    return { step: "sessionActive", activeSession: data.activeSession };
  }
  return { step: "done", redirectTo: data.redirectTo ?? "/" };
}

function lastActive(timestamp: number): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function LoginForm() {
  const params = useSearchParams();
  const nextPath = params.get("next");
  const needsSetup = useQuery(api.authDb.needsSetup);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "" });
  const [setup, setSetup] = useState({ email: "", name: "", password: "" });
  // Past the password: waiting on a code, or on "sign out the other one?".
  const [pending, setPending] = useState<Exclude<Step, { step: "done" }> | null>(
    null
  );
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const startOver = () => {
    setPending(null);
    setCode("");
    setUseRecovery(false);
    setError(null);
    setForm((prev) => ({ ...prev, password: "" }));
  };

  const run = async (payload: Record<string, string | boolean | undefined>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await post(payload);
      if (result.step !== "done") {
        setPending(result);
        setCode("");
        setBusy(false);
        return;
      }

      // Honour ?next= only when it sits inside the area this session can open,
      // so a stale link cannot bounce someone somewhere they have no access to.
      const target =
        nextPath && nextPath.startsWith(result.redirectTo)
          ? nextPath
          : result.redirectTo;

      // A full document navigation, not router.replace: the Convex auth hook
      // established "signed out" while this page was rendering, and only a
      // fresh document makes it re-read the new session cookie.
      window.location.assign(target);
    } catch (caught) {
      if (caught instanceof SignInError && caught.restart) startOver();
      setError(caught instanceof Error ? caught.message : String(caught));
      setCode("");
      setBusy(false);
    }
  };

  const go = (isSetup: boolean) =>
    run(
      isSetup
        ? {
            mode: "setup",
            email: setup.email,
            name: setup.name,
            password: setup.password,
          }
        : { username: form.username, password: form.password }
    );

  const submitCode = (value = code) => {
    if (!value.trim() || busy) return;
    void run({ mode: "continue", code: value });
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-12">
      <Link href="/" className="flex items-center gap-2">
        <Logo className="h-6" />
        <span className="font-heading text-base font-semibold tracking-tight">
          Magic Agent
        </span>
      </Link>

      <Card className="w-full max-w-sm">
        {needsSetup === undefined ? (
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
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
        ) : pending?.step === "twoFactor" ? (
          <>
            <CardHeader>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>
                {useRecovery
                  ? "Enter one of the recovery codes you saved when you turned two-factor on. Each works once."
                  : "Enter the six-digit code your authenticator app shows for Magic Agent."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error ? (
                <Alert variant="destructive">
                  <WarningIcon />
                  <AlertTitle>Could not verify</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {useRecovery ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="recovery-code">Recovery code</Label>
                  <Input
                    id="recovery-code"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="abcde-fghjk"
                    className="font-mono"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitCode();
                    }}
                  />
                </div>
              ) : (
                <div className="flex justify-center py-1">
                  <InputOTP
                    autoFocus
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={setCode}
                    // Six digits is the whole code — sent without a click.
                    onComplete={(value: string) => submitCode(value)}
                    disabled={busy}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="size-11 text-lg"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              )}

              <Button
                onClick={() => submitCode()}
                disabled={busy || !code.trim()}
              >
                {busy ? <Spinner /> : <ShieldCheckIcon />} Verify
              </Button>

              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setUseRecovery((value) => !value);
                    setCode("");
                    setError(null);
                  }}
                >
                  {useRecovery ? "Use the authenticator app" : "Use a recovery code"}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={startOver}
                >
                  Start over
                </button>
              </div>
            </CardContent>
          </>
        ) : pending?.step === "sessionActive" ? (
          <>
            <CardHeader>
              <CardTitle>Already signed in elsewhere</CardTitle>
              <CardDescription>
                This login can only be open in one place at a time, and it is
                open on another device right now.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error ? (
                <Alert variant="destructive">
                  <WarningIcon />
                  <AlertTitle>Could not sign in</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <DevicesIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {pending.activeSession.device ?? "Another device"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last active {lastActive(pending.activeSession.lastUsedAt)}
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Continuing signs that device out straight away. If it is not
                yours, change your password once you are in.
              </p>

              <Button
                onClick={() => void run({ mode: "continue", replace: true })}
                disabled={busy}
              >
                {busy ? <Spinner /> : <SignOutIcon />} Sign out the other
                device and continue
              </Button>
              <Button variant="ghost" onClick={startOver} disabled={busy}>
                Cancel
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>
                Use your email, or the username you were given, and your
                password.
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
                <Label htmlFor="username">Email or username</Label>
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
              <p className="text-xs text-muted-foreground">
                Forgotten your password? Passwords are stored hashed and cannot
                be recovered — ask for a new one to be issued.
              </p>
            </CardContent>
          </>
        )}
      </Card>

      <Link href="/" className="text-xs text-muted-foreground underline">
        Back to the website
      </Link>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
