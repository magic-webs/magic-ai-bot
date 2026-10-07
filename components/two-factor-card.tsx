"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
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
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  CopyIcon,
  DownloadSimpleIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

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

/** The key in fours, the way authenticator apps ask for it to be typed. */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      autoFocus
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={(next: string) => onComplete?.(next)}
      disabled={disabled}
    >
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} className="size-10 text-base" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

/**
 * The signed-in login's own authenticator app: turning it on, and off.
 *
 * Works the same for an administrator, a company and a human agent — each
 * sets up their own, and it protects only the login it was set up on. Whoever
 * can reset that login's password can also clear it, which is the way back in
 * for someone who loses their phone.
 */
export function TwoFactorCard({ className }: { className?: string }) {
  const status = useQuery(api.authDb.twoFactorStatus);
  const begin = useAction(api.auth.beginTwoFactorSetup);
  const [starting, setStarting] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(
    null
  );
  const [disableOpen, setDisableOpen] = useState(false);

  // A fresh secret per attempt, asked for on the click rather than when the
  // dialog mounts, so nothing can ask twice and leave the QR code showing a
  // key the server has already replaced.
  const startSetup = async () => {
    setStarting(true);
    try {
      setSetup(await begin({}));
    } catch (error) {
      toast.add({
        title: "Could not start the setup",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setStarting(false);
    }
  };

  if (status === null) return null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" /> Two-factor authentication
        </CardTitle>
        <CardDescription>
          Ask for a code from an authenticator app — Google Authenticator,
          Microsoft Authenticator, 1Password, Authy — every time this login
          signs in, so a password alone is not enough.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : status.enabled ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>on</Badge>
              {status.enabledAt ? (
                <span className="text-xs text-muted-foreground">
                  Turned on{" "}
                  {formatDistanceToNow(new Date(status.enabledAt), {
                    addSuffix: true,
                  })}
                </span>
              ) : null}
              <Badge variant={status.recoveryCodesLeft > 2 ? "ghost" : "destructive"}>
                {status.recoveryCodesLeft} recovery code
                {status.recoveryCodesLeft === 1 ? "" : "s"} left
              </Badge>
            </div>
            {status.recoveryCodesLeft <= 2 ? (
              <p className="text-xs text-muted-foreground">
                Running low on recovery codes. Turn two-factor off and on again
                to get a fresh set.
              </p>
            ) : null}
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setDisableOpen(true)}
            >
              Turn off
            </Button>
          </>
        ) : (
          <>
            <div>
              <Badge variant="secondary">off</Badge>
            </div>
            <Button
              className="self-start"
              disabled={starting}
              onClick={() => void startSetup()}
            >
              {starting ? <Spinner /> : <ShieldCheckIcon />} Set up an
              authenticator app
            </Button>
          </>
        )}
      </CardContent>

      {/* Mounted per attempt, so each starts from an empty form rather than
          whatever the last one left behind. */}
      {setup ? (
        <SetupDialog secret={setup} onClose={() => setSetup(null)} />
      ) : null}
      {disableOpen ? (
        <DisableDialog onClose={() => setDisableOpen(false)} />
      ) : null}
    </Card>
  );
}

function SetupDialog({
  secret,
  onClose,
}: {
  secret: { secret: string; uri: string };
  onClose: () => void;
}) {
  const confirm = useAction(api.auth.confirmTwoFactorSetup);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirm({ code: value });
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) {
      setError(friendlyError(caught));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!recoveryCodes) return;
    const text = [
      "Magic Agent recovery codes",
      "Each code works once, in place of an authenticator code.",
      "",
      ...recoveryCodes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "magic-agent-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {recoveryCodes ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                Two-factor authentication is on. If you lose your phone, each
                of these gets you in once instead of a code. They are shown
                only now.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
              {recoveryCodes.map((recovery) => (
                <span key={recovery}>{recovery}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void copy(recoveryCodes.join("\n"), "Recovery codes")}
              >
                <CopyIcon /> Copy
              </Button>
              <Button variant="outline" onClick={download}>
                <DownloadSimpleIcon /> Download
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>I have saved them</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Set up an authenticator app</DialogTitle>
              <DialogDescription>
                Scan the code with the app, then enter the six digits it shows
                to finish.
              </DialogDescription>
            </DialogHeader>

            {error ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>Not turned on yet</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col items-center gap-4">
              {/* White ground and a quiet zone regardless of theme, as in
                  channel-qr.tsx: a scanner needs the contrast. */}
              <div className="rounded-lg bg-white p-3">
                <QRCode
                  value={secret.uri}
                  size={176}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#0b1c12"
                />
              </div>

              <div className="flex w-full flex-col gap-1">
                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                  Or enter this key
                </Label>
                <div className="flex gap-1">
                  <Input
                    readOnly
                    value={grouped(secret.secret)}
                    className="font-mono text-xs"
                  />
                  <Button
                    size="icon-lg"
                    variant="outline"
                    aria-label="Copy key"
                    onClick={() => void copy(secret.secret, "Key")}
                  >
                    <CopyIcon />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                <Label>Code from the app</Label>
                <CodeInput
                  value={code}
                  onChange={setCode}
                  onComplete={(value) => void submit(value)}
                  disabled={busy}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={busy || code.length !== 6}
              >
                {busy ? <Spinner /> : <ShieldCheckIcon />} Turn on
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const disable = useAction(api.auth.disableTwoFactor);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value = code) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await disable({ code: value });
      toast.add({ title: "Two-factor authentication turned off", type: "success" });
      onClose();
    } catch (caught) {
      setError(friendlyError(caught));
      setCode("");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Turn off two-factor authentication?</DialogTitle>
          <DialogDescription>
            This login will sign in with its password alone. Confirm with a
            code from your authenticator app
            {useRecovery ? ", or one of your recovery codes" : ""}.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>Still on</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col items-center gap-2">
          {useRecovery ? (
            <Input
              autoFocus
              placeholder="abcde-fghjk"
              className="font-mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          ) : (
            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(value) => void submit(value)}
              disabled={busy}
            />
          )}
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              setUseRecovery((value) => !value);
              setCode("");
              setError(null);
            }}
          >
            {useRecovery ? "Use the authenticator app" : "Use a recovery code"}
          </button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy || !code.trim()}
          >
            {busy ? <Spinner /> : null} Turn off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
