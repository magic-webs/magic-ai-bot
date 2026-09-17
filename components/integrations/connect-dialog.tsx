"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  newToken,
  readConnection,
  type Integration,
} from "@/lib/integrations";
import {
  CopyIcon,
  LinkSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";

/**
 * Connecting an integration.
 *
 * The whole flow is: fill in what only you know (a sheet id, a folder id),
 * copy the script that is generated from it, deploy it, paste the URL back.
 * The script is regenerated on every keystroke so it always matches the fields
 * above it — the commonest way this goes wrong is pasting a script written
 * against a different sheet.
 *
 * Reconnecting reads the token back out of the tool that is already there, so
 * changing a bookable hour does not invalidate a script somebody has already
 * deployed. A first connection mints a new one.
 */

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              toast.add({ title: "Copied", type: "success" });
            } catch {
              toast.add({ title: "Copy failed", type: "error" });
            }
          }}
        >
          <CopyIcon /> Copy
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export function ConnectDialog({
  integration,
  connectedTools,
  trigger,
}: {
  integration: Integration;
  /** The tools this integration has already created, if any. */
  connectedTools: Doc<"tools">[];
  trigger: React.ReactElement;
}) {
  const workspace = useWorkspace();
  const createTool = useMutation(api.tools.create);
  const disconnect = useMutation(api.tools.disconnectIntegration);

  const setup = integration.setup;
  const existing = connectedTools[0];
  const recovered = existing?.http
    ? readConnection(existing.http.urlTemplate)
    : { baseUrl: null, token: null };

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Minted once per mount rather than per render: a token that changed while
     somebody was reading the script would not match what they deployed. */
  const [token] = useState(() => recovered.token ?? newToken());
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of setup?.fields ?? []) seed[field.key] = "";
    if (setup && recovered.baseUrl) seed[setup.urlField] = recovered.baseUrl;
    return seed;
  });

  if (!setup || !integration.tools) return trigger;

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const missing = setup.fields
    .filter((field) => field.required && !values[field.key]?.trim())
    .map((field) => field.label);
  const ready = missing.length === 0;

  const script = setup.script?.(values, token);
  /* Built from whatever is filled in so far, so the list below is a preview of
     what Connect will write rather than a separate description of it. */
  const tools = integration.tools(values, token);

  const connect = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      /* Replace rather than upsert. Reconnecting after renaming a tool would
         otherwise leave the old one behind, still enabled and still pointing
         at a URL that may no longer work. */
      await disconnect({
        workspaceId: workspace._id,
        integration: integration.id,
      });

      for (const tool of tools) {
        await createTool({
          workspaceId: workspace._id,
          name: tool.name,
          displayName: tool.displayName,
          description: tool.description,
          whenToUse: tool.whenToUse,
          kind: "http",
          parameters: tool.parameters,
          http: {
            method: tool.http.method,
            urlTemplate: tool.http.urlTemplate,
            headers: tool.http.headers,
            timeoutMs: tool.http.timeoutMs ?? 15000,
          },
          // Enabled, not draft: somebody who has just pasted a deployment URL
          // has finished connecting, and a draft tool is never given to a model.
          status: "enabled",
          integration: integration.id,
        });
      }

      toast.add({
        title: `${integration.name} connected`,
        description: `${tools.length} tool${tools.length === 1 ? "" : "s"} added. Every agent can use ${tools.length === 1 ? "it" : "them"} now.`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not connect",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {existing ? `Reconfigure ${integration.name}` : `Connect ${integration.name}`}
          </DialogTitle>
          <DialogDescription>{integration.blurb}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto">
          {/* ------------------------------------------------------- steps */}
          <div className="flex flex-col gap-2">
            <Label>How it goes</Label>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              {setup.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <Separator />

          {/* ------------------------------------------------------ fields */}
          <div className="flex flex-col gap-4">
            {setup.fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
                  {field.required ? null : (
                    <span className="text-xs text-muted-foreground">
                      optional
                    </span>
                  )}
                </div>
                <Input
                  id={`field-${field.key}`}
                  value={values[field.key] ?? ""}
                  onChange={(event) => set(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
                {field.hint ? (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                ) : null}
              </div>
            ))}
          </div>

          {/* ------------------------------------------------------ script */}
          {script ? (
            <>
              <Separator />
              <Alert>
                <WarningIcon />
                <AlertTitle>The script carries a secret</AlertTitle>
                <AlertDescription>
                  A web app deployed as “anyone with the link” is open to the
                  internet, so the script refuses any request that does not
                  carry this workspace&apos;s token. Do not publish it, and
                  re-copy the script if you ever reconnect with a new one.
                </AlertDescription>
              </Alert>
              <Snippet label="Apps Script — paste this whole thing" code={script} />
            </>
          ) : null}

          {/* ------------------------------------------------- what it adds */}
          <Separator />
          <div className="flex flex-col gap-2">
            <Label>
              What your agents get{" "}
              <span className="font-normal text-muted-foreground">
                — {tools.length} tool{tools.length === 1 ? "" : "s"}
              </span>
            </Label>
            <div className="flex flex-col gap-2">
              {tools.map((tool) => (
                <div key={tool.name} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs font-medium">{tool.name}</code>
                    <Badge variant="outline">{tool.parameters.length} inputs</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          {missing.length > 0 ? (
            <p className="mr-auto text-xs text-muted-foreground">
              Still needed: {missing.join(", ")}
            </p>
          ) : null}
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void connect()} disabled={!ready || busy}>
            {busy ? <Spinner /> : <LinkSimpleIcon />}
            {busy
              ? "Connecting…"
              : existing
                ? "Save and reconnect"
                : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
