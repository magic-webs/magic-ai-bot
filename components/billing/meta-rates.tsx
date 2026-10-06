"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatMoney, toMicros } from "@/convex/lib/billing";
import { marketByName, marketLabel } from "@/convex/lib/markets";
import { CurrencyPicker } from "@/components/regional-pickers";
import { META_RATE_SHEETS } from "@/components/billing/meta-rate-sheets";
import { ratesInForce, type MetaRateRow } from "@/components/billing/pricing";
import { readXlsx } from "@/components/billing/xlsx";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { TrashIcon } from "@phosphor-icons/react";

type ParsedRow = {
  market: string;
  marketing: number;
  utility: number;
  authentication: number;
  authenticationIntl?: number;
  service?: number;
};

type Parsed = {
  rows: ParsedRow[];
  skipped: string[];
  currency?: string;
  effectiveFrom?: string;
  error?: string;
};

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === "\t") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function toCsv(table: string[][]): string {
  const quote = (cell: string) =>
    /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return table
    .filter((row) => row.some(Boolean))
    .map((row) => row.map((cell) => quote(cell.replace(/\s*\n\s*/g, " "))).join(","))
    .join("\n");
}

/** A rate as a sheet prints it: "0.0118", "₹0.86", "8.0E-4"; "n/a" is none. */
const amount = (cell: string | undefined) => {
  if (cell === undefined) return undefined;
  const cleaned = cell.replace(/[^\d.eE+-]/g, "");
  const value = Number(cleaned);
  return cleaned === "" || !Number.isFinite(value) ? undefined : value;
};

