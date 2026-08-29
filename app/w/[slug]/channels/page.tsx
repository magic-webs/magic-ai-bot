"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { SelectField } from "@/components/select-field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  WhatsappLogoIcon,
  PlusIcon,
  TrashIcon,
  CopyIcon,
  ArrowsClockwiseIcon,
  PencilSimpleIcon,
  WarningIcon,
  InfoIcon,
} from "@phosphor-icons/react";

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-1">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          size="icon"
          variant="outline"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.add({ title: `${label} copied`, type: "success" });
            } catch {
              toast.add({
                title: "Copy failed",
                description: "Select the text and copy it manually.",
                type: "error",
              });
            }
          }}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  );
}

type ChannelForm = {
  name: string;
  agentId: string;
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  wabaId: string;
  businessId: string;
  displayPhoneNumber: string;
  accessToken: string;
};

const emptyForm: ChannelForm = {
  name: "WhatsApp",
  agentId: "",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v23.0",
  phoneNumberId: "",
  wabaId: "",
  businessId: "",
  displayPhoneNumber: "",
  accessToken: "",
};

function ChannelDialog({
  channelId,
  initial,
  trigger,
}: {
  channelId?: Id<"channels">;
  initial?: ChannelForm;
  trigger: React.ReactElement;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const createChannel = useMutation(api.channels.create);
  const updateChannel = useMutation(api.channels.update);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ChannelForm>(initial ?? emptyForm);

  // Derived, not stored, so no effect is needed to backfill it once the agent
  // list arrives.
  const selectedAgentId = form.agentId || agents?.[0]?._id || "";

  const set = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!selectedAgentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    if (!form.phoneNumberId.trim()) {
      toast.add({ title: "A phone number ID is required", type: "error" });
      return;
    }
    if (!channelId && !form.accessToken.trim()) {
      toast.add({ title: "An access token is required", type: "error" });
      return;
    }

    const whatsapp = {
      apiBaseUrl: form.apiBaseUrl.trim(),
      apiVersion: form.apiVersion.trim(),
      phoneNumberId: form.phoneNumberId.trim(),
      wabaId: form.wabaId.trim() || undefined,
      businessId: form.businessId.trim() || undefined,
      displayPhoneNumber: form.displayPhoneNumber.trim() || undefined,
      accessToken: form.accessToken.trim() || undefined,
    };

    setBusy(true);
    try {
      if (channelId) {
        await updateChannel({
          channelId,
          name: form.name,
          agentId: selectedAgentId as Id<"agents">,
          whatsapp,
        });
        toast.add({ title: "Channel updated", type: "success" });
      } else {
        await createChannel({
          workspaceId: workspace._id,
          agentId: selectedAgentId as Id<"agents">,
          type: "whatsapp",
          name: form.name,
          whatsapp,
        });
        toast.add({
          title: "Channel created",
          description:
            "Copy the webhook URL and verify token into Meta, then set it live.",
          type: "success",
        });
        setForm(emptyForm);
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {channelId ? "Edit WhatsApp channel" : "Connect a WhatsApp number"}
          </DialogTitle>
          <DialogDescription>
            These credentials come from your WhatsApp Business Platform app.
            Every channel stores its own set, so one workspace can run several
            numbers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-name">Channel name</Label>
              <Input
                id="c-name"
                value={form.name}
                placeholder="Sales line"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-agent">Agent that answers</Label>
              <SelectField
                id="c-agent"
                className="w-full"
                value={selectedAgentId}
                placeholder="No agents yet"
                onValueChange={(next) => set("agentId", next)}
                options={(agents ?? []).map((agent) => ({
                  value: agent._id as string,
                  label: `${agent.botName} — ${agent.name}`,
                }))}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-phone-id">Phone number ID</Label>
              <Input
                id="c-phone-id"
                className="font-mono"
                value={form.phoneNumberId}
                placeholder="1193127380558970"
                onChange={(event) => set("phoneNumberId", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-display">Display number</Label>
              <Input
                id="c-display"
                value={form.displayPhoneNumber}
                placeholder="+44 20 1234 5678"
                onChange={(event) =>
                  set("displayPhoneNumber", event.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-waba">WABA ID</Label>
              <Input
                id="c-waba"
                className="font-mono"
                value={form.wabaId}
                placeholder="929631712864905"
                onChange={(event) => set("wabaId", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-business">Business ID</Label>
              <Input
                id="c-business"
                className="font-mono"
                value={form.businessId}
                placeholder="137585743854089"
                onChange={(event) => set("businessId", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-token">
              Access token
              {channelId ? (
                <span className="ml-1 font-normal text-muted-foreground">
                  — leave blank to keep the stored one
                </span>
              ) : null}
            </Label>
            <Input
              id="c-token"
              type="password"
              className="font-mono"
              value={form.accessToken}
              placeholder={channelId ? "••••••••" : "EAAG…"}
              onChange={(event) => set("accessToken", event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-base">API base URL</Label>
              <Input
                id="c-base"
                className="font-mono"
                value={form.apiBaseUrl}
                onChange={(event) => set("apiBaseUrl", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Change this if you send through a BSP proxy instead of Meta
                directly.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-version">API version</Label>
              <Input
                id="c-version"
                className="font-mono"
                value={form.apiVersion}
                onChange={(event) => set("apiVersion", event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {channelId ? "Save changes" : "Create channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ChannelsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const channels = useQuery(api.channels.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const updateChannel = useMutation(api.channels.update);
  const rotateKeys = useMutation(api.channels.rotateKeys);
  const removeChannel = useMutation(api.channels.remove);

  // The webhook is served by the Convex deployment, not the Next app, so the
  // URL is public without a tunnel and the access token stays inside Convex.
  const convexSite =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ??
    "";

  const hasAgents = (agents ?? []).length > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Channels
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            WhatsApp numbers, each pointed at an agent.
          </p>
        </div>
        {hasAgents ? (
          <ChannelDialog
            trigger={
              <Button>
                <PlusIcon /> Connect WhatsApp
              </Button>
            }
          />
        ) : null}
      </header>

      <Separator />

      {!hasAgents ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>Create an agent first</AlertTitle>
          <AlertDescription>
            A channel routes messages to one agent, so there has to be one to
            route to.{" "}
            <Link href={`${base}/agents`} className="underline">
              Create an agent
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {channels === undefined ? (
        <Spinner />
      ) : channels.length === 0 ? (
        hasAgents ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WhatsappLogoIcon />
              </EmptyMedia>
              <EmptyTitle>No channels connected</EmptyTitle>
              <EmptyDescription>
                You need the phone number ID, WABA ID and a system-user access
                token from your WhatsApp Business Platform app.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ChannelDialog
                trigger={
                  <Button>
                    <PlusIcon /> Connect WhatsApp
                  </Button>
                }
              />
            </EmptyContent>
          </Empty>
        ) : null
      ) : (
        <div className="flex flex-col gap-4">
          {channels.map((channel) => {
            const webhookUrl = `${convexSite}/whatsapp/${channel.channelKey}`;
            return (
              <Card key={channel._id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <WhatsappLogoIcon className="size-4" />
                    {channel.name}
                    <Badge
                      variant={
                        channel.status === "active"
                          ? "default"
                          : channel.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {channel.status}
                    </Badge>
                    <Badge variant="outline">→ {channel.agentName}</Badge>
                    {channel.whatsapp?.displayPhoneNumber ? (
                      <Badge variant="secondary">
                        {channel.whatsapp.displayPhoneNumber}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {channel.lastInboundAt
                      ? `Last inbound message ${new Date(channel.lastInboundAt).toLocaleString()}`
                      : "No inbound messages received yet."}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                  {channel.lastError ? (
                    <Alert variant="destructive">
                      <WarningIcon />
                      <AlertTitle>Last delivery problem</AlertTitle>
                      <AlertDescription className="font-mono text-xs">
                        {channel.lastError}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <CopyField label="Callback URL" value={webhookUrl} />

                  <Alert>
                    <InfoIcon />
                    <AlertTitle>Wiring this up in Meta</AlertTitle>
                    <AlertDescription>
                      In your app&apos;s WhatsApp → Configuration, set the
                      callback URL above, then subscribe to the{" "}
                      <span className="font-mono">messages</span> field. Meta
                      insists on a verify token — type anything you like, it is
                      not checked. The URL must be publicly reachable, so use a
                      tunnel while developing locally.
                    </AlertDescription>
                  </Alert>

                  <div className="grid gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <p className="uppercase tracking-wide text-muted-foreground">
                        Phone number ID
                      </p>
                      <p className="font-mono">
                        {channel.whatsapp?.phoneNumberId ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide text-muted-foreground">
                        WABA ID
                      </p>
                      <p className="font-mono">
                        {channel.whatsapp?.wabaId ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide text-muted-foreground">
                        Business ID
                      </p>
                      <p className="font-mono">
                        {channel.whatsapp?.businessId ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide text-muted-foreground">
                        Access token
                      </p>
                      <p className="font-mono">
                        {channel.hasAccessToken
                          ? channel.whatsapp?.accessToken
                          : "not set"}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`live-${channel._id}`}
                        checked={channel.status === "active"}
                        onCheckedChange={async (checked) => {
                          await updateChannel({
                            channelId: channel._id,
                            status: checked ? "active" : "paused",
                          });
                          toast.add({
                            title: checked
                              ? "Channel is live"
                              : "Channel paused",
                            type: "success",
                          });
                        }}
                      />
                      <Label
                        htmlFor={`live-${channel._id}`}
                        className="text-sm"
                      >
                        Accept inbound messages
                      </Label>
                    </div>

                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await rotateKeys({ channelId: channel._id });
                          toast.add({
                            title: "New callback URL generated",
                            description:
                              "Update the configuration in Meta or inbound messages will stop.",
                            type: "warning",
                          });
                        }}
                      >
                        <ArrowsClockwiseIcon /> Rotate
                      </Button>
                      <ChannelDialog
                        channelId={channel._id}
                        initial={{
                          name: channel.name,
                          agentId: channel.agentId,
                          apiBaseUrl:
                            channel.whatsapp?.apiBaseUrl ??
                            "https://graph.facebook.com",
                          apiVersion: channel.whatsapp?.apiVersion ?? "v23.0",
                          phoneNumberId:
                            channel.whatsapp?.phoneNumberId ?? "",
                          wabaId: channel.whatsapp?.wabaId ?? "",
                          businessId: channel.whatsapp?.businessId ?? "",
                          displayPhoneNumber:
                            channel.whatsapp?.displayPhoneNumber ?? "",
                          accessToken: "",
                        }}
                        trigger={
                          <Button size="sm" variant="outline">
                            <PencilSimpleIcon /> Edit
                          </Button>
                        }
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete channel"
                        onClick={async () => {
                          await removeChannel({ channelId: channel._id });
                          toast.add({
                            title: "Channel deleted",
                            type: "success",
                          });
                        }}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
