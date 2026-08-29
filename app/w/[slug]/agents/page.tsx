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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
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
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            Agents
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each agent has its own persona, job description, tone, knowledge
            scope and tool permissions.
          </p>
        </div>
        <NewAgentDialog />
      </header>

      <Separator />

      {agents === undefined ? (
        <Spinner />
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
        <ItemGroup className="gap-2">
          {agents.map((agent) => (
            <Item key={agent._id} variant="outline">
              <ItemMedia variant="icon">
                <RobotIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="flex flex-wrap items-center gap-2">
                  {agent.botName}
                  <span className="text-muted-foreground">· {agent.role}</span>
                  <Badge
                    variant={agent.status === "active" ? "default" : "secondary"}
                  >
                    {agent.status}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {agent.model}
                  </Badge>
                </ItemTitle>
                <ItemDescription className="line-clamp-2">
                  {agent.objective}
                </ItemDescription>
                <div className="mt-1 flex flex-wrap gap-1">
                  {agent.builtinTools.map((toolKey) => (
                    <Badge
                      key={toolKey}
                      variant="secondary"
                      className="font-mono text-xs"
                    >
                      {toolKey}
                    </Badge>
                  ))}
                </div>
              </ItemContent>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`${base}/agents/${agent._id}/test`} />}
                >
                  <ChatsIcon /> Test
                </Button>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`${base}/agents/${agent._id}`} />}
                >
                  <SlidersIcon /> Configure
                </Button>
              </div>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
