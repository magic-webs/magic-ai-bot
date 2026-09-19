"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { RECORD_EVENTS, recordToolNames } from "@/convex/lib/records";
import type { RecordEvent } from "@/convex/lib/records";
import {
  FieldListEditor,
  type CollectedField,
} from "@/components/field-list-editor";
import { StringListEditor, KeyValueEditor } from "@/components/editors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components/select-field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { TableSkeleton } from "@/components/skeletons";
import {
  ArrowLeftIcon,
  BroadcastIcon,
  EyeIcon,
  FolderOpenIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";

type Book = Doc<"recordBooks">;

type BookDraft = {
  name: string;
  pluralName: string;
  purpose: string;
  referencePrefix: string;
  fields: CollectedField[];
  stages: string[];
  allowLookup: boolean;
  allowUpdate: boolean;
};
type RecordRow = Doc<"records"> & { filedBy: string | null };

function detailsOf(row: Doc<"records">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of row.values) out[pair.key] = pair.value;
  return out;
}

function personLine(row: Doc<"records">): string {
  const person = row.person;
  if (!person) return "—";
  return person.name || person.phone || person.email || person.company || "—";
}

// ---------------------------------------------------------------------------
// One filed record
// ---------------------------------------------------------------------------

function RecordDetail({ book, row }: { book: Book; row: RecordRow }) {
  const updateRecord = useMutation(api.records.updateRecord);
  const [stage, setStage] = useState(row.stage ?? "");
  const details = detailsOf(row);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label={`View ${row.reference}`}
          >
            <EyeIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{row.reference}</DialogTitle>
          <DialogDescription>
            {row.source === "manual"
              ? "Added by your team"
              : `Collected by ${row.filedBy ?? "an agent"} on ${row.source}`}{" "}
            · {new Date(row.createdAt).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {row.person ? (
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">About</Label>
              <p className="text-sm">
                {[
                  row.person.name,
                  row.person.phone,
                  row.person.email,
                  row.person.company,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Details</Label>
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1.5 text-sm">
              {/* The book's own order first, so two records read the same way
                  down the page even when one was filed before a field existed. */}
              {book.fields.map((field) =>
                details[field.key] === undefined ? null : (
                  <div key={field.key} className="contents">
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd>{details[field.key]}</dd>
                  </div>
                )
              )}
              {row.values
                .filter(
                  (pair) => !book.fields.some((field) => field.key === pair.key)
                )
                .map((pair) => (
                  <div key={pair.key} className="contents">
                    <dt className="text-muted-foreground">
                      {pair.key}
                      <Badge variant="outline" className="ml-1.5 text-[10px]">
                        extra
                      </Badge>
                    </dt>
                    <dd>{pair.value}</dd>
                  </div>
                ))}
            </dl>
          </div>

          {row.notes ? (
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <p className="whitespace-pre-wrap text-sm">{row.notes}</p>
            </div>
          ) : null}

          {book.stages.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="record-stage">Stage</Label>
              <div className="flex gap-2">
                <SelectField
                  id="record-stage"
                  className="flex-1"
                  value={stage}
                  onValueChange={setStage}
                  options={book.stages.map((name) => ({
                    value: name,
                    label: name,
                  }))}
                />
                <Button
                  variant="outline"
                  disabled={stage === (row.stage ?? "")}
                  onClick={async () => {
                    try {
                      await updateRecord({ recordId: row._id, stage });
                      toast.add({
                        title: `Moved to ${stage}.`,
                        type: "success",
                      });
                    } catch (error) {
                      toast.add({
                        title:
                          error instanceof Error ? error.message : "Failed.",
                        type: "error",
                      });
                    }
                  }}
                >
                  Move
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Moving it fires the <code>record_stage_changed</code> event.
              </p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Adding one by hand
// ---------------------------------------------------------------------------

function AddRecordDialog({ book }: { book: Book }) {
  const createRecord = useMutation(api.records.createRecord);
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState({ name: "", phone: "", email: "" });
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await createRecord({
        bookId: book._id,
        person:
          person.name || person.phone || person.email
            ? {
                name: person.name || undefined,
                phone: person.phone || undefined,
                email: person.email || undefined,
              }
            : undefined,
        values: Object.entries(values)
          .filter(([, value]) => value.trim())
          .map(([key, value]) => ({ key, value: value.trim() })),
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      setPerson({ name: "", phone: "", email: "" });
      setValues({});
      setNotes("");
      toast.add({ title: `${book.name} added.`, type: "success" });
    } catch (error) {
      toast.add({
        title: error instanceof Error ? error.message : "Could not add it.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <PlusIcon /> Add {book.name.toLowerCase()}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a {book.name.toLowerCase()}</DialogTitle>
          <DialogDescription>
            For one that came in by phone or in person. It gets a reference and
            fires the same events as one an agent files.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="Name"
              value={person.name}
              onChange={(event) =>
                setPerson((prev) => ({ ...prev, name: event.target.value }))
              }
            />
            <Input
              placeholder="Phone"
              value={person.phone}
              onChange={(event) =>
                setPerson((prev) => ({ ...prev, phone: event.target.value }))
              }
            />
            <Input
              placeholder="Email"
              value={person.email}
              onChange={(event) =>
                setPerson((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </div>

          <Separator />

          {book.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`f-${field.key}`}>
                {field.label}
                {field.required ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </Label>
              {field.type === "select" && field.options?.length ? (
                <SelectField
                  id={`f-${field.key}`}
                  value={values[field.key] ?? ""}
                  onValueChange={(next) =>
                    setValues((prev) => ({ ...prev, [field.key]: next }))
                  }
                  options={field.options.map((option) => ({
                    value: option,
                    label: option,
                  }))}
                  placeholder="Choose…"
                />
              ) : (
                <Input
                  id={`f-${field.key}`}
                  type={field.type === "date" ? "date" : "text"}
                  value={values[field.key] ?? ""}
                  placeholder={field.example}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              )}
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="record-notes">Notes</Label>
            <Textarea
              id="record-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Where the events go
// ---------------------------------------------------------------------------

type HookForm = {
  name: string;
  url: string;
  secret: string;
  events: RecordEvent[];
  headers: Array<{ key: string; value: string }>;
};

const BLANK_HOOK: HookForm = {
  name: "",
  url: "",
  secret: "",
  events: ["filed"],
  headers: [],
};

function WebhookDialog({
  book,
  existing,
  trigger,
}: {
  book: Book;
  existing?: Doc<"recordWebhooks">;
  trigger: React.ReactElement;
}) {
  const createWebhook = useMutation(api.records.createWebhook);
  const updateWebhook = useMutation(api.records.updateWebhook);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HookForm>(
    existing
      ? {
          name: existing.name,
          url: existing.url,
          secret: existing.secret ?? "",
          events: existing.events,
          headers: existing.headers,
        }
      : BLANK_HOOK
  );
  const [saving, setSaving] = useState(false);

  const toggleEvent = (event: RecordEvent) =>
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((current) => current !== event)
        : [...prev.events, event],
    }));

  const save = async () => {
    setSaving(true);
    try {
      if (existing) {
        await updateWebhook({
          webhookId: existing._id,
          name: form.name,
          url: form.url,
          secret: form.secret,
          events: form.events,
          headers: form.headers,
        });
      } else {
        await createWebhook({
          bookId: book._id,
          name: form.name,
          url: form.url,
          secret: form.secret || undefined,
          events: form.events,
          headers: form.headers,
        });
        setForm(BLANK_HOOK);
      }
      setOpen(false);
      toast.add({
        title: existing ? "Saved." : "Destination added.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: error instanceof Error ? error.message : "Could not save.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit destination" : "Send these somewhere"}
          </DialogTitle>
          <DialogDescription>
            Every {book.name.toLowerCase()} event is POSTed as JSON to this
            address.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hook-name">Name</Label>
            <Input
              id="hook-name"
              value={form.name}
              placeholder="Zapier, Ops Slack, membership system…"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hook-url">Address</Label>
            <Input
              id="hook-url"
              value={form.url}
              placeholder="https://hooks.zapier.com/…"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, url: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Send when</Label>
            {RECORD_EVENTS.map((event) => (
              <label
                key={event.value}
                className="flex items-start gap-3 rounded-md border border-border p-2"
              >
                <Switch
                  size="sm"
                  className="mt-0.5"
                  checked={form.events.includes(event.value)}
                  onCheckedChange={() => toggleEvent(event.value)}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{event.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {event.hint} Arrives as <code>record_{event.value}</code>.
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hook-secret">Signing secret</Label>
            <Input
              id="hook-secret"
              value={form.secret}
              placeholder="Optional"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, secret: event.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              With one set, each delivery carries an{" "}
              <code>X-Magic-Signature: sha256=…</code> header — an HMAC of the
              body. Check it at the other end and nobody can forge a{" "}
              {book.name.toLowerCase()}.
            </p>
          </div>

          <KeyValueEditor
            label="Extra headers"
            description="For an endpoint that wants an API key or a bearer token."
            value={form.headers}
            onChange={(next) => setForm((prev) => ({ ...prev, headers: next }))}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !form.url.trim()}
            onClick={() => void save()}
          >
            {existing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhooksTab({ book }: { book: Book }) {
  const hooks = useQuery(api.records.listWebhooks, { bookId: book._id });
  const deliveries = useQuery(api.records.listDeliveries, {
    bookId: book._id,
    limit: 25,
  });
  const updateWebhook = useMutation(api.records.updateWebhook);
  const removeWebhook = useMutation(api.records.removeWebhook);
  const sendTest = useAction(api.records.sendTestWebhook);
  const [testing, setTesting] = useState<Id<"recordWebhooks"> | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Destinations</CardTitle>
              <CardDescription>
                Where {book.pluralName.toLowerCase()} go as they happen. Your
                workspace webhook on the settings page already receives every
                one of these — these are additional places to send them.
              </CardDescription>
            </div>
            <WebhookDialog
              book={book}
              trigger={
                <Button variant="outline">
                  <PlusIcon /> Add destination
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardContent>
          {hooks === undefined ? (
            <Spinner />
          ) : hooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing subscribed yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {hooks.map((hook) => (
                <div
                  key={hook._id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{hook.name}</span>
                      {hook.events.map((event) => (
                        <Badge key={event} variant="outline">
                          {event.replace("_", " ")}
                        </Badge>
                      ))}
                      {hook.secret ? (
                        <Badge variant="secondary">signed</Badge>
                      ) : null}
                    </div>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {hook.url}
                    </span>
                    {hook.lastStatus ? (
                      <span
                        className={
                          hook.lastStatus === "sent"
                            ? "text-xs text-muted-foreground"
                            : "text-xs text-destructive"
                        }
                      >
                        Last delivery{" "}
                        {hook.lastDeliveredAt
                          ? new Date(hook.lastDeliveredAt).toLocaleString()
                          : ""}
                        : {hook.lastStatus}
                        {hook.lastResponseStatus
                          ? ` (${hook.lastResponseStatus})`
                          : ""}
                        {hook.lastError ? ` — ${hook.lastError}` : ""}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Switch
                      checked={hook.enabled}
                      aria-label={`${hook.name} enabled`}
                      onCheckedChange={(checked) =>
                        void updateWebhook({
                          webhookId: hook._id,
                          enabled: checked,
                        })
                      }
                    />
                    <Button
                      size="icon-lg"
                      variant="ghost"
                      aria-label="Send test"
                      disabled={testing === hook._id}
                      onClick={async () => {
                        setTesting(hook._id);
                        try {
                          const result = await sendTest({
                            webhookId: hook._id,
                          });
                          if (result.success)
                            toast.add({
                              title: "Test delivered.",
                              type: "success",
                            });
                          else
                            toast.add({
                              title:
                                result.error ?? "The endpoint rejected it.",
                              type: "error",
                            });
                        } catch (error) {
                          toast.add({
                            title:
                              error instanceof Error
                                ? error.message
                                : "Failed.",
                            type: "error",
                          });
                        } finally {
                          setTesting(null);
                        }
                      }}
                    >
                      {testing === hook._id ? (
                        <Spinner />
                      ) : (
                        <PaperPlaneTiltIcon />
                      )}
                    </Button>
                    <WebhookDialog
                      book={book}
                      existing={hook}
                      trigger={
                        <Button size="sm" variant="ghost">
                          Edit
                        </Button>
                      }
                    />
                    <Button
                      size="icon-lg"
                      variant="ghost"
                      aria-label={`Remove ${hook.name}`}
                      onClick={() =>
                        void removeWebhook({ webhookId: hook._id })
                      }
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent deliveries</CardTitle>
          <CardDescription>
            Every attempt for this record, newest first — including the ones
            that went to your workspace webhook.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries === undefined ? (
            <Spinner />
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing sent yet. File one, or send a test above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery._id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(delivery.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {delivery.event}
                    </TableCell>
                    <TableCell>{delivery.destination ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          delivery.status === "sent"
                            ? "secondary"
                            : delivery.status === "skipped"
                              ? "outline"
                              : "destructive"
                        }
                      >
                        {delivery.status}
                        {delivery.responseStatus
                          ? ` ${delivery.responseStatus}`
                          : ""}
                      </Badge>
                      {delivery.error ? (
                        <p className="mt-0.5 max-w-sm truncate text-xs text-muted-foreground">
                          {delivery.error}
                        </p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function RecordBookPage({
  params,
}: {
  params: Promise<{ slug: string; bookId: string }>;
}) {
  const { slug, bookId } = use(params);
  const router = useRouter();
  const base = `/w/${slug}`;

  const data = useQuery(api.records.getBook, {
    bookId: bookId as Id<"recordBooks">,
  });
  const updateBook = useMutation(api.records.updateBook);
  const removeBook = useMutation(api.records.removeBook);

  const [stageFilter, setStageFilter] = useState("");
  const [search, setSearch] = useState("");
  const rows = useQuery(api.records.listRecords, {
    bookId: bookId as Id<"recordBooks">,
    stage: stageFilter || undefined,
    search: search.trim() || undefined,
  });

  const book = data?.book;

  const [draft, setDraft] = useState<BookDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);

  // Seed the editable draft from the server document, and re-seed if a
  // different record is opened. Adjusting state during render rather than in an
  // effect is the supported pattern: React discards this render pass and
  // immediately re-runs it, so nothing extra is committed.
  if (book && draftFor !== book._id) {
    setDraftFor(book._id);
    setDraft({
      name: book.name,
      pluralName: book.pluralName,
      purpose: book.purpose,
      referencePrefix: book.referencePrefix,
      fields: book.fields as CollectedField[],
      stages: book.stages,
      allowLookup: book.allowLookup,
      allowUpdate: book.allowUpdate,
    });
  }

  const tools = book ? recordToolNames(book.handle) : null;

  if (data === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner />
      </div>
    );
  }
  if (!book || !draft || !tools) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          That record no longer exists.
        </p>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`${base}/records`} />}
        >
          Back to records
        </Button>
      </div>
    );
  }

  const save = async (patch: Parameters<typeof updateBook>[0]) => {
    try {
      await updateBook(patch);
      toast.add({ title: "Saved.", type: "success" });
    } catch (error) {
      toast.add({
        title: error instanceof Error ? error.message : "Could not save.",
        type: "error",
      });
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
          nativeButton={false}
          render={<Link href={`${base}/records`} />}
        >
          <ArrowLeftIcon /> Records
        </Button>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {book.pluralName}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {book.purpose || `Records of type “${book.name}”.`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* The one switch that decides whether any of this is live. A draft
                book is handed to no agent however many are toggled on for it. */}
            <div className="flex items-center gap-2">
              <Switch
                checked={book.status === "active"}
                aria-label="Collecting"
                onCheckedChange={(checked) =>
                  void save({
                    bookId: book._id,
                    status: checked ? "active" : "draft",
                  })
                }
              />
              <span className="text-sm">
                {book.status === "active" ? "Collecting" : "Paused"}
              </span>
            </div>
            <AddRecordDialog book={book} />
          </div>
        </div>

        {data.filedBy.length === 0 && book.status === "active" ? (
          <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No agent files into this yet, so nothing will be collected. Switch
            it on under <strong>Knowledge &amp; tools</strong> on the{" "}
            <Link
              href={`${base}/agents`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              agent
            </Link>{" "}
            that should be taking these details.
          </div>
        ) : data.filedBy.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Filed by
            {data.filedBy.map((agent) => (
              <Badge key={agent._id} variant="outline">
                {agent.botName}
                {agent.status !== "active" ? ` (${agent.status})` : ""}
              </Badge>
            ))}
          </div>
        ) : null}
      </header>

      <Separator />

      <Tabs defaultValue="filed">
        <TabsList>
          <TabsTrigger value="filed">Filed</TabsTrigger>
          <TabsTrigger value="setup">What to collect</TabsTrigger>
          <TabsTrigger value="webhooks">
            <BroadcastIcon className="size-4" /> Send elsewhere
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="filed" className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              value={search}
              placeholder="Search by name, phone, reference…"
              onChange={(event) => setSearch(event.target.value)}
            />
            {book.stages.length > 0 ? (
              <SelectField
                className="w-48"
                aria-label="Stage"
                value={stageFilter}
                onValueChange={(next) =>
                  setStageFilter(next === "__all" ? "" : next)
                }
                options={[
                  { value: "__all", label: "Every stage" },
                  ...book.stages.map((name) => ({ value: name, label: name })),
                ]}
                placeholder="Every stage"
              />
            ) : null}
          </div>

          {rows === undefined ? (
            <TableSkeleton rows={5} />
          ) : rows.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderOpenIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {search || stageFilter
                    ? "Nothing matched"
                    : `No ${book.pluralName.toLowerCase()} yet`}
                </EmptyTitle>
                <EmptyDescription>
                  {search || stageFilter
                    ? "Try a different search, or clear the stage filter."
                    : `They will appear here as your agents file them, and you can add one by hand from the button above.`}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>About</TableHead>
                  {book.fields.slice(0, 2).map((field) => (
                    <TableHead key={field.key} className="hidden lg:table-cell">
                      {field.label}
                    </TableHead>
                  ))}
                  {book.stages.length > 0 ? <TableHead>Stage</TableHead> : null}
                  <TableHead className="hidden sm:table-cell">Filed</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const details = detailsOf(row);
                  return (
                    <TableRow key={row._id}>
                      <TableCell className="font-mono text-xs">
                        {row.reference}
                      </TableCell>
                      <TableCell>{personLine(row)}</TableCell>
                      {book.fields.slice(0, 2).map((field) => (
                        <TableCell
                          key={field.key}
                          className="hidden max-w-48 truncate lg:table-cell"
                        >
                          {details[field.key] ?? "—"}
                        </TableCell>
                      ))}
                      {book.stages.length > 0 ? (
                        <TableCell>
                          {row.stage ? (
                            <Badge variant="outline">{row.stage}</Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <RecordDetail book={book} row={row} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="setup" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>What this is</CardTitle>
              <CardDescription>
                The name and the purpose are read by the model — they are what
                decide when it reaches for the tool.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="b-name">Name</Label>
                  <Input
                    id="b-name"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="b-plural">Plural</Label>
                  <Input
                    id="b-plural"
                    value={draft.pluralName}
                    onChange={(event) =>
                      setDraft({ ...draft, pluralName: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="b-prefix">Reference prefix</Label>
                  <Input
                    id="b-prefix"
                    className="font-mono"
                    value={draft.referencePrefix}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        referencePrefix: event.target.value.toUpperCase(),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    References read {draft.referencePrefix || "REC"}-H4K82Q.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="b-purpose">
                  When should an agent file one?
                </Label>
                <Textarea
                  id="b-purpose"
                  rows={2}
                  value={draft.purpose}
                  onChange={(event) =>
                    setDraft({ ...draft, purpose: event.target.value })
                  }
                />
              </div>

              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">
                  What your agents get called
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
                  <li>
                    <code>{tools.file}</code> — records a new one
                  </li>
                  {draft.allowLookup ? (
                    <li>
                      <code>{tools.find}</code> — finds an existing one
                    </li>
                  ) : null}
                  {draft.allowUpdate ? (
                    <li>
                      <code>{tools.update}</code> — changes one
                    </li>
                  ) : null}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  These names are fixed once the record is created, so renaming
                  it above will not break an agent whose job description
                  mentions them.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">
                      Agents can look these up
                    </span>
                    <span className="text-xs text-muted-foreground">
                      So a customer can ask “when is my appointment?” and get an
                      answer instead of a second booking.
                    </span>
                  </span>
                  <Switch
                    checked={draft.allowLookup}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, allowLookup: checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">
                      Agents can change these
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Rescheduling and cancelling. Off means every change goes
                      through your team.
                    </span>
                  </span>
                  <Switch
                    checked={draft.allowUpdate}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, allowUpdate: checked })
                    }
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <FieldListEditor
                label="Details to collect"
                description={
                  <>
                    Every required one has to be answered before{" "}
                    <code>{tools.file}</code> will save anything — the agent is
                    told to go back and ask rather than invent.
                  </>
                }
                addLabel="Add detail"
                labelPlaceholder="Label — e.g. Preferred date"
                examplePlaceholder="Example answer — helps the agent phrase the question"
                value={draft.fields}
                onChange={(next) => setDraft({ ...draft, fields: next })}
              />

              <Separator />

              <StringListEditor
                label="Stages"
                description="What one of these moves through after it is filed. The first is where a new one starts. Leave empty if it is simply a thing that happened."
                placeholder="Requested"
                value={draft.stages}
                onChange={(next) => setDraft({ ...draft, stages: next })}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="ghost" className="text-destructive">
                    <TrashIcon /> Delete this record type
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {book.pluralName.toLowerCase()}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Every {book.name.toLowerCase()} filed so far goes with it,
                    along with its destinations and delivery history. Agents
                    lose the <code>{tools.file}</code> tool. This cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await removeBook({ bookId: book._id });
                        toast.add({ title: "Deleted.", type: "success" });
                        router.push(`${base}/records`);
                      } catch (error) {
                        toast.add({
                          title:
                            error instanceof Error ? error.message : "Failed.",
                          type: "error",
                        });
                      }
                    }}
                  >
                    Delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              size="lg"
              onClick={() =>
                void save({
                  bookId: book._id,
                  name: draft.name,
                  pluralName: draft.pluralName,
                  purpose: draft.purpose,
                  referencePrefix: draft.referencePrefix,
                  fields: draft.fields.filter((field) => field.key.trim()),
                  stages: draft.stages,
                  allowLookup: draft.allowLookup,
                  allowUpdate: draft.allowUpdate,
                })
              }
            >
              Save changes
            </Button>
          </div>
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="webhooks">
          <WebhooksTab book={book} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
