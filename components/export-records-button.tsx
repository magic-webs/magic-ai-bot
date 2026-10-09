"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { downloadCsv } from "@/lib/csv";
import { recordsToCsv, type ExportedRecord } from "@/lib/record-csv";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { DownloadSimpleIcon } from "@phosphor-icons/react";

const PAGE = 500;

type ExportPage = FunctionReturnType<typeof api.records.exportPage>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Downloads every record in the book, or every one at `stage`, as CSV. */
export function ExportRecordsButton({
  book,
  stage,
}: {
  book: Doc<"recordBooks">;
  stage?: string;
}) {
  const workspace = useWorkspace();
  const convex = useConvex();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const records: ExportedRecord[] = [];
      let cursor: string | null = null;
      for (;;) {
        const result: ExportPage = await convex.query(api.records.exportPage, {
          bookId: book._id,
          stage,
          paginationOpts: { numItems: PAGE, cursor },
        });
        records.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }

      if (records.length === 0) {
        toast.add({ title: `No ${book.pluralName.toLowerCase()} to export` });
        return;
      }
      const day = new Date().toISOString().slice(0, 10);
      const name = [workspace.slug, slugify(book.pluralName), stage && slugify(stage), day]
        .filter(Boolean)
        .join("-");
      downloadCsv(`${name}.csv`, recordsToCsv(book, records));
      toast.add({
        title: `${records.length} ${records.length === 1 ? book.name.toLowerCase() : book.pluralName.toLowerCase()} exported`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not export",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={() => void run()} disabled={busy}>
      {busy ? <Spinner /> : <DownloadSimpleIcon />} Export CSV
    </Button>
  );
}
