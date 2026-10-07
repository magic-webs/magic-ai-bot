"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { NotificationEvent } from "@/convex/lib/notifications";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowsClockwiseIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  copyText,
  fail,
  templateKey,
  useFieldInsert,
  type EmailTemplate,
  type Overview,
  type Rule,
  type WhatsAppTemplate,
} from "./shared";

/**
 * Creating and editing one alert: when it fires, what it sends, and to whom.
 *
 * Every blank a WhatsApp template has is a field that takes plain words, a
 * `{{variable}}` from the event's payload, or both. The variables are listed
 * under the fields, and clicking one drops it at the cursor of whichever field
 * was focused last — the event payload is the workspace webhook's, and nobody
 * should have to remember that the customer's name is `record.person.name`.
 */

type Channel = "whatsapp" | "email";
type Variable = { path: string; label: string };

const RECIPIENT = "recipient";
const ANY = "any";

function uniqueVariables(lists: Variable[][]): Variable[] {
  const seen = new Set<string>();
  const out: Variable[] = [];
  for (const list of lists) {
    for (const variable of list) {
      if (seen.has(variable.path)) continue;
      seen.add(variable.path);
      out.push(variable);
    }
  }
  return out;
}

export function RuleDialog({
  initial,
  presetTemplate,
  overview,
  templates,
  emailTemplates,
  rules,
  onClose,
}: {
  initial: Rule | null;
  /** "Use in an alert" from a template opens here with it picked. */
  presetTemplate?: WhatsAppTemplate | null;
  overview: Overview;
  templates: WhatsAppTemplate[];
  emailTemplates: EmailTemplate[];
  /** The live list, so a just-created incoming webhook can show its URL. */
  rules: Rule[];
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const saveRule = useMutation(api.notifications.saveRule);
  const removeRule = useMutation(api.notifications.removeRule);
  const rotateKey = useMutation(api.notifications.rotateInboundKey);
  const captureSample = useMutation(api.notifications.captureInboundSample);
  const testRule = useAction(api.notificationsSend.testRule);
  const fields = useFieldInsert();

  const [ruleId, setRuleId] = useState<Id<"notificationRules"> | null>(
    initial?._id ?? null
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [event, setEvent] = useState<NotificationEvent>(initial?.event ?? "record_filed");
  const [bookId, setBookId] = useState<Id<"recordBooks"> | null>(initial?.bookId ?? null);
  const [stage, setStage] = useState<string | null>(initial?.stage ?? null);
  const [channel, setChannel] = useState<Channel>(
    initial?.channel ?? (overview.sender || presetTemplate ? "whatsapp" : "email")
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initial?.whatsappTemplateName && initial.whatsappLanguage
      ? `${initial.whatsappTemplateName}|${initial.whatsappLanguage}`
      : presetTemplate
        ? templateKey(presetTemplate)
        : null
  );
  const [emailTemplateId, setEmailTemplateId] = useState<Id<"emailTemplates"> | null>(
    initial?.emailTemplateId ?? null
  );
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.params ?? []).map((pair) => [pair.key, pair.value]))
  );
  const [recipients, setRecipients] = useState<string[]>(initial?.recipients ?? []);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [search, setSearch] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<
    "save" | "delete" | "test" | "rotate" | "capture" | null
  >(null);

  const info = overview.events.find((item) => item.value === event) ?? overview.events[0];
  const isRecord = info.source === "record";
  const book = overview.books.find((item) => item._id === bookId) ?? null;
  const saved = rules.find((rule) => rule._id === ruleId) ?? null;
  const template = templates.find((item) => templateKey(item) === selectedKey) ?? null;
  const email = emailTemplates.find((item) => item._id === emailTemplateId) ?? null;

  const variables = useMemo(() => {
    const details = isRecord
      ? book
        ? book.variables
        : uniqueVariables(overview.books.map((item) => item.variables))
      : [];
    const sample =
      event === "inbound"
        ? (saved?.samplePaths ?? []).map((path) => ({ path, label: path }))
        : [];
    return uniqueVariables([sample, details, info.variables]);
  }, [isRecord, book, overview.books, event, saved?.samplePaths, info.variables]);

  const pickable = useMemo(() => {
    const term = search.trim().toLowerCase();
    return templates
      .filter((item) => item.sendable || templateKey(item) === selectedKey)
      .filter((item) => !term || item.name.toLowerCase().includes(term));
  }, [templates, search, selectedKey]);

  const customer = channel === "whatsapp" ? info.customerPhone : info.customerEmail;
  const teammates = overview.team.filter((member) =>
    channel === "whatsapp" ? member.phone : member.email
  );

  // --------------------------------------------------------------- editing

  const pickEvent = (next: NotificationEvent) => {
    const nextInfo = overview.events.find((item) => item.value === next);
    setEvent(next);
    if (nextInfo?.source !== "record") {
      setBookId(null);
      setStage(null);
    }
    // "The customer" is a different field on every event — the record's
    // person, the order's customer, the escalated contact — so it follows the
    // event rather than keeping a path the new payload does not have.
    const from = channel === "whatsapp" ? info.customerPhone : info.customerEmail;
    const to = channel === "whatsapp" ? nextInfo?.customerPhone : nextInfo?.customerEmail;
    if (from && from !== to) {
      setRecipients((list) =>
        list.flatMap((entry) => (entry === from ? (to ? [to] : []) : [entry]))
      );
    }
  };

  const pickChannel = (next: Channel) => {
    if (next === channel) return;
    setChannel(next);
    // A list of numbers is not a list of email addresses.
    setRecipients([]);
    setRecipientDraft("");
  };

  const insert = (path: string) => {
    const token = `{{${path}}}`;
    if (fields.focused === RECIPIENT) {
      setRecipientDraft(fields.splice(RECIPIENT, recipientDraft, token));
      return;
    }
    if (channel === "email") {
      void copyText(token, token);
      return;
    }
    const slots = template?.slots ?? [];
    const target =
      (fields.focused && slots.some((slot) => slot.key === fields.focused)
        ? fields.focused
        : null) ??
      slots.find((slot) => !params[slot.key]?.trim())?.key ??
      null;
    if (!target) {
      toast.add({ title: "Click a blank first, then the variable to put in it." });
      return;
    }
    // Spliced out here rather than in the updater, which has to stay pure.
    const next = fields.splice(target, params[target] ?? "", token);
    setParams((current) => ({ ...current, [target]: next }));
    fields.setFocused(target);
  };

  const addRecipient = (value: string) => {
    const entry = value.trim();
    if (!entry) return;
    setRecipients((list) => (list.includes(entry) ? list : [...list, entry]));
    setRecipientDraft("");
  };

  const describe = (entry: string): string => {
    if (entry === customer) return "The customer";
    const member = overview.team.find(
      (item) => item.phone === entry || item.email === entry
    );
    return member ? `${member.name} · ${entry}` : entry;
  };

  // --------------------------------------------------------------- actions

  const save = async () => {
    setBusy("save");
    try {
      const pending = recipientDraft.trim();
      const list =
        pending && !recipients.includes(pending) ? [...recipients, pending] : recipients;
      const result = await saveRule({
        workspaceId: workspace._id,
        ruleId: ruleId ?? undefined,
        name,
        enabled,
        event,
        bookId: isRecord ? (bookId ?? undefined) : undefined,
        stage: isRecord && bookId ? (stage ?? undefined) : undefined,
        channel,
        whatsappTemplateName: channel === "whatsapp" ? template?.name : undefined,
        whatsappLanguage: channel === "whatsapp" ? template?.language : undefined,
        emailTemplateId: channel === "email" ? (emailTemplateId ?? undefined) : undefined,
        params:
          channel === "whatsapp" && template
            ? template.slots.map((slot) => ({ key: slot.key, value: params[slot.key] ?? "" }))
            : [],
        recipients: list,
      });
      setRecipients(list);
      setRecipientDraft("");
      toast.add({ title: `${name.trim()} saved`, type: "success" });
      // A new incoming webhook stays open: the URL it was just given is the
      // one thing the owner needs next.
      if (!ruleId && event === "inbound") {
        setRuleId(result.ruleId);
        return;
      }
      onClose();
    } catch (error) {
      fail("Could not save the alert", error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!ruleId) return;
    setBusy("delete");
    try {
      await removeRule({ ruleId });
      toast.add({ title: "Alert deleted", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not delete the alert", error);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!ruleId) return;
    setBusy("test");
    setTestResult(null);
    try {
      const result = await testRule({ ruleId, to: testTo });
      setTestResult(
        result.ok
          ? { ok: true, text: `Test sent to ${testTo.trim()}.` }
          : { ok: false, text: result.error ?? "The test did not send." }
      );
    } catch (error) {
      setTestResult({ ok: false, text: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const rotate = async () => {
    if (!ruleId) return;
    setBusy("rotate");
    try {
      await rotateKey({ ruleId });
      toast.add({
        title: "New URL issued",
        description: "The old one no longer works. Update the other system.",
        type: "success",
      });
    } catch (error) {
      fail("Could not issue a new URL", error);
    } finally {
      setBusy(null);
    }
  };

  const capture = async (on: boolean) => {
    if (!ruleId) return;
    setBusy("capture");
    try {
      await captureSample({ ruleId, capture: on });
    } catch (error) {
      fail("Could not capture a new sample", error);
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- render

  const bookOptions = [
    { value: ANY, label: "Any book" },
    ...overview.books.map((item) => ({ value: item._id as string, label: item.pluralName })),
  ];

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{ruleId ? "Edit alert" : "New alert"}</DialogTitle>
          <DialogDescription>
            Sends a WhatsApp template or an email when something happens, filled with the
            details of what happened.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                maxLength={60}
                placeholder="Booking confirmation"
                onChange={(change) => setName(change.target.value)}
              />
            </div>
            <label className="flex h-8 items-center gap-2.5 text-sm font-medium">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              {enabled ? "On" : "Off"}
            </label>
          </div>

          <Separator />

          {/* ------------------------------------------------------- when */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              When
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>Event</Label>
                <SelectField
                  aria-label="Event"
                  value={event}
                  onValueChange={(next) => pickEvent(next as NotificationEvent)}
                  options={overview.events.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                />
              </div>
              {isRecord ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Record book</Label>
                  <SelectField
                    aria-label="Record book"
                    value={bookId ?? ANY}
                    disabled={overview.books.length === 0}
                    onValueChange={(next) => {
                      setBookId(next === ANY ? null : (next as Id<"recordBooks">));
                      setStage(null);
                    }}
                    options={bookOptions}
                  />
                </div>
              ) : null}
              {isRecord && book && book.stages.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label>
                    {event === "record_stage_changed" ? "Moved to stage" : "At stage"}
                  </Label>
                  <SelectField
                    aria-label="Stage"
                    value={stage ?? ANY}
                    onValueChange={(next) => setStage(next === ANY ? null : next)}
                    options={[
                      { value: ANY, label: "Any stage" },
                      ...book.stages.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{info.hint}</p>

            {isRecord && overview.books.length === 0 ? (
              <Alert>
                <WarningCircleIcon />
                <AlertDescription>
                  This workspace has no record books yet.{" "}
                  <Link className="underline" href={`/w/${workspace.slug}/records`}>
                    Add one
                  </Link>{" "}
                  and its events can send alerts.
                </AlertDescription>
              </Alert>
            ) : null}
            {initial?.bookId && !initial.bookName && bookId === initial.bookId ? (
              <Alert variant="destructive">
                <WarningCircleIcon />
                <AlertDescription>
                  The book this alert listened to was deleted. Pick another.
                </AlertDescription>
              </Alert>
            ) : null}

            {event === "inbound" ? (
              saved?.inboundUrl ? (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    This alert’s URL
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">
                      {saved.inboundUrl}
                    </code>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Copy URL"
                      onClick={() => void copyText(saved.inboundUrl ?? "", "URL")}
                    >
                      <CopyIcon />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void rotate()}
                    >
                      {busy === "rotate" ? <Spinner /> : <ArrowsClockwiseIcon />} New URL
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Another system POSTs JSON or a form to this URL, and each call sends
                    this alert.
                    {saved.lastInboundAt
                      ? ` Last call ${formatDistanceToNow(saved.lastInboundAt, { addSuffix: true })}.`
                      : ""}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {saved.capturing ? (
                        <>
                          <Spinner /> Waiting for the next call — its fields replace the ones
                          under Variables.
                        </>
                      ) : saved.sampleAt ? (
                        `Fields captured ${formatDistanceToNow(saved.sampleAt, { addSuffix: true })} · ${saved.samplePaths.length} under Variables.`
                      ) : (
                        "No calls yet. Post a sample and its fields appear under Variables."
                      )}
                    </p>
                    {saved.capturing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void capture(false)}
                      >
                        {busy === "capture" ? <Spinner /> : <XIcon />} Cancel
                      </Button>
                    ) : saved.sampleAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void capture(true)}
                      >
                        {busy === "capture" ? <Spinner /> : <PlusIcon />} Capture new sample
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Save the alert to get its URL.
                </p>
              )
            ) : null}
          </section>

          <Separator />

          {/* ------------------------------------------------------- send */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Send
              </h3>
              <ToggleGroup
                value={[channel]}
                onValueChange={(value) => {
                  const next = value[0] as Channel | undefined;
                  if (next) pickChannel(next);
                }}
                className="rounded-lg border p-0.5"
              >
                <ToggleGroupItem value="whatsapp" aria-label="WhatsApp">
                  <WhatsappLogoIcon /> WhatsApp
                </ToggleGroupItem>
                <ToggleGroupItem value="email" aria-label="Email">
                  <EnvelopeSimpleIcon /> Email
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {channel === "whatsapp" ? (
              !overview.sender ? (
                <Alert variant="destructive">
                  <WarningCircleIcon />
                  <AlertDescription>
                    No live WhatsApp number.{" "}
                    <Link className="underline" href={`/w/${workspace.slug}/channels`}>
                      Connect one
                    </Link>{" "}
                    to send WhatsApp alerts.
                  </AlertDescription>
                </Alert>
              ) : templates.length === 0 ? (
                <Alert>
                  <WhatsappLogoIcon />
                  <AlertDescription>
                    No templates synced yet. Sync them on the WhatsApp templates tab, then
                    pick one here.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
                    <div className="flex flex-col gap-1.5">
                      <Label>Template</Label>
                      <SelectField
                        aria-label="WhatsApp template"
                        value={selectedKey ?? ""}
                        placeholder="Pick an approved template"
                        onValueChange={(next) => {
                          setSelectedKey(next || null);
                          fields.setFocused(null);
                        }}
                        options={pickable.map((item) => ({
                          value: templateKey(item),
                          label: `${item.name} · ${item.language}${item.sendable ? "" : ` (${item.status.toLowerCase()})`}`,
                        }))}
                      />
                    </div>
                    {templates.length > 10 ? (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="template-search">Search</Label>
                        <Input
                          id="template-search"
                          value={search}
                          placeholder="Filter by name"
                          onChange={(change) => setSearch(change.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only approved templates reach someone who has not written in the last 24
                    hours — which is nearly everyone an alert goes to.
                  </p>

                  {selectedKey && !template ? (
                    <Alert variant="destructive">
                      <WarningCircleIcon />
                      <AlertDescription>
                        The template this alert sent is no longer on the panel. Pick another,
                        or sync again.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {template && !template.sendable ? (
                    <Alert variant="destructive">
                      <WarningCircleIcon />
                      <AlertDescription>
                        {template.unsupported ??
                          `“${template.name}” is ${template.status.toLowerCase()} and will not send until Meta approves it.`}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {template ? (
                    <>
                      {template.body ? (
                        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                          {template.header?.format === "TEXT" && template.header.text ? (
                            <p className="mb-1.5 font-medium">{template.header.text}</p>
                          ) : null}
                          {template.body}
                          {template.footer ? (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              {template.footer}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {template.slots.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          This template has no blanks to fill.
                        </p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {template.slots.map((slot) => (
                            <div key={slot.key} className="flex flex-col gap-1.5">
                              <Label htmlFor={`slot-${slot.key}`} className="font-mono">
                                {slot.label}
                              </Label>
                              <Input
                                id={`slot-${slot.key}`}
                                {...fields.bind(slot.key)}
                                value={params[slot.key] ?? ""}
                                placeholder={
                                  slot.example ? `e.g. ${slot.example}` : "Text or {{variable}}"
                                }
                                onChange={(change) =>
                                  setParams((current) => ({
                                    ...current,
                                    [slot.key]: change.target.value,
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )
            ) : !overview.emailReady ? (
              <Alert variant="destructive">
                <WarningCircleIcon />
                <AlertDescription>
                  Email sending is not available right now. Contact support.
                </AlertDescription>
              </Alert>
            ) : emailTemplates.length === 0 ? (
              <Alert>
                <EnvelopeSimpleIcon />
                <AlertDescription>
                  Write an email on the Email templates tab first, then pick it here.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <SelectField
                  aria-label="Email template"
                  value={emailTemplateId ?? ""}
                  placeholder="Pick an email"
                  onValueChange={(next) =>
                    setEmailTemplateId(next ? (next as Id<"emailTemplates">) : null)
                  }
                  options={emailTemplates.map((item) => ({
                    value: item._id as string,
                    label: item.name,
                  }))}
                />
                {email ? (
                  <p className="text-xs text-muted-foreground">
                    Subject: {email.subject}
                    {email.variables.length
                      ? ` · uses ${email.variables.map((path) => `{{${path}}}`).join(", ")}`
                      : ""}
                  </p>
                ) : null}
              </div>
            )}

            {variables.length > 0 && (channel === "email" || template) ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">
                  {channel === "whatsapp"
                    ? "Variables — click a blank, then a variable to drop it in at the cursor."
                    : "Variables — click one to copy it for the email template."}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map((variable) => (
                    <Button
                      key={variable.path}
                      size="xs"
                      variant="outline"
                      className="border-dashed"
                      title={`{{${variable.path}}}`}
                      // Keeps the field's focus and selection intact.
                      onMouseDown={(press) => press.preventDefault()}
                      onClick={() => insert(variable.path)}
                    >
                      {variable.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <Separator />

          {/* --------------------------------------------------------- to */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              To
            </h3>
            {recipients.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {recipients.map((entry) => (
                  <li
                    key={entry}
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2"
                  >
                    {channel === "whatsapp" ? (
                      <WhatsappLogoIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <EnvelopeSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{describe(entry)}</span>
                    {entry === customer ? (
                      <code className="hidden truncate font-mono text-xs text-muted-foreground md:block">
                        {entry}
                      </code>
                    ) : null}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${describe(entry)}`}
                      onClick={() =>
                        setRecipients((list) => list.filter((item) => item !== entry))
                      }
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody yet.</p>
            )}

            {(customer && !recipients.includes(customer)) || teammates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {customer && !recipients.includes(customer) ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="border-dashed"
                    onClick={() => addRecipient(customer)}
                  >
                    <UserIcon /> The customer
                  </Button>
                ) : null}
                {teammates.map((member) => {
                  const address = (channel === "whatsapp" ? member.phone : member.email) ?? "";
                  return recipients.includes(address) ? null : (
                    <Button
                      key={member._id}
                      size="xs"
                      variant="outline"
                      className="border-dashed"
                      onClick={() => addRecipient(address)}
                    >
                      <UsersIcon /> {member.name}
                    </Button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Input
                {...fields.bind(RECIPIENT)}
                value={recipientDraft}
                placeholder={
                  channel === "whatsapp"
                    ? "+91 98765 43210, or a {{variable}}"
                    : "name@company.com, or a {{variable}}"
                }
                onChange={(change) => setRecipientDraft(change.target.value)}
                onKeyDown={(press) => {
                  if (press.key === "Enter") {
                    press.preventDefault();
                    addRecipient(recipientDraft);
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={!recipientDraft.trim()}
                onClick={() => addRecipient(recipientDraft)}
              >
                <PlusIcon /> Add
              </Button>
            </div>
            {channel === "whatsapp" ? (
              <p className="text-xs text-muted-foreground">
                A number without a country code gets the default one from Senders.
              </p>
            ) : null}
          </section>

          {ruleId ? (
            <>
              <Separator />
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Send a test
                </h3>
                <p className="text-xs text-muted-foreground">
                  Sends the saved alert with made-up details
                  {event === "inbound" && saved?.sampleAt
                    ? " — the sample its URL captured —"
                    : ""}{" "}
                  to one {channel === "whatsapp" ? "number" : "address"}. Save first to test a
                  change.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={testTo}
                    placeholder={channel === "whatsapp" ? "Your number" : "Your email"}
                    onChange={(change) => setTestTo(change.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={busy !== null || !testTo.trim()}
                    onClick={() => void test()}
                  >
                    {busy === "test" ? <Spinner /> : <PaperPlaneTiltIcon />} Send test
                  </Button>
                </div>
                {testResult ? (
                  <p
                    className={
                      testResult.ok
                        ? "text-sm text-primary"
                        : "text-sm break-words text-destructive"
                    }
                  >
                    {testResult.text}
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {ruleId ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void remove()}>
              {busy === "delete" ? <Spinner /> : <TrashIcon />} Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {saved ? (
              <Badge variant="outline" className="hidden sm:inline-flex">
                {saved.sentCount} sent
              </Badge>
            ) : null}
            <Button disabled={busy !== null || !name.trim()} onClick={() => void save()}>
              {busy === "save" ? <Spinner /> : null}
              {ruleId ? "Save changes" : "Create alert"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
