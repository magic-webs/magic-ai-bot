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
  CardAction,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FunnelIcon,
  RobotIcon,
  PlusIcon,
  SparkleIcon,
  ChatsIcon,
  SlidersIcon,
  SignpostIcon,
  ArrowsSplitIcon,
  WarningIcon,
} from "@phosphor-icons/react";

function NewAgentDialog() {
  const workspace = useWorkspace();
  const router = useRouter();
  const createAgent = useMutation(api.agents.create);
  const draftAgent = useAction(api.ai.draftAgent);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({
    name: "",
    botName: "",
    role: "",
    routingDescription: "",
  });
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
        routingDescription: manual.routingDescription || undefined,
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-routing">Front desk hands over when…</Label>
              <Textarea
                id="agent-routing"
                rows={2}
                value={manual.routingDescription}
                placeholder="the customer wants a quote, a price, or to place an order"
                onChange={(event) =>
                  setManual((prev) => ({
                    ...prev,
                    routingDescription: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                This is the only thing the front desk reads when choosing who
                takes a conversation. You can change it later.
              </p>
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

function FrontDeskCard({
  router,
  specialistCount,
  base,
}: {
  router: {
    _id: string;
    botName: string;
    role: string;
    status: string;
  };
  specialistCount: number;
  base: string;
}) {
  return (
    // shrink-0 is load-bearing. Card carries `overflow-hidden`, and a flex
    // item whose overflow is not visible has an automatic minimum size of
    // zero — so as the only shrinkable child of this page's height-constrained
    // flex column, this card absorbed the entire overflow: it was squashed to
    // its title line, clipping the description and both buttons, and its
    // rounded-4xl corners on a 60px box read as a lozenge.
    //
    // ring, not border: Card's outline is `ring-1 ring-foreground/5`, so the
    // previous `border-primary/40` set a colour on a border that has no width
    // and drew nothing at all.
    <Card className="shrink-0 bg-primary/[0.04] ring-primary/25">
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <SignpostIcon className="size-4" />
          </span>
          <span className="truncate">{router.botName}</span>
          <Badge variant="secondary">Front desk</Badge>
          {/* Beside the name rather than pushed out with ml-auto: this card is
              full width, so on a wide screen that stranded the status badge a
              screenful away from the agent it describes. */}
          <Badge variant={router.status === "active" ? "default" : "secondary"}>
            {router.status}
          </Badge>
        </CardTitle>
        <CardDescription className="max-w-prose">
          Answers first on every channel, works out what the customer needs, then
          hands the conversation to one of your{" "}
          {specialistCount === 1 ? "agent" : `${specialistCount} agents`}. Your
          agents can hand it on to each other from there.
        </CardDescription>
        {/* CardAction flips CardHeader to grid-cols-[1fr_auto] and pins the
            buttons top-right across both rows. Below sm the two columns would
            leave the description a sliver, so they drop to a row of their
            own. */}
        <CardAction className="flex flex-wrap gap-1 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start">
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={`${base}/agents/${router._id}/test`} />}
          >
            <ChatsIcon /> Test routing
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={`${base}/agents/${router._id}`} />}
          >
            <SlidersIcon /> Configure
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

export default function AgentsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const ensureRouter = useMutation(api.agents.ensureDefaultRouter);
  const [provisioning, setProvisioning] = useState(false);

  const router = (agents ?? []).find((agent) => agent.kind === "router");
  const followUpDesk = (agents ?? []).find(
    (agent) => agent.kind === "follow_up"
  );
  // Neither desk is a specialist. An agent with no kind at all predates kinds
  // and is one, which is why this tests for the two exclusions rather than for
  // the word "specialist".
  const specialists = (agents ?? []).filter(
    (agent) => agent.kind !== "router" && agent.kind !== "follow_up"
  );
  const routable = specialists.filter(
    (agent) => agent.status === "active" && agent.acceptsHandoff !== false
  );

  const provision = async () => {
    setProvisioning(true);
    try {
      const result = await ensureRouter({
        workspaceId: workspace._id,
        // The point of a front desk is that everything arrives there, so the
        // existing channels are moved over as part of creating it.
        repointChannels: true,
      });
      toast.add({
        title: "Front desk created",
        description: result.repointed
          ? `${result.repointed} channel(s) now arrive at the front desk, which routes each conversation on.`
          : "Point a channel at it and it will route every new conversation.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not create the front desk",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Agents
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Persona, tone, knowledge scope and tools. The front desk takes every
            new conversation and routes it to the right agent.
          </p>
        </div>
        <NewAgentDialog />
      </header>

      <Separator />

      {router ? (
        <FrontDeskCard
          router={router}
          specialistCount={routable.length}
          base={base}
        />
      ) : specialists.length > 0 ? (
        <Alert>
          <ArrowsSplitIcon />
          <AlertTitle>No front desk yet</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              A front desk answers first on every channel and routes each
              conversation to the agent that should handle it. Without one, each
              channel is stuck with a single agent. Creating it moves your
              existing channels over — you can point any of them back at a
              single agent from the Channels page.
            </span>
            <Button size="lg" onClick={provision} disabled={provisioning}>
              {provisioning ? <Spinner /> : <SignpostIcon />} Create the front
              desk and route my channels
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {followUpDesk ? (
        <Card className="shrink-0 bg-muted/40">
          <CardHeader>
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <FunnelIcon className="size-4" />
              </span>
              <span className="truncate">{followUpDesk.name}</span>
              <Badge variant="secondary">Lead pipeline</Badge>
            </CardTitle>
            <CardDescription className="max-w-prose">
              Reads a conversation an hour after it goes quiet, files it at a
              lead stage and sends one nudge if it is worth sending. It never
              takes a live turn, so it is not in the front desk&apos;s roster
              and cannot be transferred to.
            </CardDescription>
            <CardAction className="flex flex-wrap gap-1 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start">
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href={`${base}/leads`} />}
              >
                <FunnelIcon /> Leads
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href={`${base}/agents/${followUpDesk._id}`} />}
              >
                <SlidersIcon /> Configure
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      ) : null}

      {router && routable.length === 0 && specialists.length > 0 ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>Nothing to route to</AlertTitle>
          <AlertDescription>
            The front desk only hands over to agents that are <em>active</em>.
            Set at least one agent to active, or it will try to answer everything
            itself.
          </AlertDescription>
        </Alert>
      ) : null}

      {agents === undefined ? (
        <CardGridSkeleton count={3} />
      ) : specialists.length === 0 ? (
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
          {specialists.map((agent) => (
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
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {agent.acceptsHandoff === false ? (
                    <span className="italic">
                      Out of routing — only reachable by pointing a channel
                      straight at it.
                    </span>
                  ) : agent.routingDescription?.trim() ? (
                    <>
                      <span className="font-medium text-foreground">
                        Handed over when:{" "}
                      </span>
                      {agent.routingDescription}
                    </>
                  ) : (
                    <span className="italic">
                      No handover rule yet — the front desk has only the role
                      above to go on.
                    </span>
                  )}
                </p>

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
