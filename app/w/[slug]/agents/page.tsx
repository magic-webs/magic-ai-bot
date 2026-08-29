"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { CardGridSkeleton } from "@/components/skeletons";
import {
  RobotIcon,
  PlusIcon,
  SparkleIcon,
  ChatsIcon,
  SlidersIcon,
} from "@phosphor-icons/react";

function NewAgentDialog() {
  const workspace = useWorkspace();
  const router = useRouter();
  const createAgent = useMutation(api.agents.create);
  const draftAgent = useAction(api.ai.draftAgent);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ name: "", botName: "", role: "" });
  const [brief, setBrief] = useState("");

  const base = `/w/${workspace.slug}`;

  const createManual = async () => {
    if (!manual.name.trim()) {
      toast.add({ title: "Give the agent a name", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const agentId = await createAgent({
        workspaceId: workspace._id,
        name: manual.name,
        botName: manual.botName || undefined,
        role: manual.role || undefined,
      });
      setOpen(false);
      router.push(`${base}/agents/${agentId}`);
    } catch (error) {
      toast.add({
        title: "Could not create the agent",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const createFromBrief = async () => {
    if (brief.trim().length < 20) {
      toast.add({
        title: "Describe the job in a bit more detail",
        description: "A sentence or two about what this agent should do.",
        type: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const { agentId, draft } = await draftAgent({
        workspaceId: workspace._id,
        brief,
      });
      toast.add({
        title: `${draft.botName} drafted`,
        description: "Review the configuration, then set it to active.",
        type: "success",
      });
      setOpen(false);
      if (agentId) router.push(`${base}/agents/${agentId}`);
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
      <DialogTrigger render={<Button><PlusIcon /> New agent</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Describe the job and let the model draft the whole configuration, or
            start from a blank agent.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="draft">
          <TabsList className="w-full">
            <TabsTrigger value="draft">
              <SparkleIcon /> Draft from a brief
            </TabsTrigger>
            <TabsTrigger value="manual">
              <SlidersIcon /> Blank agent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draft" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brief">What should this agent do?</Label>
              <Textarea
                id="brief"
                rows={5}
                value={brief}
                placeholder="Qualify inbound printing enquiries on WhatsApp. Find out the product, quantity and specs, never quote a price, collect delivery details, then hand a complete enquiry to the sales team."
                onChange={(event) => setBrief(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The draft uses this workspace&apos;s description, facts and
                catalogue as context.
              </p>
            </div>
            <Button onClick={createFromBrief} disabled={busy}>
              {busy ? <Spinner /> : <SparkleIcon />} Draft the agent
            </Button>
          </TabsContent>

          <TabsContent value="manual" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name">Internal name</Label>
              <Input
                id="agent-name"
                value={manual.name}
                placeholder="Sales qualifier"
                onChange={(event) =>
                  setManual((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bot-name">Name customers see</Label>
                <Input
                  id="bot-name"
                  value={manual.botName}
                  placeholder="John"
                  onChange={(event) =>
                    setManual((prev) => ({
                      ...prev,
                      botName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-role">Role</Label>
                <Input
                  id="agent-role"
                  value={manual.role}
                  placeholder="AI Sales Consultant"
                  onChange={(event) =>
                    setManual((prev) => ({ ...prev, role: event.target.value }))
                  }
                />
              </div>
            </div>
            <Button onClick={createManual} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Create agent
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Agents
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Persona, tone, knowledge scope and tools.
          </p>
        </div>
        <NewAgentDialog />
      </header>

      <Separator />

      {agents === undefined ? (
        <CardGridSkeleton count={3} />
      ) : agents.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RobotIcon />
            </EmptyMedia>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>
              Describe the job in a sentence and the model will draft the
              persona, tone, rules and guardrails for you to review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewAgentDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent._id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex min-w-0 items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <RobotIcon className="size-4" />
                  </span>
                  <span className="truncate">{agent.botName}</span>
                  <Badge
                    variant={agent.status === "active" ? "default" : "secondary"}
                    className="ml-auto shrink-0"
                  >
                    {agent.status}
                  </Badge>
                </CardTitle>
                <CardDescription className="line-clamp-1">
                  {agent.role}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap gap-1">
                  {/* Capped: an agent with six tools would otherwise make its
                      card twice the height of its neighbours in the grid. */}
                  {agent.builtinTools.slice(0, 3).map((toolKey) => (
                    <Badge
                      key={toolKey}
                      variant="secondary"
                      className="font-mono"
                    >
                      {toolKey}
                    </Badge>
                  ))}
                  {agent.builtinTools.length > 3 ? (
                    <Badge variant="ghost" className="text-muted-foreground">
                      +{agent.builtinTools.length - 3} more
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-auto flex gap-1 pt-1">
                  <Button
                    size="lg"
                    variant="outline"
                    className="flex-1"
                    nativeButton={false}
                    render={<Link href={`${base}/agents/${agent._id}/test`} />}
                  >
                    <ChatsIcon /> Test
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1"
                    nativeButton={false}
                    render={<Link href={`${base}/agents/${agent._id}`} />}
                  >
                    <SlidersIcon /> Configure
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
