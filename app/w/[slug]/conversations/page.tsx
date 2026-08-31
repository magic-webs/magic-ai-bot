"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { TranscriptView } from "@/components/transcript";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import { ListSkeleton } from "@/components/skeletons";
import {
  ChatsIcon,
  WhatsappLogoIcon,
  GlobeIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  EnvelopeIcon,
  PhoneIcon,
  BuildingsIcon,
} from "@phosphor-icons/react";

const STATUS_OPTIONS = [
  { value: "open", label: "open" },
  { value: "escalated", label: "escalated" },
  { value: "closed", label: "closed" },
];

// Auto-generated web session ids are noise in a list; show something readable.
function displayContact(row: {
  contactLabel: string;
  channelType: "whatsapp" | "web";
}): string {
  if (row.channelType === "web" && /^web-[a-z0-9]+$/i.test(row.contactLabel)) {
    return `Web visitor ${row.contactLabel.slice(-4)}`;
  }
  return row.contactLabel;
}

function relative(timestamp: number): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

// ---------------------------------------------------------------------------
// Detail pane — contact facts plus the shared transcript reader.
// ---------------------------------------------------------------------------

function ConversationDetail({
  conversationId,
  onDeleted,
}: {
  conversationId: Id<"conversations">;
  onDeleted: () => void;
}) {
  const detail = useQuery(api.conversations.getWithContact, { conversationId });
  const messages = useQuery(api.conversations.listMessages, { conversationId });
  const setStatus = useMutation(api.conversations.setStatus);
  const removeConversation = useMutation(api.conversations.remove);
  const [showTools, setShowTools] = useState(true);

  if (detail === undefined) {
    return (
      <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading conversation…
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        This conversation no longer exists.
      </div>
    );
  }

  const { conversation, contact, agent } = detail;
  const label = displayContact({
    contactLabel:
      contact?.name ?? contact?.phone ?? contact?.externalId ?? "Unknown",
    channelType: conversation.channelType,
  });

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {conversation.channelType === "whatsapp" ? (
              <WhatsappLogoIcon className="size-3.5 shrink-0" />
            ) : (
              <GlobeIcon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{label}</span>
            <Badge variant="outline">{agent?.botName ?? "— deleted —"}</Badge>
            <Badge
              variant={
                conversation.status === "escalated"
                  ? "destructive"
                  : conversation.status === "closed"
                    ? "secondary"
                    : "default"
              }
            >
              {conversation.status}
            </Badge>
          </p>

          {/* Everything the agent learned about this person. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {contact?.phone ? (
              <span className="flex items-center gap-1">
                <PhoneIcon className="size-3" />
                <span className="font-mono">{contact.phone}</span>
              </span>
            ) : null}
            {contact?.email ? (
              <span className="flex items-center gap-1">
                <EnvelopeIcon className="size-3" />
                <span className="font-mono">{contact.email}</span>
              </span>
            ) : null}
            {contact?.company ? (
              <span className="flex items-center gap-1">
                <BuildingsIcon className="size-3" />
                {contact.company}
              </span>
            ) : null}
            <span>
              {conversation.messageCount} messages · last activity{" "}
              {relative(conversation.lastMessageAt)}
            </span>
            {contact?.externalId ? (
              <span className="font-mono opacity-70">
                {contact.externalId}
              </span>
            ) : null}
          </div>

          {contact?.attributes.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {contact.attributes.map((attribute) => (
                <Badge
                  key={attribute.key}
                  variant="secondary"
                  className="text-xs"
                >
                  {attribute.key}: {attribute.value}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Switch
              id="conv-tools"
              size="sm"
              checked={showTools}
              onCheckedChange={setShowTools}
            />
            <Label htmlFor="conv-tools" className="text-xs">
              Tool trace
            </Label>
          </div>
          <SelectField
            size="sm"
            aria-label="Conversation status"
            value={conversation.status}
            onValueChange={async (next) => {
              await setStatus({
                conversationId,
                status: next as "open" | "escalated" | "closed",
              });
            }}
            options={STATUS_OPTIONS}
          />
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  size="icon-lg"
                  variant="ghost"
                  aria-label="Delete conversation"
                >
                  <TrashIcon />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                <AlertDialogDescription>
                  The transcript with {label} and its tool trace are removed
                  permanently. Any orders it produced are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  render={<Button variant="ghost">Cancel</Button>}
                />
                <AlertDialogAction
                  render={
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        await removeConversation({ conversationId });
                        onDeleted();
                        toast.add({
                          title: "Conversation deleted",
                          type: "success",
                        });
                      }}
                    >
                      Delete permanently
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <TranscriptView
        messages={messages}
        showTools={showTools}
        emptyState={
          <p className="text-sm text-muted-foreground">
            This conversation has no messages yet.
          </p>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------

export default function ConversationsPage() {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });

  // ?c=<id> opens straight onto one thread — the Contacts table links here.
  // Read once, as the initial selection: after that the list owns the choice, so
  // clicking another thread is not fighting the URL.
  const requested = useSearchParams().get("c");

  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Id<"conversations"> | null>(
    requested ? (requested as Id<"conversations">) : null
  );

  const conversations = useQuery(api.conversations.listByWorkspace, {
    workspaceId: workspace._id,
    agentId: agentFilter === "all" ? undefined : (agentFilter as Id<"agents">),
    limit: 200,
  });

  const term = search.trim().toLowerCase();
  const rows = (conversations ?? []).filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (!term) return true;
    return [
      row.contactLabel,
      row.contactExternalId ?? "",
      row.agentName,
      row.activeAgentName,
      row.lastMessagePreview ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  // Derived rather than stored: keeps a conversation open by default, and
  // falls back gracefully when the current selection is filtered out or deleted.
  const active = rows.find((row) => row._id === selected) ?? rows[0];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Conversations
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Threads across WhatsApp and the web playground.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="conv-agent" className="text-sm">
            Agent
          </Label>
          <SelectField
            id="conv-agent"
            value={agentFilter}
            onValueChange={setAgentFilter}
            options={[
              { value: "all", label: "All agents" },
              ...(agents ?? []).map((agent) => ({
                value: agent._id as string,
                label: agent.botName,
              })),
            ]}
          />
          <Label htmlFor="conv-status" className="text-sm">
            Status
          </Label>
          <SelectField
            id="conv-status"
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, ...STATUS_OPTIONS]}
          />
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* List — capped on narrow screens so the transcript stays visible. */}
        <div className="flex max-h-[45vh] min-h-0 shrink-0 flex-col border-b lg:max-h-none lg:w-[22rem] lg:border-b-0 lg:border-r">
          <div className="shrink-0 p-3 pb-2">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                placeholder="Search contact or message…"
                className="pl-7"
                aria-label="Search conversations"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {conversations === undefined ? (
              <ListSkeleton rows={7} />
            ) : rows.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ChatsIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {conversations.length === 0
                      ? "No conversations"
                      : "Nothing matches"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {conversations.length === 0
                      ? "Test an agent in the web playground or send a WhatsApp message to a connected number."
                      : "Try a different search term or filter."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-1.5">
                {rows.map((row) => {
                  const isActive = row._id === active?._id;
                  return (
                    <Item
                      key={row._id}
                      // A real button, so the list is keyboard navigable.
                      render={<button type="button" />}
                      variant="outline"
                      size="sm"
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "w-full cursor-pointer text-left hover:bg-muted/50",
                        isActive &&
                          "border-primary/60 bg-muted hover:bg-muted"
                      )}
                      onClick={() => setSelected(row._id)}
                    >
                      <ItemMedia variant="icon">
                        {row.channelType === "whatsapp" ? (
                          <WhatsappLogoIcon />
                        ) : (
                          <GlobeIcon />
                        )}
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="flex w-full min-w-0 items-center gap-1.5">
                          <span className="truncate">
                            {displayContact(row)}
                          </span>
                          {row.status !== "open" ? (
                            <Badge
                              variant={
                                row.status === "escalated"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="shrink-0"
                            >
                              {row.status}
                            </Badge>
                          ) : null}
                          <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                            {relative(row.lastMessageAt)}
                          </span>
                        </ItemTitle>
                        <ItemDescription className="line-clamp-2">
                          {row.lastMessagePreview ?? "No messages"}
                        </ItemDescription>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {/* Two names once the front desk has routed it on:
                              where it arrived, and who has it now. */}
                          {row.handedOff
                            ? `${row.agentName} → ${row.activeAgentName}`
                            : row.agentName}{" "}
                          · {row.messageCount} messages
                        </p>
                      </ItemContent>
                    </Item>
                  );
                })}
              </ItemGroup>
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {conversations === undefined
                ? null
                : "Select a conversation to read the transcript."}
            </div>
          ) : (
            <ConversationDetail
              key={active._id}
              conversationId={active._id}
              onDeleted={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
