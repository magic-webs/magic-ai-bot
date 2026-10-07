"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { normaliseBirthday } from "@/convex/lib/marketing";
import { downloadCsv } from "@/lib/csv";
import {
  parseContactCsv,
  rowFromCells,
  sampleContactCsv,
  type ContactParse,
  type ContactRow,
} from "@/lib/contact-csv";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { friendlyError } from "@/lib/errors";
import { DownloadSimpleIcon, UserPlusIcon } from "@phosphor-icons/react";

type Mode = "one" | "list" | "csv";

/** What one `contacts.addMany` call takes at most. */
const BATCH = 500;
/** How many rows of an imported file are shown before it is added. */
const PREVIEW_ROWS = 5;

/**
 * A pasted list, one person a line, in whatever order the columns came out of
 * a spreadsheet — see `rowFromCells`.
 */
function parseList(text: string): { rows: ContactRow[]; skipped: number } {
  const rows: ContactRow[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = rowFromCells(line.split(/[,;\t|]/));
    if (row) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
}

/** "line 4, 9 and 12", or the first few and a count, for a line that says where. */
function linesLabel(lines: number[]): string {
  const shown = lines.slice(0, 5);
  const more = lines.length - shown.length;
  const list =
    shown.length === 1
      ? `line ${shown[0]}`
      : `lines ${shown.slice(0, -1).join(", ")}${more ? `, ${shown.at(-1)}` : ` and ${shown.at(-1)}`}`;
  return more ? `${list} and ${more} more` : list;
}

/**
 * Adds WhatsApp contacts by hand, so greetings and event reminders reach
 * people who have not written in yet. Keyed by its parent on each open, so it
 * always starts empty.
 */
export function AddContactsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const addMany = useMutation(api.contacts.addMany);
  const [mode, setMode] = useState<Mode>("one");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [list, setList] = useState("");
  const [csv, setCsv] = useState<(ContactParse & { fileName: string }) | null>(null);
  const [countryCode, setCountryCode] = useState("91");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);

  const rows: ContactRow[] =
    mode === "one"
      ? phone.trim()
        ? [{ name, phone, birthday }]
        : []
      : mode === "list"
        ? parseList(list).rows
        : (csv?.rows ?? []);
  const listSkipped = mode === "list" ? parseList(list).skipped : 0;
  const birthdayInvalid =
    mode === "one" && birthday.trim() !== "" && normaliseBirthday(birthday) === null;

  const readFile = async (file: File | undefined) => {
    setInvalid([]);
    if (!file) {
      setCsv(null);
      return;
    }
    try {
      setCsv({ ...parseContactCsv(await file.text()), fileName: file.name });
    } catch (error) {
      setCsv(null);
      toast.add({
        title: "Could not read that file",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      // In batches, so a file of a few thousand goes through as several
      // calls rather than one the server refuses.
      const result = { added: 0, updated: 0, invalid: [] as string[] };
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = await addMany({
          workspaceId: workspace._id,
          countryCode: countryCode.trim() || undefined,
          contacts: rows.slice(start, start + BATCH).map((row) => ({
            phone: row.phone,
            name: row.name?.trim() || undefined,
            birthday: row.birthday?.trim() || undefined,
            email: row.email?.trim() || undefined,
            company: row.company?.trim() || undefined,
          })),
        });
        result.added += batch.added;
        result.updated += batch.updated;
        result.invalid.push(...batch.invalid);
      }
      const parts = [
        result.added ? `${result.added} added` : null,
        result.updated ? `${result.updated} already on file` : null,
      ].filter(Boolean);
      toast.add({
        title: parts.length ? parts.join(", ") : "Nobody added",
        description: result.invalid.length
          ? `${result.invalid.length} ${result.invalid.length === 1 ? "number was" : "numbers were"} not recognised.`
          : undefined,
        type: result.added || result.updated ? "success" : "error",
      });
      if (result.invalid.length) {
        // Left open with what went wrong, so it can be fixed and sent again.
        setInvalid(result.invalid);
        if (mode === "list") {
          setList(
            list
              .split(/\r?\n/)
              .filter((line) => result.invalid.some((bad) => line.includes(bad)))
              .join("\n")
          );
        }
      } else {
        onClose();
      }
    } catch (error) {
      toast.add({
        title: "Could not add them",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add contacts</DialogTitle>
          <DialogDescription>
            They get your greetings and event reminders on WhatsApp, and each one shows
            in their chat in the inbox — so a reply carries on from it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <ToggleGroup
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0] as Mode | undefined;
              if (next) {
                setMode(next);
                setInvalid([]);
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="one">One person</ToggleGroupItem>
            <ToggleGroupItem value="list">Paste a list</ToggleGroupItem>
            <ToggleGroupItem value="csv">Import CSV</ToggleGroupItem>
          </ToggleGroup>

          {mode === "one" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-name">Name</Label>
                <Input
                  id="add-name"
                  value={name}
                  autoFocus
                  placeholder="Asha Rao"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-phone">WhatsApp number</Label>
                <Input
                  id="add-phone"
                  type="tel"
                  value={phone}
                  placeholder="98765 43210"
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="add-birthday">Birthday</Label>
                <Input
                  id="add-birthday"
                  value={birthday}
                  placeholder="Optional — 25/12 or 25 December"
                  aria-invalid={birthdayInvalid || undefined}
                  onChange={(event) => setBirthday(event.target.value)}
                />
                {birthdayInvalid ? (
                  <p className="text-xs text-destructive">
                    That is not a day of the year. Day first, like 25/12.
                  </p>
                ) : null}
              </div>
            </div>
          ) : mode === "list" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-list">One person a line</Label>
              <Textarea
                id="add-list"
                rows={7}
                value={list}
                autoFocus
                className="font-mono text-xs"
                placeholder={"Asha Rao, 98765 43210, 25/12\nVikram, +91 91234 56789\n98111 22233"}
                onChange={(event) => setList(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Name, number and birthday, separated by commas or pasted straight from a
                spreadsheet. Only the number is needed.
                {list.trim()
                  ? ` ${rows.length} ready${listSkipped ? `, ${listSkipped} without a number` : ""}.`
                  : ""}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="CSV file"
                  className="h-auto min-w-0 flex-1 py-1"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  onClick={() => downloadCsv("contacts-sample.csv", sampleContactCsv())}
                >
                  <DownloadSimpleIcon /> Sample CSV
                </Button>
              </div>
              {csv ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{csv.fileName}</span>:{" "}
                    {csv.rows.length} ready
                    {csv.missingPhone.length
                      ? `, ${csv.missingPhone.length} without a number (${linesLabel(csv.missingPhone)})`
                      : ""}
                    .
                  </p>
                  {csv.rows.length > 0 ? (
                    <div className="overflow-x-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Number</TableHead>
                            <TableHead>Birthday</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {csv.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                            <TableRow key={index}>
                              <TableCell className="max-w-40 truncate text-xs">
                                {row.name || "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs whitespace-nowrap">
                                {row.phone}
                              </TableCell>
                              <TableCell className="text-xs">{row.birthday || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {csv.rows.length > PREVIEW_ROWS ? (
                        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                          and {csv.rows.length - PREVIEW_ROWS} more
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Columns <code>name</code>, <code>phone</code>, <code>birthday</code>,{" "}
                  <code>email</code> and <code>company</code> — only the phone is needed.
                  Exports from Google Contacts and Excel import as they are.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5 sm:w-48">
            <Label htmlFor="add-country">Country code</Label>
            <Input
              id="add-country"
              value={countryCode}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setCountryCode(event.target.value.replace(/\D/g, ""))}
            />
            <p className="text-xs text-muted-foreground">
              For numbers written without one.
            </p>
          </div>

          {invalid.length ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <p className="font-medium">Not recognised as WhatsApp numbers:</p>
              <p className="mt-1 font-mono break-all">{invalid.join(", ")}</p>
            </div>
          ) : null}

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
              className="mt-0.5"
            />
            <span>
              These people have agreed to get WhatsApp messages from {workspace.name}.
              <span className="block text-xs text-muted-foreground">
                Messaging people who did not ask to hear from you gets a number reported,
                and WhatsApp restricts numbers that are reported.
              </span>
            </span>
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !consent || rows.length === 0 || birthdayInvalid}
          >
            {busy ? <Spinner /> : <UserPlusIcon />}
            {rows.length > 1 ? `Add ${rows.length} people` : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
