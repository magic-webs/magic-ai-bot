"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { SelectField } from "@/components/select-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BooksIcon,
  PlusIcon,
  TrashIcon,
  PencilSimpleIcon,
  FloppyDiskIcon,
  ArrowsClockwiseIcon,
  FileTextIcon,
  LinkIcon,
  QuestionIcon,
  UploadIcon,
  WarningIcon,
} from "@phosphor-icons/react";

const KIND_ICONS = {
  text: FileTextIcon,
  faq: QuestionIcon,
  url: LinkIcon,
  file: UploadIcon,
} as const;

const STATUS_VARIANT = {
  pending: "secondary",
  processing: "secondary",
  ready: "default",
  failed: "destructive",
} as const;

function AddSourceDialog() {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const addSource = useMutation(api.knowledge.addSource);
  const generateUploadUrl = useMutation(api.knowledge.generateUploadUrl);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string>("all");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const agentId = scope === "all" ? undefined : (scope as Id<"agents">);

  const reset = () => {
    setTitle("");
    setText("");
    setUrl("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitText = async (kind: "text" | "faq") => {
    if (!text.trim()) {
      toast.add({ title: "Paste some content first", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await addSource({
        workspaceId: workspace._id,
        agentId,
        title: title || (kind === "faq" ? "FAQ" : "Pasted notes"),
        kind,
        rawText: text,
        tags: [],
      });
      toast.add({
        title: "Source queued for embedding",
        description: "It becomes searchable as soon as processing finishes.",
        type: "success",
      });
      reset();
      setOpen(false);
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

  const submitUrl = async () => {
    if (!url.trim()) {
      toast.add({ title: "Enter a URL", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await addSource({
        workspaceId: workspace._id,
        agentId,
        title: title || url,
        kind: "url",
        url,
        tags: [],
      });
      toast.add({ title: "Fetching and embedding the page", type: "success" });
      reset();
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not add the URL",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.add({ title: "Choose a file first", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with HTTP ${response.status}`);
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };

      await addSource({
        workspaceId: workspace._id,
        agentId,
        title: title || file.name,
        kind: "file",
        storageId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        tags: [],
      });

      toast.add({ title: `${file.name} uploaded`, type: "success" });
      reset();
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Upload failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><PlusIcon /> Add source</Button>} />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a knowledge source</DialogTitle>
          <DialogDescription>
            Content is chunked, embedded with OpenAI and stored in Convex&apos;s
            vector index. Agents retrieve from it on every message.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="src-title">Title</Label>
            <Input
              id="src-title"
              value={title}
              placeholder="Delivery and returns policy"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="src-scope">Available to</Label>
            <SelectField
              id="src-scope"
              className="w-full"
              value={scope}
              onValueChange={setScope}
              options={[
                { value: "all", label: "Every agent in this workspace" },
                ...(agents ?? []).map((agent) => ({
                  value: agent._id as string,
                  label: `Only ${agent.botName} (${agent.name})`,
                })),
              ]}
            />
          </div>
        </div>

        <Tabs defaultValue="text">
          <TabsList className="w-full">
            <TabsTrigger value="text">
              <FileTextIcon /> Paste text
            </TabsTrigger>
            <TabsTrigger value="faq">
              <QuestionIcon /> FAQ
            </TabsTrigger>
            <TabsTrigger value="url">
              <LinkIcon /> URL
            </TabsTrigger>
            <TabsTrigger value="file">
              <UploadIcon /> File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="flex flex-col gap-3 pt-3">
            <Textarea
              rows={9}
              value={text}
              placeholder="Paste policies, product guidance, pricing rules the team follows, tone examples…"
              onChange={(event) => setText(event.target.value)}
            />
            <Button onClick={() => submitText("text")} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Add and embed
            </Button>
          </TabsContent>

          <TabsContent value="faq" className="flex flex-col gap-3 pt-3">
            <Textarea
              rows={9}
              value={text}
              placeholder={
                "Q: Do you deliver outside the UK?\nA: No, UK mainland only.\n\nQ: What is the minimum order?\nA: £75 excluding VAT."
              }
              onChange={(event) => setText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Separate each Q/A pair with a blank line so they chunk cleanly.
            </p>
            <Button onClick={() => submitText("faq")} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Add and embed
            </Button>
          </TabsContent>

          <TabsContent value="url" className="flex flex-col gap-3 pt-3">
            <Input
              value={url}
              placeholder="https://example.com/delivery-policy"
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The page is fetched once and its text extracted. Re-run
              &ldquo;Reprocess&rdquo; later to pick up changes.
            </p>
            <Button onClick={submitUrl} disabled={busy}>
              {busy ? <Spinner /> : <LinkIcon />} Fetch and embed
            </Button>
          </TabsContent>

          <TabsContent value="file" className="flex flex-col gap-3 pt-3">
            <Input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.html"
              className="h-auto py-1.5"
            />
            <p className="text-xs text-muted-foreground">
              PDF, plain text, Markdown, CSV, JSON and HTML. Scanned
              image-only PDFs have no extractable text — paste the content
              instead.
            </p>
            <Button onClick={submitFile} disabled={busy}>
              {busy ? <Spinner /> : <UploadIcon />} Upload and embed
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * View a source's full content and the chunks the agents actually retrieve,
 * and edit it in place.
 *
 * The list query only carries a short preview, so the body is fetched with
 * knowledge.get when the dialog opens.
 */
function SourceDialog({
  sourceId,
  agents,
}: {
  sourceId: Id<"knowledgeSources">;
  agents: { _id: Id<"agents">; name: string }[] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Skip the read entirely until the dialog is opened.
  const detail = useQuery(api.knowledge.get, open ? { sourceId } : "skip");
  const updateSource = useMutation(api.knowledge.updateSource);
  const setScope = useMutation(api.knowledge.setScope);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope_] = useState("all");
  // Which source the fields were last filled from, so a fetch fills them once
  // rather than overwriting what is being typed on every re-render.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (detail?.source && loadedFor !== detail.source._id) {
    setLoadedFor(detail.source._id);
    setTitle(detail.source.title);
    setText(detail.source.rawText ?? "");
    setUrl(detail.source.url ?? "");
    setScope_(detail.source.agentId ?? "all");
  }

  const source = detail?.source;
  const editableText = source?.kind === "text" || source?.kind === "faq";

  const save = async () => {
    if (!source) return;
    setSaving(true);
    try {
      const result = await updateSource({
        sourceId,
        title,
        ...(editableText ? { rawText: text } : {}),
        ...(source.kind === "url" ? { url } : {}),
      });
      if ((source.agentId ?? "all") !== scope) {
        await setScope({
          sourceId,
          agentId: scope === "all" ? undefined : (scope as Id<"agents">),
        });
      }
      toast.add({
        title: "Saved",
        description: result.reindexing
          ? "The text changed, so the source is being re-embedded."
          : undefined,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not save",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Re-read from the server next time rather than showing a stale draft.
        if (!next) setLoadedFor(null);
      }}
    >
      <DialogTrigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label="View and edit">
            <PencilSimpleIcon />
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85svh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>View and edit source</DialogTitle>
          <DialogDescription>
            {editableText
              ? "Editing the text re-embeds the source. Retrieval falls back to the other sources until it finishes."
              : "The body comes from the file or URL, so only the title and scope are editable here."}
          </DialogDescription>
        </DialogHeader>

        {detail === undefined ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : !source ? (
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>Source not found</AlertTitle>
            <AlertDescription>It may have been deleted.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[source.status]}>
                {source.status}
              </Badge>
              <Badge variant="outline">{source.kind}</Badge>
              <Badge variant="secondary">
                {detail.chunks.length} embedded{" "}
                {detail.chunks.length === 1 ? "chunk" : "chunks"}
              </Badge>
              <Badge variant="secondary">
                {source.charCount.toLocaleString()} characters
              </Badge>
            </div>

            {source.status === "failed" && source.failureReason ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>Processing failed</AlertTitle>
                <AlertDescription className="font-mono text-xs">
                  {source.failureReason}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="source-title">Title</Label>
                <Input
                  id="source-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Available to</Label>
                <SelectField
                  value={scope}
                  onValueChange={setScope_}
                  options={[
                    { value: "all", label: "Every agent" },
                    ...(agents ?? []).map((agent) => ({
                      value: agent._id as string,
                      label: `Only ${agent.name}`,
                    })),
                  ]}
                />
              </div>
            </div>

            {source.kind === "url" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="source-url">URL</Label>
                <Input
                  id="source-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            ) : null}

            {source.kind === "file" ? (
              <p className="text-xs text-muted-foreground">
                File: <span className="font-mono">{source.filename}</span>
                {source.size
                  ? ` · ${Math.round(source.size / 1024).toLocaleString()} KB`
                  : ""}
              </p>
            ) : null}

            {editableText ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="source-text">Content</Label>
                <Textarea
                  id="source-text"
                  rows={14}
                  className="font-mono"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </div>
            ) : null}

            <Accordion>
              <AccordionItem value="chunks">
                <AccordionTrigger className="text-sm">
                  What the agents retrieve — {detail.chunks.length}{" "}
                  {detail.chunks.length === 1 ? "chunk" : "chunks"}
                </AccordionTrigger>
                <AccordionContent>
                  {detail.chunks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing embedded yet.
                      {source.status === "pending" || source.status === "processing"
                        ? " Processing is still running."
                        : ""}
                    </p>
                  ) : (
                    <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                      {detail.chunks.map((chunk) => (
                        <div
                          key={chunk._id}
                          className="rounded-md border p-2 text-xs"
                        >
                          <p className="mb-1 font-mono text-muted-foreground">
                            #{chunk.order + 1} · {chunk.text.length} chars
                          </p>
                          <p className="whitespace-pre-wrap">{chunk.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !source}>
            {saving ? <Spinner /> : <FloppyDiskIcon />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgePage() {
  const workspace = useWorkspace();
  const sources = useQuery(api.knowledge.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const reprocess = useMutation(api.knowledge.reprocess);
  const removeSource = useMutation(api.knowledge.remove);

  const totalChunks = (sources ?? []).reduce(
    (sum, source) => sum + source.chunkCount,
    0
  );
  const failed = (sources ?? []).filter((s) => s.status === "failed");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Knowledge base
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {totalChunks} chunks across {(sources ?? []).length} sources.
          </p>
        </div>
        <AddSourceDialog />
      </header>

      <Separator />

      {failed.length > 0 ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>
            {failed.length} source{failed.length === 1 ? "" : "s"} failed to
            process
          </AlertTitle>
          <AlertDescription>
            {failed[0].failureReason ?? "See the source below for details."}
          </AlertDescription>
        </Alert>
      ) : null}

      {sources === undefined ? (
        <Spinner />
      ) : sources.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BooksIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing indexed yet</EmptyTitle>
            <EmptyDescription>
              Add the documents your team actually answers from — delivery
              policies, product guidance, pricing rules, tone examples. Without
              them the agent can only work from the workspace description.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddSourceDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {sources.map((source) => {
            const Icon = KIND_ICONS[source.kind];
            return (
              <Item key={source._id} variant="outline">
                <ItemMedia variant="icon">
                  <Icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="flex flex-wrap items-center gap-2">
                    {source.title}
                    <Badge variant={STATUS_VARIANT[source.status]}>
                      {source.status}
                    </Badge>
                    <Badge variant="outline">{source.kind}</Badge>
                    {source.chunkCount > 0 ? (
                      <Badge variant="secondary">
                        {source.chunkCount} chunks
                      </Badge>
                    ) : null}
                    {source.agentName ? (
                      <Badge variant="secondary">
                        only {source.agentName}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1">
                    {source.status === "failed"
                      ? source.failureReason
                      : (source.preview ??
                        source.url ??
                        source.filename ??
                        `${source.charCount.toLocaleString()} characters`)}
                  </ItemDescription>
                </ItemContent>
                <div className="flex gap-1">
                  <SourceDialog sourceId={source._id} agents={agents} />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Reprocess"
                    onClick={async () => {
                      await reprocess({ sourceId: source._id });
                      toast.add({ title: "Reprocessing", type: "info" });
                    }}
                  >
                    <ArrowsClockwiseIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete source"
                    onClick={async () => {
                      await removeSource({ sourceId: source._id });
                      toast.add({ title: "Source deleted", type: "success" });
                    }}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </Item>
            );
          })}
        </ItemGroup>
      )}
    </div>
  );
}
