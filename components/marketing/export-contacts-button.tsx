"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { downloadCsv } from "@/lib/csv";
import { contactsToCsv } from "@/lib/contact-csv";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { DownloadSimpleIcon } from "@phosphor-icons/react";

/** How many contacts one export call reads. */
const PAGE = 500;

type ExportPage = FunctionReturnType<typeof api.contacts.exportPage>;

/**
 * Downloads every WhatsApp contact as the same CSV the importer reads, so a
 * list can be taken out, tidied in a spreadsheet and brought back.
 *
 * Read a page at a time on the click rather than kept subscribed: the table
 * on screen shows at most a few hundred, and an export is a one-off.
 */
export function ExportContactsButton() {
  const workspace = useWorkspace();
  const convex = useConvex();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const contacts: ExportPage["page"] = [];
      let cursor: string | null = null;
      for (;;) {
        const result: ExportPage = await convex.query(api.contacts.exportPage, {
          workspaceId: workspace._id,
          paginationOpts: { numItems: PAGE, cursor },
        });
        contacts.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }

      if (contacts.length === 0) {
        toast.add({ title: "No WhatsApp contacts to export yet" });
        return;
      }
      const day = new Date().toISOString().slice(0, 10);
      downloadCsv(`${workspace.slug}-contacts-${day}.csv`, contactsToCsv(contacts));
      toast.add({
        title: `${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"} exported`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not export the contacts",
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