/** "…effective October 1, 2026" in the sheet's title, as a date input value. */
function effectiveDate(table: string[][]): string | undefined {
  for (const row of table.slice(0, 5)) {
    const match = row.join(" ").match(/effective\s+([A-Za-z]+ \d{1,2}, \d{4})/i);
    if (!match) continue;
    const parsed = new Date(`${match[1]} UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * Meta's rate card, read loosely: the header row is the one naming a market
 * column and a marketing column, and every category is found by its name, so
 * a reordered or renamed export still reads.
 */
function parseRateCard(table: string[][]): Parsed {
  const isMarket = (cell: string) =>
    /^(market|country|region)/i.test(cell) && !/marketing/i.test(cell);
  const headerAt = table.findIndex(
    (row) => row.some(isMarket) && row.some((cell) => /marketing/i.test(cell))
  );
  if (headerAt < 0) {
    return { rows: [], skipped: [], error: "No header row with Market and Marketing columns." };
  }
  const header = table[headerAt].map((cell) => cell.toLowerCase());
  const column = (test: (cell: string) => boolean) => header.findIndex(test);
  const columns = {
    market: column(isMarket),
    currency: column((cell) => cell === "currency"),
    marketing: column((cell) => cell.includes("marketing") && !cell.includes("lite")),
    utility: column((cell) => cell.includes("utility")),
    authentication: column(
      (cell) => cell.includes("authentication") && !/international|intl/.test(cell)
    ),
    authenticationIntl: column(
      (cell) => cell.includes("authentication") && /international|intl/.test(cell)
    ),
    service: column((cell) => cell.includes("service")),
  };
  if (columns.utility < 0 || columns.authentication < 0) {
    return { rows: [], skipped: [], error: "The header needs Utility and Authentication columns." };
  }

  const rows: ParsedRow[] = [];
  const skipped: string[] = [];
  const currencies = new Set<string>();
  for (const cells of table.slice(headerAt + 1)) {
    const name = cells[columns.market] ?? "";
    const market = marketByName(name);
    const marketing = amount(cells[columns.marketing]);
    const utility = amount(cells[columns.utility]);
    const authentication = amount(cells[columns.authentication]);
    if (!market || marketing === undefined || utility === undefined || authentication === undefined) {
      if (name) skipped.push(name);
      continue;
    }
    if (columns.currency >= 0 && cells[columns.currency]) {
      currencies.add(cells[columns.currency].toUpperCase());
    }
    rows.push({
      market,
      marketing,
      utility,
      authentication,
      authenticationIntl:
        columns.authenticationIntl < 0 ? undefined : amount(cells[columns.authenticationIntl]),
      service: columns.service < 0 ? undefined : amount(cells[columns.service]),
    });
  }
  return {
    rows,
    skipped,
    currency: currencies.size === 1 ? [...currencies][0] : undefined,
    effectiveFrom: effectiveDate(table),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

const sheetDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function ImportMetaRatesDialog({
  defaultCurrency,
  trigger,
}: {
  defaultCurrency: string;
  trigger: React.ReactElement;
}) {
  const importRates = useMutation(api.billing.importMetaRates);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");
  const parsed = useMemo(
    () => (text.trim() ? parseRateCard(splitCsv(text)) : null),
    [text]
  );

  const load = (csv: string, fallback?: { currency: string; date: string }) => {
    setText(csv);
    const read = parseRateCard(splitCsv(csv));
    const sheetCurrency = read.currency ?? fallback?.currency;
    const sheetFrom = read.effectiveFrom ?? fallback?.date;
    if (sheetCurrency) setCurrency(sheetCurrency);
    if (sheetFrom) setDate(sheetFrom);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const head = new Uint8Array(buffer, 0, 2);
      // Meta's ".csv" downloads are workbooks: a zip starts "PK".
      const workbook = head[0] === 0x50 && head[1] === 0x4b;
      load(workbook ? toCsv(await readXlsx(buffer)) : new TextDecoder().decode(buffer));
    } catch (error) {
      toast.add({
        title: "Could not read that file",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  const submit = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    try {
      const [year, month, day] = date.split("-").map(Number);
      const result = await importRates({
        currency,
        effectiveFrom: Date.UTC(year, month - 1, day),
        rows: parsed.rows,
      });
      toast.add({
        title: `Imported Meta's ${currency} rates for ${result.imported} markets`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not import the rates",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const india = parsed?.rows.find((row) => row.market === "IN");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setText("");
          setDate(today());
          setCurrency(defaultCurrency);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Meta&apos;s rates</DialogTitle>
          <DialogDescription>
            Messages are priced in {defaultCurrency}; rates in another currency
            are kept for reference. Service is priced at the utility rate when
            a sheet has no service column.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Meta&apos;s published sheets</span>
            <div className="flex flex-wrap gap-2">
              {META_RATE_SHEETS.map((sheet) => (
                <Button
                  key={`${sheet.currency}-${sheet.effectiveFrom}`}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    load(sheet.csv, { currency: sheet.currency, date: sheet.effectiveFrom })
                  }
                >
                  {sheet.currency} · from {sheetDate(sheet.effectiveFrom)}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-file">Or a downloaded sheet</Label>
            <Input
              id="meta-file"
              type="file"
              accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-currency">Currency</Label>
              <CurrencyPicker id="meta-currency" value={currency} onValueChange={setCurrency} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-date">Effective from</Label>
              <Input
                id="meta-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-text">Rates</Label>
            <Textarea
              id="meta-text"
              rows={6}
              value={text}
              placeholder={"Market,Marketing,Utility,Authentication,Authentication-International,Service\nIndia,0.8631,0.115,0.115,2.4971,0.115"}
              className="max-h-48 font-mono text-xs"
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          {parsed?.error ? (
            <p className="text-xs text-destructive">{parsed.error}</p>
          ) : parsed ? (
            <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-xs">
              <span>
                <span className="font-medium">{parsed.rows.length}</span> markets ready
                {india ? `, India marketing ${formatMoney(toMicros(india.marketing), currency)}` : ""}.
              </span>
              {parsed.currency && parsed.currency !== currency ? (
                <span className="text-destructive">
                  The sheet is in {parsed.currency}, not {currency}.
                </span>
              ) : null}
              {parsed.skipped.length > 0 ? (
                <span className="text-muted-foreground">
                  Not recognised, left out: {parsed.skipped.join(", ")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !parsed || parsed.rows.length === 0 || !date}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every market's rates in force, and the imported versions to drop one of. */
export function MetaRatesDialog({
  rows,
  billedIn,
  now,
  trigger,
}: {
  rows: MetaRateRow[];
  billedIn: string;
  now: number;
  trigger: React.ReactElement;
}) {
  const deleteRates = useMutation(api.billing.deleteMetaRates);
  const [busy, setBusy] = useState<number | null>(null);
  const currencies = [...new Set(rows.map((row) => row.currency))].sort(
    (a, b) => Number(b === billedIn) - Number(a === billedIn) || a.localeCompare(b)
  );
  const [picked, setPicked] = useState(billedIn);
  const currency = currencies.includes(picked) ? picked : (currencies[0] ?? billedIn);
  const inCurrency = rows.filter((row) => row.currency === currency);
  const current = [...ratesInForce(inCurrency, now).values()].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
  const versions = [...new Set(inCurrency.map((row) => row.effectiveFrom))].sort(
    (a, b) => b - a
  );
  const day = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  const drop = async (effectiveFrom: number) => {
    setBusy(effectiveFrom);
    try {
      await deleteRates({ currency, effectiveFrom });
      toast.add({
        title: `Removed the ${currency} rates from ${day(effectiveFrom)}`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not remove the rates",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <DialogTitle>Meta&apos;s rates</DialogTitle>
            <DialogDescription>
              What Meta charges per delivered message, by the recipient&apos;s
              market. Messages are priced in {billedIn}, at the rates in force
              when they were sent.
            </DialogDescription>
          </div>
          {currencies.length > 1 ? (
            <SelectField
              value={currency}
              onValueChange={setPicked}
              options={currencies.map((code) => ({ value: code, label: code }))}
            />
          ) : null}
        </DialogHeader>
        <div className="max-h-[50svh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead className="text-right">Marketing</TableHead>
                <TableHead className="text-right">Utility</TableHead>
                <TableHead className="text-right">Auth</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Auth intl</TableHead>
                <TableHead className="text-right">Service</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.map((row) => {
                const money = (micros: number | undefined) =>
                  micros === undefined ? "—" : formatMoney(micros, row.currency);
                return (
                  <TableRow key={row._id}>
                    <TableCell className="font-medium">{marketLabel(row.market)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.marketingMicros)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.utilityMicros)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.authenticationMicros)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {money(row.authenticationIntlMicros)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.serviceMicros)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-wide text-muted-foreground uppercase">
            Imported {currency} versions
          </span>
          {versions.map((effectiveFrom) => (
            <div
              key={effectiveFrom}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
            >
              <span>
                From {day(effectiveFrom)}
                {effectiveFrom > now ? (
                  <span className="ml-2 text-xs text-muted-foreground">upcoming</span>
                ) : null}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove the ${currency} rates from ${day(effectiveFrom)}`}
                disabled={busy !== null}
                onClick={() => void drop(effectiveFrom)}
              >
                {busy === effectiveFrom ? <Spinner /> : <TrashIcon />}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
