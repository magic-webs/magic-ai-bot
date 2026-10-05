"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { FIX_LABELS, PROBLEM_LABELS, type ContactFix, type ContactProblem } from "@/convex/lib/contactClean";
import { downloadCsv } from "@/lib/csv";
import { parseContactCsv, rowFromCells, sampleContactCsv, type ContactRow } from "@/lib/contact-csv";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  ArrowCounterClockwiseIcon,
  BroomIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  ProhibitIcon,
  SparkleIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { categoryLabel, categoryTone, fail, formatPhone, plural, type Category } from "./shared";

const CHUNK = 500;

type Source = "csv" | "paste";
type Bucket = "ready" | "check" | "invalid" | "duplicate" | "skipped";

const BUCKETS: Array<{ value: Bucket; label: string }> = [
  { value: "ready", label: "Ready" },
  { value: "check", label: "Needs a look" },
  { value: "invalid", label: "Problems" },
  { value: "duplicate", label: "Repeats" },
  { value: "skipped", label: "Left out" },
];

function parsePaste(text: string): ContactRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => rowFromCells(line.split(/[,;\t|]/)))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function ImportUpload({
  onStarted,
  onClose,
}: {
  onStarted: (importId: Id<"audienceImports">) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const create = useMutation(api.audienceImports.create);
  const addRows = useMutation(api.audienceImports.addRows);
  const startSorting = useMutation(api.audienceImports.startSorting);

  const [source, setSource] = useState<Source>("csv");
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<ContactRow[]>([]);
  const [missing, setMissing] = useState(0);
  const [pasted, setPasted] = useState("");
  const [countryCode, setCountryCode] = useState("91");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = source === "csv" ? fileRows : parsePaste(pasted);

  const readFile = async (file: File) => {
    const parsed = parseContactCsv(await file.text());
    setFileName(file.name);
    setFileRows(parsed.rows);
    setMissing(parsed.missingPhone.length);
    if (!name) setName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  };

  const start = async () => {
    setBusy("Uploading");
    try {
      const importId = await create({
        workspaceId: workspace._id,
        name: name.trim() || "Imported contacts",
        fileName: fileName ?? undefined,
        countryCode,
      });
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`Uploading ${Math.min(i + CHUNK, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`);
        await addRows({
          importId,
          firstLine: i + 1,
          rows: rows.slice(i, i + CHUNK).map((row) => ({
            name: row.name,
            phone: row.phone,
            email: row.email,
            company: row.company,
            birthday: row.birthday,
            tags: row.tags,
            notes: row.notes,
          })),
        });
      }
      await startSorting({ importId });
      onStarted(importId);
    } catch (error) {
      fail("Could not start the import", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Bring in contacts</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Upload a CSV exported from another system — Google Contacts, Excel, a CRM, an old
          WhatsApp tool — or paste a list. Every row is cleaned up, checked and sorted by Jev, and
          nothing is saved until you have reviewed it.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <ol className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
          {["Upload", "Clean up", "Check with Jev", "Review and save"].map((label, index) => (
            <li
              key={label}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-name">Name this list</Label>
            <Input
              id="import-name"
              value={name}
              maxLength={80}
              placeholder="e.g. Expo visitors, March"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-cc">Country code</Label>
            <Input
              id="import-cc"
              value={countryCode}
              inputMode="numeric"
              onChange={(event) => setCountryCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
        </div>

        <ToggleGroup
          value={[source]}
          onValueChange={(next) => next[0] && setSource(next[0] as Source)}
          variant="outline"
        >
          <ToggleGroupItem value="csv">
            <UploadSimpleIcon /> Upload a file
          </ToggleGroupItem>
          <ToggleGroupItem value="paste">Paste a list</ToggleGroupItem>
        </ToggleGroup>

        {source === "csv" ? (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center hover:bg-muted/40">
              <UploadSimpleIcon className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">
                {fileName ? fileName : "Choose a CSV file"}
              </span>
              <span className="text-xs text-muted-foreground">
                Google Contacts, Excel or any spreadsheet saved as CSV. Columns are found by their
                headers.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {fileName
                  ? `${plural(fileRows.length, "row")} with a number${missing ? `, ${missing} without one` : ""}.`
                  : "Only a phone column is needed. Name, email, company, birthday, labels and notes help sorting."}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadCsv("contacts-sample.csv", sampleContactCsv())}
              >
                <DownloadSimpleIcon /> Sample file
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Textarea
              rows={7}
              value={pasted}
              placeholder={"Asha Rao, +91 98765 43210, Regular customer\nVikram, 91234 56789, Supplier"}
              onChange={(event) => setPasted(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              One person a line. {plural(rows.length, "row")} with a number found.
            </span>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={consent} onCheckedChange={(next) => setConsent(Boolean(next))} />
          <span>
            These people agreed to hear from {workspace.name} on WhatsApp. Messaging people who did
            not opt in gets a WhatsApp number restricted.
          </span>
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onClose} disabled={Boolean(busy)}>
          Cancel
        </Button>
        <Button onClick={() => void start()} disabled={Boolean(busy) || rows.length === 0 || !consent}>
          {busy ? <Spinner /> : <BroomIcon />}
          {busy ?? `Clean up and sort ${plural(rows.length, "contact")}`}
        </Button>
      </div>
    </>
  );
}

export function ImportProgress({
  importId,
  onClose,
}: {
  importId: Id<"audienceImports">;
  onClose: () => void;
}) {
  const data = useQuery(api.audienceImports.get, { importId });

  if (data === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const counts = data.counts;
  if (data.status === "uploading" || data.status === "sorting") {
    const sorted = data.total - counts.queued;
    return (
      <>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Sorting {data.name}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Each contact is checked and placed in a category. You can leave this page — it carries on,
            and the list waits for you under Imports.
          </p>
        </div>
        <div className="flex flex-col gap-4 py-6">
          <Progress value={data.total ? Math.round((sorted / data.total) * 100) : 0} />
          <div className="flex items-center gap-2 text-sm">
            <SparkleIcon className="size-4 text-primary" />
            {sorted.toLocaleString()} of {data.total.toLocaleString()} looked at
          </div>
          <CountStrip counts={counts} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose}>
            Back to audience
          </Button>
        </div>
      </>
    );
  }

  if (data.status === "saving" || data.status === "saved") {
    const done = data.status === "saved";
    return (
      <>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{done ? "Saved" : `Saving ${data.name}`}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {done
              ? `${plural(counts.saved, "contact")} added to your audience${data.audienceId ? ` and to the list “${data.name}”` : ""}.`
              : "Adding everyone you kept to your contacts."}
          </p>
        </div>
        <div className="flex flex-col gap-4 py-6">
          {done ? (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircleIcon className="size-5" weight="fill" />
              Ready to use in campaigns and events.
            </div>
          ) : (
            <Progress
              value={Math.round((counts.saved / Math.max(1, counts.saved + counts.ready)) * 100)}
            />
          )}
          <CountStrip counts={counts} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>{done ? "Done" : "Back to audience"}</Button>
        </div>
      </>
    );
  }

  return <Review data={data} onClose={onClose} />;
}

function CountStrip({ counts }: { counts: Doc<"audienceImports">["counts"] }) {
  const items = [
    { label: "Ready", value: counts.ready + counts.saved, tone: "text-emerald-700 dark:text-emerald-400" },
    { label: "Needs a look", value: counts.check, tone: "text-amber-700 dark:text-amber-400" },
    { label: "Problems", value: counts.invalid, tone: "text-destructive" },
    { label: "Repeats", value: counts.duplicate, tone: "text-muted-foreground" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${item.tone}`}>
            {item.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

type ImportData = Doc<"audienceImports"> & { categories: Category[] };

function Review({ data, onClose }: { data: ImportData; onClose: () => void }) {
  const save = useMutation(api.audienceImports.save);
  const discard = useMutation(api.audienceImports.discard);
  const acceptAll = useMutation(api.audienceImports.acceptAll);
  const [bucket, setBucket] = useState<Bucket>(data.counts.check > 0 ? "check" : "ready");
  const [listName, setListName] = useState(data.name);
  const [makeList, setMakeList] = useState(true);
  const [busy, setBusy] = useState(false);

  const counts = data.counts;
  const run = async (task: () => Promise<unknown>, title: string) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      fail(title, error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Review {data.name}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {plural(data.total, "row")} cleaned up and sorted. Check anything flagged, change a
          category where it is wrong, then save.
        </p>
      </div>
      <div className="flex min-h-0 flex-col gap-3">
        {data.error ? (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {data.error}
          </p>
        ) : null}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {BUCKETS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={bucket === item.value ? "secondary" : "ghost"}
              onClick={() => setBucket(item.value)}
            >
              {item.label}
              <Badge variant="outline" className="ml-1 tabular-nums">
                {counts[item.value].toLocaleString()}
              </Badge>
            </Button>
          ))}
          {bucket === "check" && counts.check > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                void run(() => acceptAll({ importId: data._id, from: "check" }), "Could not keep them")
              }
            >
              <CheckCircleIcon /> Keep all {counts.check.toLocaleString()}
            </Button>
          ) : null}
          {bucket === "skipped" && counts.skipped > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                void run(() => acceptAll({ importId: data._id, from: "skipped" }), "Could not restore them")
              }
            >
              <ArrowCounterClockwiseIcon /> Put all back
            </Button>
          ) : null}
        </div>
        <RowsTable key={bucket} importId={data._id} bucket={bucket} categories={data.categories} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4 flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 text-sm">
          <Checkbox checked={makeList} onCheckedChange={(next) => setMakeList(Boolean(next))} />
          <span className="shrink-0">Also save as the list</span>
          <Input
            value={listName}
            disabled={!makeList}
            className="h-8 max-w-64"
            onChange={(event) => setListName(event.target.value)}
          />
        </label>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await discard({ importId: data._id });
              toast.add({ title: "Import thrown away" });
              onClose();
            }, "Could not discard it")
          }
        >
          Discard
        </Button>
        <Button
          disabled={busy || counts.ready === 0}
          onClick={() =>
            void run(
              () =>
                save({
                  importId: data._id,
                  audienceName: makeList ? listName.trim() || data.name : undefined,
                }),
              "Could not save"
            )
          }
        >
          {busy ? <Spinner /> : <CheckCircleIcon />} Save {plural(counts.ready, "contact")}
        </Button>
      </div>
    </>
  );
}

function RowsTable({
  importId,
  bucket,
  categories,
}: {
  importId: Id<"audienceImports">;
  bucket: Bucket;
  categories: Category[];
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.audienceImports.rows,
    { importId, status: bucket },
    { initialNumItems: 25 }
  );
  const updateRow = useMutation(api.audienceImports.updateRow);
  const setRowsStatus = useMutation(api.audienceImports.setRowsStatus);
  const options = categories.map((category) => ({ value: category.key, label: category.label }));

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        Nothing here.
      </p>
    );
  }

  return (
    <div className="max-h-[65vh] overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Line</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="hidden md:table-cell">Details</TableHead>
            <TableHead className="w-48">{bucket === "invalid" ? "Fix the number" : "Category"}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((row) => (
            <TableRow key={row._id}>
              <TableCell className="text-xs text-muted-foreground tabular-nums">{row.line}</TableCell>
              <TableCell>
                <p className="font-medium">{row.name ?? <span className="text-muted-foreground">No name</span>}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.phone ? formatPhone(row.phone) : row.raw.phone || "—"}
                </p>
                {row.optedOut ? (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    Unsubscribed earlier
                  </Badge>
                ) : row.existingContactId ? (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    Already a contact
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="hidden max-w-72 md:table-cell">
                <p className="truncate text-xs text-muted-foreground">
                  {[row.company, row.email, row.notes].filter(Boolean).join(" · ") || "—"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.problem ? (
                    <Badge variant="destructive" className="text-[10px]">
                      {PROBLEM_LABELS[row.problem as ContactProblem] ?? row.problem}
                    </Badge>
                  ) : null}
                  {row.duplicateOfLine ? (
                    <Badge variant="outline" className="text-[10px]">
                      Same number as line {row.duplicateOfLine}
                    </Badge>
                  ) : null}
                  {(row.junk ?? 0) >= 0.5 ? (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                      Looks like test data
                    </Badge>
                  ) : null}
                  {row.confidence !== undefined && row.confidence < 0.8 ? (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                      Unsure · {Math.round(row.confidence * 100)}%
                    </Badge>
                  ) : null}
                  {row.fixes.map((fix) =>
                    fix === "business_name" || fix === "do_not_contact" ? (
                      <Badge
                        key={fix}
                        variant="outline"
                        className="gap-1 text-[10px] text-violet-700 dark:text-violet-300"
                      >
                        <SparkleIcon className="size-3" />
                        {FIX_LABELS[fix]}
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            void updateRow({ rowId: row._id, undo: fix }).catch((error) =>
                              fail("Could not undo it", error)
                            )
                          }
                        >
                          undo
                        </button>
                      </Badge>
                    ) : (
                      <Badge key={fix} variant="secondary" className="text-[10px]">
                        {FIX_LABELS[fix as ContactFix] ?? fix}
                      </Badge>
                    )
                  )}
                  {row.interest ? (
                    <Badge variant="outline" className="text-[10px]">
                      {row.interest === "hot" ? "Keen" : row.interest === "warm" ? "Some interest" : "Not interested"}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                {bucket === "invalid" ? (
                  <PhoneFix
                    initial={row.raw.phone}
                    onSave={(phone) => updateRow({ rowId: row._id, phone })}
                  />
                ) : bucket === "duplicate" ? (
                  <span className="text-xs text-muted-foreground">Merged into line {row.duplicateOfLine}</span>
                ) : (
                  <div className="flex flex-col gap-1">
                    <SelectField
                      size="sm"
                      aria-label="Category"
                      value={row.category ?? ""}
                      placeholder="Pick one"
                      options={options}
                      onValueChange={(category) =>
                        void updateRow({ rowId: row._id, category }).catch((error) =>
                          fail("Could not change it", error)
                        )
                      }
                    />
                    <span
                      className={`w-fit rounded px-1.5 py-0.5 text-[10px] ${categoryTone(categories, row.category)}`}
                    >
                      {categoryLabel(categories, row.category)}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">
                {bucket === "skipped" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void setRowsStatus({ rowIds: [row._id], status: "ready" }).catch((error) =>
                        fail("Could not put it back", error)
                      )
                    }
                  >
                    Put back
                  </Button>
                ) : bucket === "ready" || bucket === "check" ? (
                  <div className="flex justify-end gap-1">
                    {bucket === "check" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void setRowsStatus({ rowIds: [row._id], status: "ready" }).catch((error) =>
                            fail("Could not keep it", error)
                          )
                        }
                      >
                        Keep
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Leave out"
                      onClick={() =>
                        void setRowsStatus({ rowIds: [row._id], status: "skipped" }).catch((error) =>
                          fail("Could not leave it out", error)
                        )
                      }
                    >
                      <ProhibitIcon />
                    </Button>
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {status === "CanLoadMore" ? (
        <div className="flex justify-center border-t border-border p-2">
          <Button size="sm" variant="ghost" onClick={() => loadMore(50)}>
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PhoneFix({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (phone: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex gap-1"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave(value);
        } catch (error) {
          fail("Could not fix it", error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        value={value}
        className="h-8 font-mono text-xs"
        onChange={(event) => setValue(event.target.value)}
      />
      <Button size="sm" type="submit" variant="outline" disabled={busy || value === initial}>
        {busy ? <Spinner /> : "Fix"}
      </Button>
    </form>
  );
}
