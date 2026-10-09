"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { placeholderPaths } from "@/convex/lib/notifications";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { RuleDialog } from "@/components/notifications/rule-dialog";
import {
  fail,
  statusVariant,
  useFieldInsert,
  type EmailTemplate,
  type NotificationLog,
  type Overview,
  type Rule,
  type WhatsAppTemplate,
} from "@/components/notifications/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CardGridSkeleton, TableSkeleton } from "@/components/skeletons";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  ArrowsClockwiseIcon,
  BellIcon,
  ClockCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  GearIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
  WebhooksLogoIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";

/**
 * Notifications — WhatsApp and email alerts for what happens in the workspace.
 *
 * An *alert* listens for one event — a record filed in a book, a record moving
 * stage, an order, an escalation, or another system posting to the alert's own
 * URL — and sends one template to the people it names, filled from the event.
 * The WhatsApp templates are the ones in the business account, synced from the
 * panel; the emails are written here and go out from the platform's address.
 * Activity is every send, including the ones that could not go and why.
 */

const ago = (instant: number) => formatDistanceToNow(instant, { addSuffix: true });

/** Variables most emails reach for, as a starting point in the editor. */
const EMAIL_VARIABLES = [
  { path: "record.person.name", label: "Name" },
  { path: "record.reference", label: "Reference" },
  { path: "record.serialNumber", label: "Serial number" },
  { path: "record.stage", label: "Stage" },
  { path: "book.name", label: "Book" },
  { path: "orderNumber", label: "Order number" },
  { path: "customer.name", label: "Customer" },
  { path: "workspace.name", label: "Business name" },
  { path: "now", label: "Date and time" },
];

/**
 * First guesses for a workspace that has saved no senders yet, from how it
 * already describes itself. Only a starting value — nothing is stored until
 * Save.
 */
const DIAL_CODES: Record<string, string> = {
  INR: "91",
  GBP: "44",
  USD: "1",
  CAD: "1",
  AUD: "61",
  AED: "971",
  SGD: "65",
  SAR: "966",
};

function localDefaults(workspace: { currency: string }) {
  return { countryCode: DIAL_CODES[workspace.currency] ?? "" };
}

// ----------------------------------------------------------------- senders

