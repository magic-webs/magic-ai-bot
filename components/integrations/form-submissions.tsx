"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  BookOpenIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  EyeIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

/**
 * Magic Forms submissions, on the Magic Forms panel of the integrations page.
 *
 * Each form is a row: how many answers have come in, a way to read them, and a
 * switch to keep them in a record book. The submissions themselves open in a
 * dialog rather than the panel, because a form's answers need more width than
 * a side panel has.
 *
 * Opening the panel pulls the latest submissions from Magic Forms once, so a
 * form filled in before it was connected is counted and listed too.
 */

type FormRow = NonNullable<
  FunctionReturnType<typeof api.formSubmissions.forms>
>["forms"][number];
type SubmissionRow = FunctionReturnType<
  typeof api.formSubmissions.list
>["page"][number];

const PAGE = 25;

const fail = (title: string, error: unknown) =>
  toast.add({
    title,
    description: friendlyError(error),
    type: "error",
  });

const ago = (timestamp: number) =>
  formatDistanceToNow(timestamp, { addSuffix: true });

function countLabel(form: FormRow): string {
  if (form.count === 0) return "No submissions yet";
  const count = `${form.count}${form.countCapped ? "+" : ""}`;
  return `${count} submission${form.count === 1 && !form.countCapped ? "" : "s"}`;
}

