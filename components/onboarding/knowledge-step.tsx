"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { FormRow, NothingYet } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { stepHref } from "@/lib/onboarding";
import {
  ArrowRightIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * Step 4 — the knowledge base.
 *
 * A source is split into chunks, embedded, and searched at reply time; an agent
 * quotes from what comes back rather than from its own memory. So the unit that
 * matters is the passage, not the document: one source per topic retrieves far
 * better than one source holding everything, because a chunk of the everything
 * document is as likely to be about parking as about the question asked.
 *
 * Indexing is asynchronous. A new source lands `pending` and turns `ready` a
 * few seconds later over the websocket with no refresh — which is why the row
 * shows the state rather than pretending the save was the whole job.
 *
 * File upload is not here. It needs the storage round trip and a drop zone, and
 * that already exists on the knowledge page proper; this step covers the three
 * kinds a company can write from memory on its first afternoon.
 */

type Kind = "text" | "faq" | "url";

const KIND_LABEL: Record<Kind, string> = {
  text: "Written text",
  faq: "Questions and answers",
  url: "A page on your site",
};

const KIND_HINT: Record<Kind, string> = {
  text: "Paste anything an agent should be able to quote — a policy, a process, a spec sheet.",
  faq: "Write it as Q and A. Retrieval is noticeably better on this shape than on prose.",
  url: "The page is fetched and indexed once. Re-add it after the page changes — it is read, not watched.",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "queued",
  processing: "indexing",
  ready: "searchable",
  failed: "failed",
};

export function KnowledgeStep() {
  const workspace = useWorkspace();
  const router = useRouter();
  const addSource = useMutation(api.knowledge.addSource);
  const removeSource = useMutation(api.knowledge.remove);
  const sources = useQuery(api.knowledge.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const ready =
    title.trim().length > 0 &&
    (kind === "url" ? url.trim().length > 0 : body.trim().length > 0);

  const reset = () => {
    setTitle("");
    setBody("");
    setUrl("");
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await addSource({
        workspaceId: workspace._id,
        title: title.trim(),
        kind,
        ...(kind === "url" ? { url: url.trim() } : { rawText: body.trim() }),
      });
      toast.add({
        title: "Source added",
        description: "It will be searchable once indexing finishes.",
        type: "success",
      });
      reset();
      setAdding(false);
    } catch (error) {
      toast.add({
        title: "Could not add the source",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const drop = async (sourceId: Id<"knowledgeSources">, name: string) => {
    try {
      await removeSource({ sourceId });
      toast.add({ title: `${name} removed`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not remove the source",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  if (sources === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading the knowledge base…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your sources</CardTitle>
          <CardDescription>
            One topic per source. Narrow sources are retrieved far more
            accurately than long ones.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sources.length === 0 && !adding ? (
            <NothingYet>
              Nothing indexed yet. Your delivery and returns policy is usually
              the first thing worth adding — it is what customers ask about
              first.
            </NothingYet>
          ) : null}

          {sources.map((source) => {
            const working =
              source.status === "pending" || source.status === "processing";
            return (
              <div
                key={source._id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {source.kind === "url" ? (
                    <GlobeIcon className="size-4" />
                  ) : (
                    <MagnifyingGlassIcon className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{source.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {source.url ??
                      source.preview ??
                      `${source.charCount.toLocaleString()} characters`}
                  </p>
                </div>
                {working ? <Spinner className="size-4" /> : null}
                <Badge variant={source.status === "ready" ? "secondary" : "outline"}>
                  {STATUS_LABEL[source.status] ?? source.status}
                </Badge>
                {source.status === "ready" ? (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {source.chunkCount}{" "}
                    {source.chunkCount === 1 ? "passage" : "passages"}
                  </span>
                ) : null}
                <Button
                  size="icon-lg"
                  variant="ghost"
                  aria-label={`Remove ${source.title}`}
                  onClick={() => void drop(source._id, source.title)}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}

          {adding ? (
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
              <FormRow label="Kind" hint={KIND_HINT[kind]}>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(KIND_LABEL) as Kind[]).map((option) => (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={kind === option ? "secondary" : "outline"}
                      onClick={() => setKind(option)}
                    >
                      {KIND_LABEL[option]}
                    </Button>
                  ))}
                </div>
              </FormRow>

              <FormRow
                label="Title"
                hint="Shown to the agent beside every passage it retrieves, so name it the way you would name a folder."
              >
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Delivery and returns"
                />
              </FormRow>

              {kind === "url" ? (
                <FormRow label="Address">
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://northgatesigns.co.uk/delivery"
                  />
                </FormRow>
              ) : (
                <FormRow
                  label={kind === "faq" ? "Questions and answers" : "Content"}
                >
                  <Textarea
                    rows={8}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={
                      kind === "faq"
                        ? "Q: How long does delivery take?\nA: Three to five working days within the UK.\n\nQ: Do you install?\nA: Yes, anywhere in Yorkshire."
                        : "Free delivery within 20 miles of Leeds. Nationwide is £35 and takes three to five working days…"
                    }
                  />
                </FormRow>
              )}

              <div className="flex gap-2">
                <Button onClick={() => void submit()} disabled={!ready || busy}>
                  {busy ? <Spinner /> : null}
                  {busy ? "Indexing…" : "Add source"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    reset();
                    setAdding(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setAdding(true)}
            >
              <PlusIcon /> Add a source
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Files — PDFs, spreadsheets, price lists — are uploaded on the{" "}
        <Link
          href={`/w/${workspace.slug}/knowledge`}
          className="underline underline-offset-4"
        >
          knowledge base
        </Link>{" "}
        page. Anything added there counts towards this step too.
      </p>

      <div>
        <Button onClick={() => router.push(stepHref(workspace.slug, "catalogue"))}>
          Continue <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}
