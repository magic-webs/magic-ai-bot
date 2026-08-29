"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { KeyValueEditor, type KeyValue } from "@/components/editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { ListSkeleton } from "@/components/skeletons";
import {
  WrenchIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  PencilSimpleIcon,
  GlobeIcon,
  DatabaseIcon,
  InfoIcon,
  XIcon,
} from "@phosphor-icons/react";

type ToolParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enumValues?: string[];
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

// ---------------------------------------------------------------------------
// Parameter editor — these become the tool's JSON Schema
// ---------------------------------------------------------------------------

function ParametersEditor({
  value,
  onChange,
}: {
  value: ToolParameter[];
  onChange: (next: ToolParameter[]) => void;
}) {
  const patch = (index: number, next: Partial<ToolParameter>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label className="text-sm font-medium">Parameters</Label>
        <p className="mt-0.5 text-sm text-muted-foreground">
          These become the tool&apos;s input schema. The model reads each
          description to decide what to pass, so be unambiguous.
        </p>
      </div>

      {value.map((parameter, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-md border border-border p-2"
        >
          <div className="flex gap-2">
            <Input
              className="w-44 font-mono"
              value={parameter.name}
              placeholder="postcode"
              onChange={(event) => patch(index, { name: event.target.value })}
            />
            <SelectField
              className="w-28"
              aria-label="Parameter type"
              value={parameter.type}
              onValueChange={(next) =>
                patch(index, { type: next as ToolParameter["type"] })
              }
              options={[
                { value: "string", label: "string" },
                { value: "number", label: "number" },
                { value: "boolean", label: "boolean" },
              ]}
            />
            <div className="flex items-center gap-1.5">
              <Switch
                size="sm"
                checked={parameter.required}
                onCheckedChange={(checked) =>
                  patch(index, { required: checked })
                }
              />
              <span className="text-xs text-muted-foreground">
                required
              </span>
            </div>
            <Button
              size="icon-lg"
              variant="ghost"
              aria-label="Remove parameter"
              className="ml-auto"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <XIcon />
            </Button>
          </div>
          <Input
            value={parameter.description}
            placeholder="The UK delivery postcode, e.g. SW1A 1AA"
            onChange={(event) =>
              patch(index, { description: event.target.value })
            }
          />
          {parameter.type === "string" ? (
            <Input
              value={(parameter.enumValues ?? []).join(", ")}
              placeholder="Optional fixed values, comma separated"
              onChange={(event) =>
                patch(index, {
                  enumValues: event.target.value
                    .split(",")
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : null}
        </div>
      ))}

      <Button
        variant="outline"
        size="lg"
        className="self-start"
        onClick={() =>
          onChange([
            ...value,
            { name: "", type: "string", description: "", required: true },
          ])
        }
      >
        <PlusIcon /> Add parameter
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft a tool from a task description
// ---------------------------------------------------------------------------

function DraftToolDialog() {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const draftTool = useAction(api.ai.draftTool);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState("");
  const [apiHint, setApiHint] = useState("");
  const [scope, setScope] = useState("all");
  const [autoEnable, setAutoEnable] = useState(false);
  const [result, setResult] = useState<{
    name: string;
    kind: string;
    status: string;
    notesForHuman: string;
  } | null>(null);

  const run = async () => {
    if (task.trim().length < 10) {
      toast.add({
        title: "Describe the task in a bit more detail",
        type: "error",
      });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const drafted = await draftTool({
        workspaceId: workspace._id,
        agentId: scope === "all" ? undefined : (scope as Id<"agents">),
        task,
        apiHint: apiHint.trim() || undefined,
        autoEnable,
      });
      setResult(drafted);
      toast.add({
        title: `${drafted.name} created`,
        description:
          drafted.status === "enabled"
            ? "Enabled and available to the agent now."
            : "Saved as a draft — review it before enabling.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Drafting failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <SparkleIcon /> Create from a task
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Build a tool from a task description</DialogTitle>
          <DialogDescription>
            Describe what the agent needs to be able to do. The model designs the
            tool: name, description, parameters and either an HTTP request or a
            read-only query against this workspace&apos;s data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-task">The task</Label>
            <Textarea
              id="t-task"
              rows={4}
              value={task}
              placeholder="Check whether we deliver to a given UK postcode and how many working days it takes."
              onChange={(event) => setTask(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-hint">
              API details{" "}
              <span className="font-normal text-muted-foreground">
                — optional
              </span>
            </Label>
            <Textarea
              id="t-hint"
              rows={3}
              className="font-mono"
              value={apiHint}
              placeholder={`GET https://api.example.com/v1/delivery?postcode={postcode}\nHeader: Authorization: Bearer <token>`}
              onChange={(event) => setApiHint(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Paste an endpoint, a curl command or the docs. Without this the
              model will either query workspace data or leave a placeholder URL
              for you to fill in.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-scope">Available to</Label>
              <SelectField
                id="t-scope"
                className="w-full"
                value={scope}
                onValueChange={setScope}
                options={[
                  { value: "all", label: "Every agent" },
                  ...(agents ?? []).map((agent) => ({
                    value: agent._id as string,
                    label: `Only ${agent.botName}`,
                  })),
                ]}
              />
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
                <Switch
                  id="t-auto"
                  checked={autoEnable}
                  onCheckedChange={setAutoEnable}
                />
                <Label htmlFor="t-auto" className="text-sm">
                  Enable immediately
                </Label>
              </div>
            </div>
          </div>

          {result ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>
                <span className="font-mono">{result.name}</span> ·{" "}
                {result.kind} · {result.status}
              </AlertTitle>
              <AlertDescription>{result.notesForHuman}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Spinner /> : <SparkleIcon />} Design the tool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Manual create / edit
// ---------------------------------------------------------------------------

type ToolForm = {
  displayName: string;
  name: string;
  description: string;
  whenToUse: string;
  kind: "http" | "db_query";
  parameters: ToolParameter[];
  method: HttpMethod;
  urlTemplate: string;
  headers: KeyValue[];
  bodyTemplate: string;
  table: "products" | "orders" | "contacts";
  searchParam: string;
  limit: number;
  scope: string;
  status: "draft" | "enabled" | "disabled";
};

function toolToForm(tool?: Doc<"tools">): ToolForm {
  return {
    displayName: tool?.displayName ?? "",
    name: tool?.name ?? "",
    description: tool?.description ?? "",
    whenToUse: tool?.whenToUse ?? "",
    kind: tool?.kind ?? "http",
    parameters: tool?.parameters ?? [],
    method: (tool?.http?.method ?? "GET") as HttpMethod,
    urlTemplate: tool?.http?.urlTemplate ?? "",
    headers: tool?.http?.headers ?? [],
    bodyTemplate: tool?.http?.bodyTemplate ?? "",
    table: tool?.dbQuery?.table ?? "products",
    searchParam: tool?.dbQuery?.searchParam ?? "",
    limit: tool?.dbQuery?.limit ?? 8,
    scope: tool?.agentId ?? "all",
    status: tool?.status ?? "draft",
  };
}

function ToolDialog({
  tool,
  trigger,
}: {
  tool?: Doc<"tools">;
  trigger: React.ReactElement;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const createTool = useMutation(api.tools.create);
  const updateTool = useMutation(api.tools.update);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ToolForm>(() => toolToForm(tool));

  const set = <K extends keyof ToolForm>(key: K, value: ToolForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.displayName.trim() && !form.name.trim()) {
      toast.add({ title: "Give the tool a name", type: "error" });
      return;
    }
    if (!form.description.trim()) {
      toast.add({
        title: "A description is required",
        description: "It is how the model decides whether to call the tool.",
        type: "error",
      });
      return;
    }
    if (form.kind === "http" && !form.urlTemplate.trim()) {
      toast.add({ title: "An HTTP tool needs a URL", type: "error" });
      return;
    }

    const parameters = form.parameters.filter((p) => p.name.trim());
    const http =
      form.kind === "http"
        ? {
            method: form.method,
            urlTemplate: form.urlTemplate.trim(),
            headers: form.headers.filter((h) => h.key.trim()),
            bodyTemplate: form.bodyTemplate.trim() || undefined,
            timeoutMs: 12000,
          }
        : undefined;
    const dbQuery =
      form.kind === "db_query"
        ? {
            table: form.table,
            searchParam: form.searchParam.trim() || undefined,
            limit: form.limit,
          }
        : undefined;

    setBusy(true);
    try {
      if (tool) {
        await updateTool({
          toolId: tool._id,
          displayName: form.displayName,
          description: form.description,
          whenToUse: form.whenToUse || undefined,
          parameters,
          http,
          dbQuery,
          status: form.status,
          agentId:
            form.scope === "all" ? undefined : (form.scope as Id<"agents">),
          clearAgentScope: form.scope === "all",
        });
        toast.add({ title: "Tool updated", type: "success" });
      } else {
        await createTool({
          workspaceId: workspace._id,
          agentId:
            form.scope === "all" ? undefined : (form.scope as Id<"agents">),
          name: form.name || form.displayName,
          displayName: form.displayName || form.name,
          description: form.description,
          whenToUse: form.whenToUse || undefined,
          kind: form.kind,
          parameters,
          http,
          dbQuery,
          status: form.status,
          origin: "manual",
        });
        toast.add({ title: "Tool created", type: "success" });
        setForm(toolToForm());
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {tool ? `Edit ${tool.name}` : "Create a tool manually"}
          </DialogTitle>
          <DialogDescription>
            HTTP tools call an external endpoint. Database tools run a read-only
            query scoped to this workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-display">Display name</Label>
              <Input
                id="tf-display"
                value={form.displayName}
                placeholder="Check delivery postcode"
                onChange={(event) => set("displayName", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-name">
                Tool name{" "}
                <span className="font-normal text-muted-foreground">
                  {tool ? "— fixed once created" : "— snake_case"}
                </span>
              </Label>
              <Input
                id="tf-name"
                className="font-mono"
                disabled={Boolean(tool)}
                value={form.name}
                placeholder="check_delivery_postcode"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tf-description">Description the model reads</Label>
            <Textarea
              id="tf-description"
              rows={2}
              value={form.description}
              placeholder="Check whether we deliver to a UK postcode and how many working days it takes."
              onChange={(event) => set("description", event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tf-when">When to use it</Label>
            <Input
              id="tf-when"
              value={form.whenToUse}
              placeholder="Call it as soon as the customer gives a postcode."
              onChange={(event) => set("whenToUse", event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-kind">Kind</Label>
              <SelectField
                id="tf-kind"
                className="w-full"
                disabled={Boolean(tool)}
                value={form.kind}
                onValueChange={(next) => set("kind", next as ToolForm["kind"])}
                options={[
                  { value: "http", label: "HTTP request" },
                  { value: "db_query", label: "Workspace data query" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-scope">Available to</Label>
              <SelectField
                id="tf-scope"
                className="w-full"
                value={form.scope}
                onValueChange={(next) => set("scope", next)}
                options={[
                  { value: "all", label: "Every agent" },
                  ...(agents ?? []).map((agent) => ({
                    value: agent._id as string,
                    label: `Only ${agent.botName}`,
                  })),
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-status">Status</Label>
              <SelectField
                id="tf-status"
                className="w-full"
                value={form.status}
                onValueChange={(next) =>
                  set("status", next as ToolForm["status"])
                }
                options={[
                  { value: "draft", label: "Draft — not given to the model" },
                  { value: "enabled", label: "Enabled" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
            </div>
          </div>

          <Separator />

          <ParametersEditor
            value={form.parameters}
            onChange={(next) => set("parameters", next)}
          />

          <Separator />

          {form.kind === "http" ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <SelectField
                  className="w-28"
                  aria-label="HTTP method"
                  value={form.method}
                  onValueChange={(next) => set("method", next as HttpMethod)}
                  options={HTTP_METHODS.map((method) => ({
                    value: method as string,
                    label: method,
                  }))}
                />
                <Input
                  className="flex-1 font-mono"
                  value={form.urlTemplate}
                  placeholder="https://api.example.com/delivery?postcode={{postcode}}"
                  onChange={(event) => set("urlTemplate", event.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code>{"{{parameter_name}}"}</code> placeholders. Any
                parameter not referenced in the URL or body is appended as a
                query parameter.
              </p>

              <KeyValueEditor
                label="Headers"
                description="Values also support {{parameter}} placeholders."
                value={form.headers}
                onChange={(next) => set("headers", next)}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer …"
              />

              {form.method !== "GET" && form.method !== "DELETE" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tf-body">Request body</Label>
                  <Textarea
                    id="tf-body"
                    rows={4}
                    className="font-mono"
                    value={form.bodyTemplate}
                    placeholder={`{ "postcode": "{{postcode}}" }`}
                    onChange={(event) =>
                      set("bodyTemplate", event.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to send the model&apos;s arguments as JSON.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tf-table">Table</Label>
                <SelectField
                  id="tf-table"
                  className="w-full"
                  value={form.table}
                  onValueChange={(next) =>
                    set("table", next as ToolForm["table"])
                  }
                  options={[
                    { value: "products", label: "products" },
                    { value: "orders", label: "orders" },
                    { value: "contacts", label: "contacts" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tf-search">Search parameter</Label>
                <Input
                  id="tf-search"
                  className="font-mono"
                  value={form.searchParam}
                  placeholder="query"
                  onChange={(event) => set("searchParam", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tf-limit">Row limit</Label>
                <Input
                  id="tf-limit"
                  value={String(form.limit)}
                  onChange={(event) =>
                    set("limit", Number(event.target.value) || 8)
                  }
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {tool ? "Save changes" : "Create tool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export default function ToolsPage() {
  const workspace = useWorkspace();
  const tools = useQuery(api.tools.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const updateTool = useMutation(api.tools.update);
  const removeTool = useMutation(api.tools.remove);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Custom tools
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            APIs and data queries your agents can call. Only{" "}
            <strong>enabled</strong> tools reach the model.
          </p>
        </div>
        <div className="flex gap-2">
          <ToolDialog
            trigger={
              <Button variant="outline">
                <PlusIcon /> Manual
              </Button>
            }
          />
          <DraftToolDialog />
        </div>
      </header>

      <Separator />

      {tools === undefined ? (
        <ListSkeleton rows={4} />
      ) : tools.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WrenchIcon />
            </EmptyMedia>
            <EmptyTitle>No custom tools yet</EmptyTitle>
            <EmptyDescription>
              Describe a task in plain language — &ldquo;check whether we deliver
              to a postcode&rdquo; — and the model will design the tool,
              parameters and request for you to review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <DraftToolDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {tools.map((tool) => (
            <Item key={tool._id} variant="outline">
              <ItemMedia variant="icon">
                {tool.kind === "http" ? <GlobeIcon /> : <DatabaseIcon />}
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{tool.name}</span>
                  <span className="text-muted-foreground">
                    {tool.displayName}
                  </span>
                  <Badge
                    variant={
                      tool.status === "enabled"
                        ? "default"
                        : tool.status === "draft"
                          ? "secondary"
                          : "ghost"
                    }
                  >
                    {tool.status}
                  </Badge>
                  <Badge variant="outline">{tool.kind}</Badge>
                  {tool.origin === "ai_drafted" ? (
                    <Badge variant="secondary">
                      <SparkleIcon /> AI drafted
                    </Badge>
                  ) : null}
                  {tool.agentName ? (
                    <Badge variant="secondary">only {tool.agentName}</Badge>
                  ) : null}
                  {tool.callCount > 0 ? (
                    <Badge variant="ghost">{tool.callCount} calls</Badge>
                  ) : null}
                </ItemTitle>
                <ItemDescription className="line-clamp-2">
                  {tool.description}
                </ItemDescription>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {tool.parameters.map((parameter) => (
                    <Badge
                      key={parameter.name}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {parameter.name}
                      {parameter.required ? "*" : ""}: {parameter.type}
                    </Badge>
                  ))}
                  {tool.kind === "http" && tool.http ? (
                    <span className="ml-1 truncate font-mono text-xs text-muted-foreground">
                      {tool.http.method} {tool.http.urlTemplate}
                    </span>
                  ) : null}
                  {tool.kind === "db_query" && tool.dbQuery ? (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      SELECT … FROM {tool.dbQuery.table} LIMIT{" "}
                      {tool.dbQuery.limit}
                    </span>
                  ) : null}
                </div>
                {tool.sourceTask ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drafted from: &ldquo;{tool.sourceTask}&rdquo;
                  </p>
                ) : null}
              </ItemContent>

              <div className="flex items-center gap-2">
                <Switch
                  aria-label={`Enable ${tool.name}`}
                  checked={tool.status === "enabled"}
                  onCheckedChange={async (checked) => {
                    await updateTool({
                      toolId: tool._id,
                      status: checked ? "enabled" : "disabled",
                    });
                  }}
                />
                <ToolDialog
                  tool={tool}
                  trigger={
                    <Button
                      size="icon-lg"
                      variant="ghost"
                      aria-label={`Edit ${tool.name}`}
                    >
                      <PencilSimpleIcon />
                    </Button>
                  }
                />
                <Button
                  size="icon-lg"
                  variant="ghost"
                  aria-label={`Delete ${tool.name}`}
                  onClick={async () => {
                    await removeTool({ toolId: tool._id });
                    toast.add({ title: "Tool deleted", type: "success" });
                  }}
                >
                  <TrashIcon />
                </Button>
              </div>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