export function FormSubmissions({ base }: { base: string }) {
  const workspace = useWorkspace();
  const data = useQuery(api.formSubmissions.forms, {
    workspaceId: workspace._id,
  });
  const sync = useAction(api.formSubmissions.sync);

  // Browsing: null is closed, a key of "" is every form.
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [saving, setSaving] = useState<FormRow | null>(null);
  const [stopping, setStopping] = useState<FormRow | null>(null);

  const [syncState, setSyncState] = useState<
    { status: "running" } | { status: "done" } | { status: "failed"; error: string }
  >({ status: "running" });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sync({ workspaceId: workspace._id })
      .then(() => setSyncState({ status: "done" }))
      .catch((error: unknown) =>
        setSyncState({
          status: "failed",
          error: friendlyError(error),
        })
      );
  }, [sync, workspace._id]);

  if (!data) return null;
  const forms = data.forms;

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            Submissions
            {syncState.status === "running" ? <Spinner className="size-3.5" /> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            Read what came in, and keep a form&apos;s answers in a record book.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setBrowsing("")}
          disabled={forms.length === 0}
        >
          View all
        </Button>
      </div>

      {syncState.status === "failed" ? (
        <p className="text-xs text-destructive">
          Could not read older submissions from Magic Forms: {syncState.error}
        </p>
      ) : null}

      {forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No published forms. Publish one in Magic Forms, then refresh forms.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {forms.map((form) => (
            <div key={form.key} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{form.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {countLabel(form)}
                  {form.lastAt ? ` · last ${ago(form.lastAt)}` : ""}
                </p>
                {form.book ? (
                  <Link
                    href={`${base}/records/${form.book._id}`}
                    className="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    <BookOpenIcon className="size-3.5 shrink-0" />
                    <span className="truncate">
                      Saving to {form.book.pluralName}
                      {form.book.status !== "active" ? " (paused)" : ""}
                    </span>
                  </Link>
                ) : null}
              </div>

              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`View ${form.title} submissions`}
                onClick={() => setBrowsing(form.key)}
              >
                <EyeIcon />
              </Button>

              {form.book ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Record book for ${form.title}`}
                      />
                    }
                  >
                    <DotsThreeIcon weight="bold" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={<Link href={`${base}/records/${form.book._id}`} />}
                    >
                      Open record book
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setStopping(form)}>
                      Stop saving
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setSaving(form)}>
                  Save to book
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {browsing !== null ? (
        <SubmissionsDialog
          base={base}
          forms={forms}
          formKey={browsing}
          onFormKey={setBrowsing}
          onClose={() => setBrowsing(null)}
          onSave={(form) => setSaving(form)}
        />
      ) : null}

      {saving ? (
        <SaveToBookDialog
          key={saving.key}
          form={saving}
          onClose={() => setSaving(null)}
        />
      ) : null}

      <StopSavingDialog form={stopping} onClose={() => setStopping(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reading submissions
// ---------------------------------------------------------------------------

function SubmissionsDialog({
  base,
  forms,
  formKey,
  onFormKey,
  onClose,
  onSave,
}: {
  base: string;
  forms: FormRow[];
  /** "" for every form. */
  formKey: string;
  onFormKey: (key: string) => void;
  onClose: () => void;
  onSave: (form: FormRow) => void;
}) {
  const workspace = useWorkspace();
  const { results, status, loadMore } = usePaginatedQuery(
    api.formSubmissions.list,
    { workspaceId: workspace._id, formKey: formKey || undefined },
    { initialNumItems: PAGE }
  );
  const sync = useAction(api.formSubmissions.sync);
  const [syncing, setSyncing] = useState(false);
  const [openId, setOpenId] = useState<Id<"formSubmissions"> | null>(null);
  const open = results.find((row) => row._id === openId) ?? null;

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await sync({
        workspaceId: workspace._id,
        formKey: formKey || undefined,
      });
      toast.add({
        title:
          result.added === 0
            ? "Up to date"
            : `${result.added} new submission${result.added === 1 ? "" : "s"}`,
        type: "success",
      });
    } catch (error) {
      fail("Could not sync", error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{open ? open.formTitle : "Form submissions"}</DialogTitle>
          <DialogDescription>
            {open
              ? `${open.who ?? "Submitted"} · ${new Date(open.submittedAt).toLocaleString()}`
              : "Newest first — every submission Magic Forms has sent here, whether or not an agent sent the link."}
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <SubmissionDetail
            base={base}
            row={open}
            form={forms.find((form) => form.key === open.formKey)}
            onBack={() => setOpenId(null)}
            onSave={onSave}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={formKey}
                onChange={(event) => onFormKey(event.target.value)}
                aria-label="Form"
                className="min-w-44"
              >
                <NativeSelectOption value="">All forms</NativeSelectOption>
                {forms.map((form) => (
                  <NativeSelectOption key={form.key} value={form.key}>
                    {form.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void syncNow()}
                disabled={syncing}
              >
                {syncing ? <Spinner /> : <ArrowsClockwiseIcon />}
                Sync from Magic Forms
              </Button>
            </div>

            <DialogBody className="pb-1">
              {status === "LoadingFirstPage" ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Spinner /> Loading…
                </div>
              ) : results.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No submissions yet. They show up here as soon as someone fills
                  in the form — Sync pulls in ones made before Magic Forms was
                  connected.
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {results.map((row) => (
                    <button
                      key={row._id}
                      type="button"
                      onClick={() => setOpenId(row._id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {row.who ?? "No name given"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.formTitle} · {ago(row.submittedAt)}
                        </p>
                      </div>
                      {row.conversationId ? (
                        <ChatCircleIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-label="Came from a conversation"
                        />
                      ) : null}
                      {row.record ? (
                        <Badge variant="outline" className="shrink-0 font-mono">
                          {row.record.reference}
                        </Badge>
                      ) : null}
                      <EyeIcon className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {status === "CanLoadMore" || status === "LoadingMore" ? (
                <Button
                  variant="ghost"
                  className="self-center"
                  onClick={() => loadMore(PAGE)}
                  disabled={status === "LoadingMore"}
                >
                  {status === "LoadingMore" ? <Spinner /> : null}
                  Load more
                </Button>
              ) : null}
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionDetail({
  base,
  row,
  form,
  onBack,
  onSave,
}: {
  base: string;
  row: SubmissionRow;
  /** Undefined when the form is no longer published. */
  form: FormRow | undefined;
  onBack: () => void;
  onSave: (form: FormRow) => void;
}) {
  const fileOne = useMutation(api.formSubmissions.fileOne);
  const [filing, setFiling] = useState(false);

  const file = async () => {
    setFiling(true);
    try {
      const result = await fileOne({ submissionId: row._id });
      toast.add({ title: `Filed as ${result.reference}`, type: "success" });
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setFiling(false);
    }
  };

  return (
    <>
      <DialogBody className="pb-1">
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          <ArrowLeftIcon /> All submissions
        </Button>
        {row.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing was filled in.
          </p>
        ) : (
          <dl className="divide-y rounded-lg border">
            {row.answers.map((answer) => (
              <div
                key={answer.key}
                className="grid gap-1 px-3 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-3"
              >
                <dt className="text-xs text-muted-foreground sm:text-sm">
                  {answer.label}
                </dt>
                <dd className="text-sm break-words whitespace-pre-wrap">
                  {answer.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </DialogBody>

      <DialogFooter>
        {row.viewUrl ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={row.viewUrl} target="_blank" rel="noreferrer" />}
          >
            Open in Magic Forms <ArrowSquareOutIcon />
          </Button>
        ) : null}
        {row.conversationId ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`${base}/conversations?c=${row.conversationId}`} />}
          >
            <ChatCircleIcon /> Conversation
          </Button>
        ) : null}
        {row.record ? (
          <Button
            nativeButton={false}
            render={<Link href={`${base}/records/${row.record.bookId}`} />}
          >
            <BookOpenIcon /> Filed as {row.record.reference}
          </Button>
        ) : row.book ? (
          <Button onClick={() => void file()} disabled={filing}>
            {filing ? <Spinner /> : <BookOpenIcon />} Save to record book
          </Button>
        ) : form ? (
          <Button onClick={() => onSave(form)}>
            <BookOpenIcon /> Save form to a record book
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Saving a form to a record book
// ---------------------------------------------------------------------------

function SaveToBookDialog({
  form,
  onClose,
}: {
  form: FormRow;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const sync = useAction(api.formSubmissions.sync);
  const save = useMutation(api.formSubmissions.saveToBook);
  const [name, setName] = useState(form.title);
  const [includePast, setIncludePast] = useState(form.count > 0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      // The past has to be here to be filed, so it is read from Magic Forms
      // first rather than trusting whatever the panel last pulled in.
      if (includePast) {
        await sync({ workspaceId: workspace._id, formKey: form.key });
      }
      await save({
        workspaceId: workspace._id,
        formKey: form.key,
        name,
        includePast,
      });
      toast.add({
        title: `Saving to ${name.trim() || form.title}`,
        description: includePast
          ? "Past submissions are being filed now, and new ones will be as they come in."
          : "New submissions will be filed as they come in.",
        type: "success",
      });
      onClose();
    } catch (error) {
      fail("Could not create the record book", error);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(value) => (value || busy ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save to a record book</DialogTitle>
            <DialogDescription>
              A new record book for {form.title}. Its{" "}
              {form.fieldCount === 1 ? "question becomes" : `${form.fieldCount} questions become`}{" "}
              the book&apos;s fields, and every submission is filed there as a
              record.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="form-book-name">Book name</Label>
            <Input
              id="form-book-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={form.title}
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Include past submissions</p>
              <p className="text-xs text-muted-foreground">
                {form.count > 0
                  ? `File the ${form.count}${form.countCapped ? "+" : ""} already in, as well as new ones.`
                  : "File any made before now, as well as new ones."}
              </p>
            </div>
            <Switch checked={includePast} onCheckedChange={setIncludePast} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : <BookOpenIcon />}
              Create record book
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StopSavingDialog({
  form,
  onClose,
}: {
  form: FormRow | null;
  onClose: () => void;
}) {
  const stop = useMutation(api.formSubmissions.stopSaving);
  const book = form?.book;

  const confirm = async () => {
    if (!book) return;
    try {
      await stop({ bookId: book._id });
      toast.add({ title: `Stopped saving to ${book.pluralName}`, type: "success" });
    } catch (error) {
      fail("Could not save", error);
    }
  };

  return (
    <AlertDialog
      open={Boolean(book)}
      onOpenChange={(value) => (value ? undefined : onClose())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop saving {form?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            New submissions will no longer be filed in {book?.pluralName}. The
            book and the records already in it stay exactly as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep saving</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>
            Stop saving
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
