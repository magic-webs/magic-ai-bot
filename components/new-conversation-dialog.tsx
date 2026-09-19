"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { ContactAvatar } from "@/components/contact-avatar";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  GlobeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";

/**
 * Open a thread with somebody the workspace already knows.
 *
 * Deliberately not a "new contact" form. A conversation is a channel address
 * plus an agent, and both of those already exist on the Contacts table and the
 * Agents page — inventing a third place to type a phone number would give you
 * two records for the same person the first time a digit is mistyped. So this
 * picks from what is there and leaves the first message to the composer, which
 * already knows what WhatsApp will and will not deliver.
 */
export function NewConversationDialog({
  onStarted,
}: {
  /** Put the thread on screen once it exists. */
  onStarted: (conversationId: Id<"conversations">) => void;
}) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  // Only subscribe to the contact book once somebody asks for it: it is every
  // contact in the workspace, and the inbox does not otherwise need it.
  const contacts = useQuery(
    api.contacts.listByWorkspace,
    open ? { workspaceId: workspace._id } : "skip"
  );
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const start = useMutation(api.conversations.startFromContact);

  const [term, setTerm] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [starting, setStarting] = useState(false);

  // Drafts never receive traffic, and the follow-up desk is not somebody you
  // hand a live thread to.
  const roster = (agents ?? []).filter(
    (agent) => agent.status !== "draft" && agent.kind !== "follow_up"
  );
  const chosenAgent = agentId || roster[0]?._id || "";

  const search = term.trim().toLowerCase();
  const rows = (contacts ?? []).filter((contact) => {
    if (!search) return true;
    return [contact.name, contact.phone, contact.email, contact.externalId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search);
  });

  const submit = async () => {
    if (!contactId || !chosenAgent || starting) return;
    setStarting(true);
    try {
      const result = await start({
        contactId: contactId as Id<"contacts">,
        agentId: chosenAgent as Id<"agents">,
      });
      onStarted(result.conversationId);
      setOpen(false);
      setTerm("");
      setContactId("");
      toast.add({
        title: result.created
          ? "Conversation started"
          : "That thread already existed",
        description: result.created
          ? "Write the first message below."
          : "Opened it rather than starting a second one.",
        type: "success",
      });
    } catch (caught) {
      toast.add({
        title: "Could not start the conversation",
        description: caught instanceof Error ? caught.message : String(caught),
        type: "error",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon /> New conversation
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Pick somebody the workspace already has a record of, and the agent
            that should hold the thread. Nothing is sent until you write a
            message.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              placeholder="Search by name, number or email…"
              className="pl-7"
              aria-label="Search contacts"
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>

          <div className="max-h-64 min-h-32 overflow-y-auto rounded-lg border">
            {contacts === undefined ? (
              <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Spinner /> Loading contacts…
              </p>
            ) : rows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {contacts.length === 0
                  ? "No contacts yet. One is created the first time somebody writes in."
                  : "Nothing matches that."}
              </p>
            ) : (
              <div className="divide-y">
                {rows.map((contact) => {
                  const label =
                    contact.name ?? contact.phone ?? contact.externalId;
                  const picked = contact._id === contactId;
                  return (
                    <button
                      key={contact._id}
                      type="button"
                      aria-pressed={picked}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors",
                        picked ? "bg-primary/10" : "hover:bg-muted/60"
                      )}
                      onClick={() => setContactId(contact._id)}
                    >
                      <ContactAvatar
                        label={label}
                        channelType={contact.channelType}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {contact.phone ?? contact.email ?? contact.externalId}
                        </span>
                      </span>
                      {contact.channelType === "whatsapp" ? (
                        <WhatsappLogoIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-conv-agent">Held by</Label>
            <SelectField
              id="new-conv-agent"
              value={chosenAgent}
              onValueChange={setAgentId}
              placeholder="Pick an agent"
              options={roster.map((agent) => ({
                value: agent._id as string,
                label:
                  agent.kind === "router"
                    ? `${agent.botName} · front desk`
                    : agent.botName,
              }))}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            disabled={!contactId || !chosenAgent || starting}
            onClick={() => void submit()}
          >
            {starting ? <Spinner /> : null} Open thread
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