function SendersDialog({
  overview,
  onClose,
}: {
  overview: Overview;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const save = useMutation(api.notifications.saveSettings);
  const sendTest = useAction(api.notificationsSend.sendTestEmail);
  const { settings } = overview;
  const guess = localDefaults(workspace);

  const [channelId, setChannelId] = useState<string>(
    settings.whatsappChannelId ?? overview.sender?._id ?? ""
  );
  const [countryCode, setCountryCode] = useState(
    settings.defaultCountryCode ?? guess.countryCode
  );
  const [fromName, setFromName] = useState(settings.fromName ?? "");
  const [replyTo, setReplyTo] = useState(settings.replyTo ?? "");
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const submit = async () => {
    setBusy("save");
    try {
      await save({
        workspaceId: workspace._id,
        whatsappChannelId: channelId ? (channelId as Id<"channels">) : null,
        defaultCountryCode: countryCode,
        fromName,
        replyTo,
      });
      toast.add({ title: "Senders saved", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not save the senders", error);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const result = await sendTest({ workspaceId: workspace._id, to: testTo });
      setTestResult(
        result.ok
          ? { ok: true, text: `Sent to ${testTo.trim()}. Check the inbox, and spam.` }
          : { ok: false, text: result.error ?? "It did not send." }
      );
    } catch (error) {
      setTestResult({ ok: false, text: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Senders</DialogTitle>
          <DialogDescription>
            Where alerts go out from. An alert only needs the one it sends on.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <section className="flex flex-col gap-3">
            <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <WhatsappLogoIcon className="size-3.5" /> WhatsApp
            </h3>
            {overview.channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No WhatsApp number on this workspace.{" "}
                <Link className="underline" href={`/w/${workspace.slug}/channels`}>
                  Connect one
                </Link>{" "}
                first.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <div className="flex flex-col gap-1.5">
                  <Label>Send from</Label>
                  <SelectField
                    aria-label="Send from"
                    value={channelId}
                    onValueChange={setChannelId}
                    options={overview.channels.map((channel) => ({
                      value: channel._id as string,
                      label: `${channel.name}${channel.phone ? ` · ${channel.phone}` : ""}${
                        channel.status === "active" ? "" : ` (${channel.status})`
                      }`,
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Templates are synced from this number’s business account.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="country-code">Country code</Label>
                  <Input
                    id="country-code"
                    value={countryCode}
                    inputMode="numeric"
                    placeholder="91"
                    onChange={(change) =>
                      setCountryCode(change.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                  />
                  <p className="text-xs text-muted-foreground">For numbers typed without one.</p>
                </div>
              </div>
            )}
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <EnvelopeSimpleIcon className="size-3.5" /> Email
            </h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from-name">Sender name</Label>
                <Input
                  id="from-name"
                  value={fromName}
                  placeholder={workspace.name}
                  onChange={(change) => setFromName(change.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Emails arrive from “{fromName.trim() || workspace.name} via{" "}
                  {overview.emailSender.platformName}” &lt;{overview.emailSender.address}&gt;.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reply-to">Reply-to</Label>
                <Input
                  id="reply-to"
                  type="email"
                  value={replyTo}
                  placeholder="support@yourcompany.com"
                  onChange={(change) => setReplyTo(change.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Where replies to these emails go.
                </p>
              </div>
            </div>
          </section>

          <Separator />
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Send a test email
            </h3>
            <p className="text-xs text-muted-foreground">Uses the saved settings, so save first.</p>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testTo}
                placeholder="you@yourcompany.com"
                onChange={(change) => setTestTo(change.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy !== null || !testTo.trim()}
                onClick={() => void test()}
              >
                {busy === "test" ? <Spinner /> : <PaperPlaneTiltIcon />} Send
              </Button>
            </div>
            {testResult ? (
              <p
                className={cn(
                  "text-sm break-words",
                  testResult.ok ? "text-primary" : "text-destructive"
                )}
              >
                {testResult.text}
              </p>
            ) : null}
          </section>
        </DialogBody>

        <DialogFooter>
          <Button disabled={busy !== null} onClick={() => void submit()}>
            {busy === "save" ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------ whatsapp template

function TemplateDialog({
  template,
  onUse,
  onClose,
}: {
  template: WhatsAppTemplate;
  onUse: () => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const send = useAction(api.notificationsSend.sendMessage);
  const [to, setTo] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await send({
        workspaceId: workspace._id,
        channel: "whatsapp",
        to,
        whatsappTemplateName: template.name,
        whatsappLanguage: template.language,
        params: template.slots.map((slot) => ({ key: slot.key, value: values[slot.key] ?? "" })),
      });
      setResult(
        outcome.ok
          ? { ok: true, text: `Sent to ${to.trim()}.` }
          : { ok: false, text: outcome.error ?? "It did not send." }
      );
    } catch (error) {
      setResult({ ok: false, text: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  const header =
    template.header?.format === "TEXT"
      ? template.header.text
      : template.header
        ? `[${template.header.format.toLowerCase()}]`
        : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono">
            {template.name}
            <Badge variant={statusVariant(template.status)}>{template.status.toLowerCase()}</Badge>
          </DialogTitle>
          <DialogDescription>
            {template.language} · {template.category.toLowerCase()} — as approved in WhatsApp
            Manager.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* The message the way the customer sees it, blanks and all. */}
          <div className="flex flex-col gap-2 rounded-lg bg-[#efeae2] p-4 dark:bg-[#0b141a]">
            <div className="flex max-w-md flex-col gap-1.5 rounded-lg rounded-tl-none bg-white p-3 text-sm text-neutral-900 shadow-sm dark:bg-[#202c33] dark:text-neutral-100">
              {header ? <p className="font-semibold">{header}</p> : null}
              {template.body ? <p className="whitespace-pre-wrap">{template.body}</p> : null}
              {template.footer ? (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{template.footer}</p>
              ) : null}
            </div>
            {template.buttons.length > 0 ? (
              <div className="flex max-w-md flex-col gap-1">
                {template.buttons.map((button) => (
                  <span
                    key={button.index}
                    className="rounded-lg bg-white py-2 text-center text-sm font-medium text-sky-600 shadow-sm dark:bg-[#202c33] dark:text-sky-400"
                  >
                    {button.text}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {template.unsupported ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertDescription>{template.unsupported}</AlertDescription>
            </Alert>
          ) : null}

          {template.sendable ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Send it now
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="send-to">To</Label>
                  <Input
                    id="send-to"
                    value={to}
                    placeholder="+91 98765 43210"
                    onChange={(change) => setTo(change.target.value)}
                  />
                </div>
                {template.slots.map((slot) => (
                  <div key={slot.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`value-${slot.key}`} className="font-mono">
                      {slot.label}
                    </Label>
                    <Input
                      id={`value-${slot.key}`}
                      value={values[slot.key] ?? ""}
                      placeholder={slot.example ? `e.g. ${slot.example}` : "Value"}
                      onChange={(change) =>
                        setValues((current) => ({ ...current, [slot.key]: change.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              {result ? (
                <p className={cn("text-sm break-words", result.ok ? "text-primary" : "text-destructive")}>
                  {result.text}
                </p>
              ) : null}
            </section>
          ) : !template.unsupported ? (
            <p className="text-sm text-muted-foreground">
              Only approved templates can be sent. This one is {template.status.toLowerCase()} in
              WhatsApp Manager.
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {template.sendable ? (
            <>
              <Button variant="outline" onClick={onUse}>
                <BellIcon /> Use in an alert
              </Button>
              <Button disabled={busy || !to.trim()} onClick={() => void submit()}>
                {busy ? <Spinner /> : <PaperPlaneTiltIcon />} Send
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------- email template

function EmailDialog({
  template,
  emailReady,
  onClose,
}: {
  template: EmailTemplate | null;
  emailReady: boolean;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const save = useMutation(api.notifications.saveEmailTemplate);
  const remove = useMutation(api.notifications.removeEmailTemplate);
  const send = useAction(api.notificationsSend.sendMessage);
  const fields = useFieldInsert();

  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [format, setFormat] = useState<"text" | "html">(template?.format ?? "text");
  const [to, setTo] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "delete" | "send" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // What the saved version uses — a send is of the saved template, not the
  // draft in the boxes.
  const savedVariables = template?.variables ?? [];
  const draftVariables = useMemo(() => placeholderPaths(`${subject}\n${body}`), [subject, body]);

  const insert = (path: string) => {
    const token = `{{${path}}}`;
    if (fields.focused === "subject") setSubject(fields.splice("subject", subject, token));
    else setBody(fields.splice("body", body, token));
  };

  const submit = async () => {
    setBusy("save");
    try {
      await save({
        workspaceId: workspace._id,
        templateId: template?._id,
        name,
        subject,
        body,
        format,
      });
      toast.add({ title: `${name.trim()} saved`, type: "success" });
      onClose();
    } catch (error) {
      fail("Could not save the email", error);
    } finally {
      setBusy(null);
    }
  };

  const destroy = async () => {
    if (!template) return;
    setBusy("delete");
    try {
      await remove({ templateId: template._id });
      toast.add({ title: "Email deleted", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not delete the email", error);
    } finally {
      setBusy(null);
    }
  };

  const trySend = async () => {
    if (!template) return;
    setBusy("send");
    setResult(null);
    try {
      const outcome = await send({
        workspaceId: workspace._id,
        channel: "email",
        to,
        emailTemplateId: template._id,
        values: savedVariables.map((path) => ({ key: path, value: values[path] ?? "" })),
      });
      setResult(
        outcome.ok
          ? { ok: true, text: `Sent to ${to.trim()}.` }
          : { ok: false, text: outcome.error ?? "It did not send." }
      );
    } catch (error) {
      setResult({ ok: false, text: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit email" : "New email"}</DialogTitle>
          <DialogDescription>
            Variables in <code>{"{{double braces}}"}</code> are filled from the event the alert
            listens for — the same fields the workspace webhook receives.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-name">Name</Label>
              <Input
                id="email-name"
                value={name}
                maxLength={60}
                placeholder="Booking confirmation"
                onChange={(change) => setName(change.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                {...fields.bind("subject")}
                value={subject}
                placeholder="Your booking {{record.reference}} is confirmed"
                onChange={(change) => setSubject(change.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="email-body">Message</Label>
              <ToggleGroup
                value={[format]}
                onValueChange={(value) => {
                  const next = value[0] as "text" | "html" | undefined;
                  if (next) setFormat(next);
                }}
                className="rounded-lg border p-0.5"
              >
                <ToggleGroupItem value="text">Plain text</ToggleGroupItem>
                <ToggleGroupItem value="html">HTML</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Textarea
              id="email-body"
              {...fields.bind("body")}
              value={body}
              rows={12}
              className={cn(format === "html" && "font-mono text-xs")}
              placeholder={
                format === "html"
                  ? "<p>Hi {{record.person.name}},</p>\n<p>Thanks — we have your booking.</p>"
                  : "Hi {{record.person.name}},\n\nThanks — we have your booking."
              }
              onChange={(change) => setBody(change.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {format === "html"
                ? "Sent as written. Values from the event are escaped, so a customer’s name cannot break the layout."
                : "Line breaks are kept."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EMAIL_VARIABLES.map((variable) => (
                <Button
                  key={variable.path}
                  size="xs"
                  variant="outline"
                  className="border-dashed"
                  title={`{{${variable.path}}}`}
                  onMouseDown={(press) => press.preventDefault()}
                  onClick={() => insert(variable.path)}
                >
                  {variable.label}
                </Button>
              ))}
            </div>
            {draftVariables.length ? (
              <p className="text-xs text-muted-foreground">
                Uses {draftVariables.map((path) => `{{${path}}}`).join(", ")}. Record book fields
                are <code>{"{{record.details.<field>}}"}</code>.
              </p>
            ) : null}
          </div>

          {format === "html" && body.trim() ? (
            <div className="flex flex-col gap-1.5">
              <Label>Preview</Label>
              {/* Sandboxed: this is the workspace's own markup, but a preview
                  has no business running scripts in the dashboard. */}
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={body}
                className="h-64 w-full rounded-md border border-border bg-white"
              />
            </div>
          ) : null}

          {template ? (
            <>
              <Separator />
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Send it now
                </h3>
                {!emailReady ? (
                  <p className="text-sm text-muted-foreground">
                    Email sending is not available right now. Contact support.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Sends the saved version. Fill in its variables for this one send.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor="email-to">To</Label>
                        <Input
                          id="email-to"
                          type="email"
                          value={to}
                          placeholder="name@company.com"
                          onChange={(change) => setTo(change.target.value)}
                        />
                      </div>
                      {savedVariables.map((path) => (
                        <div key={path} className="flex flex-col gap-1.5">
                          <Label htmlFor={`var-${path}`} className="font-mono">{`{{${path}}}`}</Label>
                          <Input
                            id={`var-${path}`}
                            value={values[path] ?? ""}
                            placeholder="Value"
                            onChange={(change) =>
                              setValues((current) => ({ ...current, [path]: change.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        disabled={busy !== null || !to.trim()}
                        onClick={() => void trySend()}
                      >
                        {busy === "send" ? <Spinner /> : <PaperPlaneTiltIcon />} Send
                      </Button>
                      {result ? (
                        <p
                          className={cn(
                            "text-sm break-words",
                            result.ok ? "text-primary" : "text-destructive"
                          )}
                        >
                          {result.text}
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </section>
            </>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {template ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void destroy()}>
              {busy === "delete" ? <Spinner /> : <TrashIcon />} Delete
            </Button>
          ) : (
            <span />
          )}
          <Button
            disabled={busy !== null || !name.trim() || !subject.trim() || !body.trim()}
            onClick={() => void submit()}
          >
            {busy === "save" ? <Spinner /> : null} Save email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------- log

const LOG_VARIANT = {
  sent: "default",
  failed: "destructive",
  skipped: "secondary",
} as const;

function LogDialog({ log, onClose }: { log: NotificationLog; onClose: () => void }) {
  const rows: Array<[string, string | undefined]> = [
    ["Alert", log.ruleName ?? (log.kind === "manual" ? "Sent by hand" : "Test")],
    ["Channel", log.channel === "whatsapp" ? "WhatsApp" : "Email"],
    ["Template", log.templateName],
    ["Subject", log.subject],
    ["Provider reference", log.messageId],
    ["When", new Date(log.createdAt).toLocaleString()],
  ];
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {log.to || "Nobody to send to"}
            <Badge variant={LOG_VARIANT[log.status]}>{log.status}</Badge>
          </DialogTitle>
          <DialogDescription>{ago(log.createdAt)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
        </dl>
        {log.error ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>Why it did not send</AlertTitle>
            <AlertDescription className="break-words">{log.error}</AlertDescription>
          </Alert>
        ) : null}
        {log.preview ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
            {log.preview}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------- cards

function RuleCard({ rule, onOpen }: { rule: Rule; onOpen: () => void }) {
  const setEnabled = useMutation(api.notifications.setRuleEnabled);
  const [pending, setPending] = useState<boolean | null>(null);
  const enabled = pending ?? rule.enabled;

  const toggle = async (next: boolean) => {
    setPending(next);
    try {
      await setEnabled({ ruleId: rule._id, enabled: next });
    } catch (error) {
      fail("Could not change it", error);
    } finally {
      setPending(null);
    }
  };

  const what =
    rule.channel === "whatsapp"
      ? (rule.whatsappTemplateName ?? "no template")
      : (rule.emailTemplateName ?? "a deleted email");
  const where = rule.bookId ? (rule.bookName ? ` in ${rule.bookName}` : " in a deleted book") : "";

  return (
    // A div rather than a button: the switch inside is a button of its own.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(press) => {
        if (press.key === "Enter" || press.key === " ") {
          press.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-3 rounded-lg border border-border p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50",
        !enabled && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {rule.channel === "whatsapp" ? (
            <WhatsappLogoIcon className="size-5" />
          ) : (
            <EnvelopeSimpleIcon className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{rule.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {rule.event === "inbound" ? (
              <WebhooksLogoIcon className="mr-1 inline size-3.5 align-[-2px]" />
            ) : null}
            {rule.eventLabel}
            {where}
            {rule.stage ? ` · ${rule.stage}` : ""}
          </span>
        </span>
        <span onClick={(click) => click.stopPropagation()} onKeyDown={(press) => press.stopPropagation()}>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void toggle(next)}
            aria-label={`${rule.name} switched on`}
          />
        </span>
      </div>

      <p className="truncate text-sm">
        Sends <span className="font-medium">{what}</span> to {rule.recipients.length}{" "}
        {rule.recipients.length === 1 ? "recipient" : "recipients"}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">{rule.sentCount} sent</Badge>
        {rule.failedCount > 0 ? <Badge variant="secondary">{rule.failedCount} not sent</Badge> : null}
        <span>{rule.lastFiredAt ? `last ${ago(rule.lastFiredAt)}` : "not fired yet"}</span>
      </div>

      {rule.lastError ? (
        <p className="line-clamp-2 text-xs text-destructive">{rule.lastError}</p>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------- page

type Editing = { key: number; rule: Rule | null; template?: WhatsAppTemplate | null };

export default function NotificationsPage() {
  const workspace = useWorkspace();
  const workspaceId = workspace._id;

  const [tab, setTab] = useState("alerts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("approved");
  const [logFilter, setLogFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [sendersOpen, setSendersOpen] = useState(false);
  const [template, setTemplate] = useState<WhatsAppTemplate | null>(null);
  const [email, setEmail] = useState<{ key: number; template: EmailTemplate | null } | null>(
    null
  );
  const [log, setLog] = useState<NotificationLog | null>(null);

  const overview = useQuery(api.notifications.overview, { workspaceId });
  const rules = useQuery(api.notifications.listRules, { workspaceId });
  const templates = useQuery(api.notifications.listWhatsAppTemplates, { workspaceId });
  const emails = useQuery(api.notifications.listEmailTemplates, { workspaceId });
  const logs = useQuery(
    api.notifications.listLogs,
    tab === "activity" ? { workspaceId, limit: 200 } : "skip"
  );
  const syncTemplates = useAction(api.notificationsSend.syncWhatsAppTemplates);

  const filteredTemplates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (templates ?? []).filter(
      (item) =>
        (statusFilter === "all" ||
          (statusFilter === "approved" ? item.status === "APPROVED" : item.status !== "APPROVED")) &&
        (!term ||
          item.name.toLowerCase().includes(term) ||
          (item.body ?? "").toLowerCase().includes(term))
    );
  }, [templates, search, statusFilter]);

  const filteredLogs = useMemo(
    () =>
      (logs ?? []).filter((item) =>
        logFilter === "all" ? true : logFilter === "sent" ? item.status === "sent" : item.status !== "sent"
      ),
    [logs, logFilter]
  );

  const openRule = (rule: Rule | null, preset?: WhatsAppTemplate | null) =>
    setEditing({ key: Date.now(), rule, template: preset });

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncTemplates({ workspaceId });
      toast.add({
        title: "Templates synced",
        description: `${result.count} ${result.count === 1 ? "template" : "templates"}, ${result.approved} approved.`,
        type: "success",
      });
    } catch (error) {
      fail("Could not sync templates", error);
    } finally {
      setSyncing(false);
    }
  };

  const approved = (templates ?? []).filter((item) => item.status === "APPROVED").length;
  const activeRules = (rules ?? []).filter((item) => item.enabled).length;
  const failingRules = (rules ?? []).filter((item) => item.lastError).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            WhatsApp templates and emails sent when a record is filed or moves stage, an order
            comes in, an agent escalates — or another system calls your webhook.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!overview} onClick={() => setSendersOpen(true)}>
            <GearIcon /> Senders
          </Button>
          <Button disabled={!overview} onClick={() => openRule(null)}>
            <PlusIcon /> New alert
          </Button>
        </div>
      </header>

      {/* --------------------------------------------------------- senders */}
      {overview === undefined ? (
        <TableSkeleton rows={1} columns={2} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: <WhatsappLogoIcon className="size-5" />,
              title: "WhatsApp",
              ready: Boolean(overview.sender),
              detail: overview.sender
                ? `Sends from ${overview.sender.phone ?? overview.sender.name}`
                : "No live number — connect one under Channels.",
            },
            {
              icon: <EnvelopeSimpleIcon className="size-5" />,
              title: "Email",
              ready: overview.emailReady,
              detail: overview.emailReady
                ? `Sends as ${overview.emailSender.name}${
                    overview.settings.replyTo ? ` · replies to ${overview.settings.replyTo}` : ""
                  }`
                : "Email sending is not available right now. Contact support.",
            },
          ].map((sender) => (
            <button
              key={sender.title}
              type="button"
              onClick={() => setSendersOpen(true)}
              className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40"
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  sender.ready ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {sender.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {sender.title}
                  <Badge variant={sender.ready ? "default" : "outline"}>
                    {sender.ready ? "ready" : "not set up"}
                  </Badge>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{sender.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <Separator />

      <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="alerts">
            <BellIcon /> Alerts
            {rules?.length ? (
              <Badge variant="outline" className="ml-1">
                {activeRules}/{rules.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <WhatsappLogoIcon /> WhatsApp templates
          </TabsTrigger>
          <TabsTrigger value="email">
            <EnvelopeSimpleIcon /> Email templates
          </TabsTrigger>
          <TabsTrigger value="activity">
            <ClockCounterClockwiseIcon /> Activity
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- alerts */}
        <TabsContent value="alerts" className="flex flex-col gap-4 pt-4">
          {failingRules > 0 ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>
                {failingRules === 1 ? "1 alert" : `${failingRules} alerts`} did not send last time
              </AlertTitle>
              <AlertDescription>
                The reason is on each card, and in full under Activity.
              </AlertDescription>
            </Alert>
          ) : null}

          {rules === undefined || overview === undefined ? (
            <CardGridSkeleton count={3} />
          ) : rules.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellIcon />
                </EmptyMedia>
                <EmptyTitle>No alerts yet</EmptyTitle>
                <EmptyDescription>
                  Tell a customer their booking is confirmed when the record is filed, tell the
                  team when an order comes in, or send a template whenever your website form
                  posts to a webhook.
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={() => openRule(null)}>
                <PlusIcon /> New alert
              </Button>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rules.map((rule) => (
                <RuleCard key={rule._id} rule={rule} onOpen={() => openRule(rule)} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ------------------------------------------------ whatsapp templates */}
        <TabsContent value="whatsapp" className="flex flex-col gap-4 pt-4">
          {overview === undefined ? (
            <CardGridSkeleton count={3} />
          ) : !overview.sender ? (
            <Alert>
              <WarningCircleIcon />
              <AlertTitle>Connect WhatsApp first</AlertTitle>
              <AlertDescription>
                Templates are synced from the business account of the sending number. Add one
                under{" "}
                <Link className="underline" href={`/w/${workspace.slug}/channels`}>
                  Channels
                </Link>
                .
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {templates === undefined
                      ? "Templates"
                      : `${templates.length} ${templates.length === 1 ? "template" : "templates"} · ${approved} approved`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {overview.settings.templatesSyncedAt
                      ? `Synced ${ago(overview.settings.templatesSyncedAt)} from ${overview.sender.phone ?? overview.sender.name}.`
                      : "Not synced yet — pull every template from the WhatsApp business account."}{" "}
                    New and edited templates are approved in WhatsApp Manager, then synced here.
                  </p>
                </div>
                <Button variant="outline" disabled={syncing} onClick={() => void sync()}>
                  {syncing ? <Spinner /> : <ArrowsClockwiseIcon />} Sync templates
                </Button>
              </div>

              {overview.settings.templatesSyncError ? (
                <Alert variant="destructive">
                  <WarningCircleIcon />
                  <AlertTitle>The last sync failed</AlertTitle>
                  <AlertDescription className="break-words">
                    {overview.settings.templatesSyncError}
                  </AlertDescription>
                </Alert>
              ) : null}

              {templates && templates.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-72">
                    <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      placeholder="Search templates"
                      className="pl-8"
                      onChange={(change) => setSearch(change.target.value)}
                    />
                  </div>
                  <SelectField
                    aria-label="Status"
                    value={statusFilter}
                    onValueChange={setStatusFilter}
                    className="w-40"
                    options={[
                      { value: "approved", label: "Approved" },
                      { value: "other", label: "Pending or rejected" },
                      { value: "all", label: "All" },
                    ]}
                  />
                </div>
              ) : null}

              {templates === undefined ? (
                <CardGridSkeleton count={3} />
              ) : templates.length === 0 ? (
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <WhatsappLogoIcon />
                    </EmptyMedia>
                    <EmptyTitle>No templates here yet</EmptyTitle>
                    <EmptyDescription>
                      Sync to pull every template from the business account — approved,
                      pending and rejected.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button disabled={syncing} onClick={() => void sync()}>
                    {syncing ? <Spinner /> : <ArrowsClockwiseIcon />} Sync templates
                  </Button>
                </Empty>
              ) : filteredTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No template matches.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredTemplates.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => setTemplate(item)}
                      className="flex flex-col gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40"
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
                          {item.name}
                        </span>
                        <Badge variant={statusVariant(item.status)}>{item.status.toLowerCase()}</Badge>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        <Badge variant="outline">{item.language}</Badge>
                        <Badge variant="outline">{item.category.toLowerCase()}</Badge>
                        {item.slots.length ? (
                          <Badge variant="outline">
                            {item.slots.length} {item.slots.length === 1 ? "blank" : "blanks"}
                          </Badge>
                        ) : null}
                        {item.header && item.header.format !== "TEXT" ? (
                          <Badge variant="outline">{item.header.format.toLowerCase()} header</Badge>
                        ) : null}
                      </span>
                      {item.body ? (
                        <span className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
                          {item.body}
                        </span>
                      ) : null}
                      {item.unsupported ? (
                        <span className="text-xs text-destructive">{item.unsupported}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* --------------------------------------------------- email templates */}
        <TabsContent value="email" className="flex flex-col gap-4 pt-4">
          {overview && !overview.emailReady ? (
            <Alert>
              <EnvelopeSimpleIcon />
              <AlertTitle>Email sending is not available right now</AlertTitle>
              <AlertDescription>
                Emails can be written now and will send once it is back. Contact support.
              </AlertDescription>
            </Alert>
          ) : null}

          <div>
            <Button variant="outline" onClick={() => setEmail({ key: Date.now(), template: null })}>
              <PlusIcon /> New email
            </Button>
          </div>

          {emails === undefined ? (
            <CardGridSkeleton count={3} />
          ) : emails.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <EnvelopeSimpleIcon />
                </EmptyMedia>
                <EmptyTitle>No emails yet</EmptyTitle>
                <EmptyDescription>
                  Write the emails your alerts send — a booking confirmation, a new-lead notice
                  for the team — with variables filled from each event.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {emails.map((item) => (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => setEmail({ key: Date.now(), template: item })}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                    <Badge variant="outline">{item.format === "html" ? "HTML" : "text"}</Badge>
                  </span>
                  <span className="truncate text-sm">{item.subject}</span>
                  <span className="line-clamp-3 text-sm text-muted-foreground">
                    {item.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                  </span>
                  <span className="mt-auto text-xs text-muted-foreground">
                    Edited {ago(item.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- activity */}
        <TabsContent value="activity" className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Every alert, test and message sent by hand — and why, when one could not go.
            </p>
            <SelectField
              aria-label="Show"
              value={logFilter}
              onValueChange={setLogFilter}
              className="w-36"
              options={[
                { value: "all", label: "Everything" },
                { value: "sent", label: "Sent" },
                { value: "not_sent", label: "Not sent" },
              ]}
            />
          </div>

          {logs === undefined ? (
            <TableSkeleton rows={6} columns={5} />
          ) : filteredLogs.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PaperPlaneTiltIcon />
                </EmptyMedia>
                <EmptyTitle>{logs.length === 0 ? "Nothing sent yet" : "Nothing here"}</EmptyTitle>
                <EmptyDescription>
                  {logs.length === 0
                    ? "Sends show up here as alerts fire."
                    : "No send matches that filter."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead className="hidden md:table-cell">Alert</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((item) => (
                    <TableRow
                      key={item._id}
                      className="cursor-pointer"
                      onClick={() => setLog(item)}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {item.channel === "whatsapp" ? (
                            <WhatsappLogoIcon className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <EnvelopeSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{item.to || "Nobody"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {item.ruleName ?? (item.kind === "manual" ? "Sent by hand" : "Test")}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <span className="block truncate">
                          {item.templateName ?? item.subject ?? "—"}
                        </span>
                        <span
                          className={cn(
                            "block truncate text-xs",
                            item.error ? "text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {item.error ?? item.preview}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          <Badge variant={LOG_VARIANT[item.status]}>{item.status}</Badge>
                          {item.kind ? <Badge variant="outline">{item.kind}</Badge> : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground sm:table-cell">
                        {ago(item.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Mounted only while open, and keyed on each open, so every form
          starts from what it was opened on. */}
      {editing && overview ? (
        <RuleDialog
          key={editing.key}
          initial={editing.rule}
          presetTemplate={editing.template}
          overview={overview}
          templates={templates ?? []}
          emailTemplates={emails ?? []}
          rules={rules ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {sendersOpen && overview ? (
        <SendersDialog overview={overview} onClose={() => setSendersOpen(false)} />
      ) : null}
      {template ? (
        <TemplateDialog
          key={template._id}
          template={template}
          onClose={() => setTemplate(null)}
          onUse={() => {
            const chosen = template;
            setTemplate(null);
            openRule(null, chosen);
          }}
        />
      ) : null}
      {email ? (
        <EmailDialog
          key={email.key}
          template={email.template}
          emailReady={overview?.emailReady ?? false}
          onClose={() => setEmail(null)}
        />
      ) : null}
      {log ? <LogDialog log={log} onClose={() => setLog(null)} /> : null}
    </div>
  );
}

