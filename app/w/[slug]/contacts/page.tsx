"use client";

import { useState } from "react";
import Link from "next/link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { TableSkeleton } from "@/components/skeletons";
import {
  UsersIcon,
  WhatsappLogoIcon,
  GlobeIcon,
  PencilSimpleIcon,
  ChatsIcon,
  MagnifyingGlassIcon,
  FloppyDiskIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

/** A contacts row: the document plus the conversation it belongs to. */
type ContactRow = {
  _id: Id<"contacts">;
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  assignedBy?: string;
  assignedTo?: string;
  remark?: string;
  externalId: string;
  channelType: "whatsapp" | "web";
  lastSeenAt: number;
  conversationId: Id<"conversations"> | null;
  messageCount: number;
  handledBy: string | null;
};

// A web visitor's id is a random string, which is no use as a label.
function displayName(contact: ContactRow): string {
  if (contact.name?.trim()) return contact.name;
  if (contact.phone?.trim()) return contact.phone;
  if (contact.channelType === "web") {
    return `Web visitor ${contact.externalId.slice(-4)}`;
  }
  return contact.externalId;
}

function Blank() {
  return <span className="text-muted-foreground">—</span>;
}

// ---------------------------------------------------------------------------

type Draft = {
  name: string;
  phone: string;
  email: string;
  company: string;
  assignedBy: string;
  assignedTo: string;
  remark: string;
};

function ContactDialog({
  contact,
  people,
  trigger,
}: {
  contact: ContactRow;
  /** Names already used for an assignment, offered as suggestions. */
  people: string[];
  trigger: React.ReactElement;
}) {
  const updateContact = useMutation(api.contacts.update);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    name: contact.name ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    company: contact.company ?? "",
    assignedBy: contact.assignedBy ?? "",
    assignedTo: contact.assignedTo ?? "",
    remark: contact.remark ?? "",
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      await updateContact({ contactId: contact._id, ...draft });
      toast.add({ title: "Contact saved", type: "success" });
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

  const listId = `people-${contact._id}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{displayName(contact)}</DialogTitle>
          <DialogDescription>
            Agents pick up the name, phone, email and company when they talk to
            this person. The assignment and remark are for your team only — they
            are never shown to the customer.
          </DialogDescription>
        </DialogHeader>

        {/* Names already in use, so two people do not become "Sam" and "sam". */}
        <datalist id={listId}>
          {people.map((person) => (
            <option key={person} value={person} />
          ))}
        </datalist>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-name">Name</Label>
              <Input
                id="ct-name"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-phone">Phone</Label>
              <Input
                id="ct-phone"
                value={draft.phone}
                onChange={(event) => set("phone", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-email">Email</Label>
              <Input
                id="ct-email"
                type="email"
                value={draft.email}
                onChange={(event) => set("email", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-company">Company</Label>
              <Input
                id="ct-company"
                value={draft.company}
                onChange={(event) => set("company", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-assigned-by">Assigned by</Label>
              <Input
                id="ct-assigned-by"
                list={listId}
                placeholder="Who handed this over"
                value={draft.assignedBy}
                onChange={(event) => set("assignedBy", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-assigned-to">Assigned to</Label>
              <Input
                id="ct-assigned-to"
                list={listId}
                placeholder="Who owns it now"
                value={draft.assignedTo}
                onChange={(event) => set("assignedTo", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-remark">Remark</Label>
            <Textarea
              id="ct-remark"
              rows={3}
              placeholder="Called back Tuesday, wants the 5000L quote by Friday."
              value={draft.remark}
              onChange={(event) => set("remark", event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <FloppyDiskIcon />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export default function ContactsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const contacts = useQuery(api.contacts.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const [search, setSearch] = useState("");

  const term = search.trim().toLowerCase();
  const rows = ((contacts ?? []) as ContactRow[]).filter((contact) => {
    if (!term) return true;
    return [
      contact.name,
      contact.phone,
      contact.email,
      contact.company,
      contact.assignedBy,
      contact.assignedTo,
      contact.remark,
      contact.handledBy,
      contact.externalId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  // Every name anyone has been assigned to or by, so the editor can suggest
  // them instead of inviting a new spelling each time.
  const people = [
    ...new Set(
      ((contacts ?? []) as ContactRow[])
        .flatMap((contact) => [contact.assignedBy, contact.assignedTo])
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    ),
  ].sort();

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Contacts
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          People who have talked to your agents, who owns them, and what your
          team needs to remember.
        </p>
      </header>

      <div className="relative max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          placeholder="Search name, number, owner or remark…"
          className="pl-7"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {contacts === undefined ? (
        <TableSkeleton rows={8} columns={6} />
      ) : rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>
              {term ? "No contacts match" : "No contacts yet"}
            </EmptyTitle>
            <EmptyDescription>
              {term
                ? "Try a different search term."
                : "Contacts appear here once someone talks to your agent on WhatsApp or the website widget."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Name</TableHead>
                <TableHead className="min-w-40">Phone / Email</TableHead>
                <TableHead className="min-w-28">Assigned by</TableHead>
                <TableHead className="min-w-28">Assigned to</TableHead>
                <TableHead className="min-w-28">Handled by</TableHead>
                <TableHead className="min-w-52">Remark</TableHead>
                <TableHead className="min-w-24 text-right">Last seen</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((contact) => (
                <TableRow key={contact._id}>
                  <TableCell className="max-w-56 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="text-muted-foreground"
                        title={
                          contact.channelType === "whatsapp"
                            ? "WhatsApp"
                            : "Website widget"
                        }
                      >
                        {contact.channelType === "whatsapp" ? (
                          <WhatsappLogoIcon className="size-4" />
                        ) : (
                          <GlobeIcon className="size-4" />
                        )}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {displayName(contact)}
                        </span>
                        {contact.company ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {contact.company}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col text-sm">
                      {contact.phone ? <span>{contact.phone}</span> : null}
                      {contact.email ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {contact.email}
                        </span>
                      ) : null}
                      {!contact.phone && !contact.email ? <Blank /> : null}
                    </div>
                  </TableCell>

                  <TableCell className="text-sm">
                    {contact.assignedBy || <Blank />}
                  </TableCell>
                  <TableCell className="text-sm">
                    {contact.assignedTo ? (
                      <Badge variant="secondary">{contact.assignedTo}</Badge>
                    ) : (
                      <Blank />
                    )}
                  </TableCell>

                  <TableCell className="text-sm">
                    {/* Not stored — this is whichever agent the conversation's
                        last handoff left in charge. */}
                    {contact.handledBy ? (
                      <span className="flex items-center gap-1.5">
                        <RobotIcon className="size-3.5 text-muted-foreground" />
                        {contact.handledBy}
                      </span>
                    ) : (
                      <Blank />
                    )}
                  </TableCell>

                  <TableCell className="max-w-64 min-w-0">
                    {contact.remark ? (
                      <span
                        className="line-clamp-2 text-sm text-muted-foreground"
                        title={contact.remark}
                      >
                        {contact.remark}
                      </span>
                    ) : (
                      <Blank />
                    )}
                  </TableCell>

                  <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                    {formatDistanceToNow(contact.lastSeenAt, {
                      addSuffix: true,
                    })}
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {contact.conversationId ? (
                        <Button
                          size="icon-lg"
                          variant="ghost"
                          aria-label={`Open the conversation with ${displayName(contact)}`}
                          title={`Open conversation · ${contact.messageCount} messages`}
                          nativeButton={false}
                          render={
                            <Link
                              href={`${base}/conversations?c=${contact.conversationId}`}
                            />
                          }
                        >
                          <ChatsIcon />
                        </Button>
                      ) : (
                        <Button
                          size="icon-lg"
                          variant="ghost"
                          aria-label="No conversation yet"
                          title="This contact has not sent a message yet"
                          disabled
                        >
                          <ChatsIcon />
                        </Button>
                      )}
                      <ContactDialog
                        contact={contact}
                        people={people}
                        trigger={
                          <Button
                            size="icon-lg"
                            variant="ghost"
                            aria-label={`Edit ${displayName(contact)}`}
                          >
                            <PencilSimpleIcon />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
