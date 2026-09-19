"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { recordToolNames, suggestPrefix, toHandle } from "@/convex/lib/records";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { ListSkeleton } from "@/components/skeletons";
import {
  ArrowRightIcon,
  BroadcastIcon,
  FolderOpenIcon,
  PlusIcon,
} from "@phosphor-icons/react";

/**
 * A few shapes most businesses turn out to want, so the empty page offers a
 * starting point rather than a blank form. Every one is editable afterwards —
 * these are a first draft of the book, not a template that binds it.
 */
const STARTERS: Array<{
  name: string;
  plural: string;
  purpose: string;
  stages: string[];
  fields: Array<{
    key: string;
    label: string;
    type: "text" | "number" | "select" | "boolean" | "date";
    required: boolean;
    options?: string[];
    example?: string;
  }>;
}> = [
  {
    name: "Membership",
    plural: "Memberships",
    purpose:
      "File one of these when someone signs up, asks to join, or wants to renew.",
    stages: ["Enquired", "Signed up", "Active", "Lapsed"],
    fields: [
      { key: "full_name", label: "Full name", type: "text", required: true },
      { key: "phone", label: "Phone number", type: "text", required: true },
      { key: "email", label: "Email", type: "text", required: false },
      {
        key: "plan",
        label: "Plan",
        type: "select",
        required: true,
        options: ["Monthly", "Quarterly", "Annual"],
      },
      {
        key: "start_date",
        label: "Start date",
        type: "date",
        required: true,
        example: "2026-10-01",
      },
    ],
  },
  {
    name: "Appointment",
    plural: "Appointments",
    purpose:
      "File one of these when someone books a slot, a consultation or a callback.",
    stages: ["Requested", "Confirmed", "Attended", "Cancelled"],
    fields: [
      { key: "full_name", label: "Full name", type: "text", required: true },
      { key: "phone", label: "Phone number", type: "text", required: true },
      {
        key: "service",
        label: "What it is for",
        type: "text",
        required: true,
        example: "First consultation",
      },
      {
        key: "preferred_date",
        label: "Preferred date",
        type: "date",
        required: true,
      },
      {
        key: "preferred_time",
        label: "Preferred time",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Site visit",
    plural: "Site visits",
    purpose:
      "File one of these when a customer wants someone to come out and look at the job.",
    stages: ["Requested", "Scheduled", "Visited", "Quoted"],
    fields: [
      {
        key: "contact_name",
        label: "Contact name",
        type: "text",
        required: true,
      },
      { key: "phone", label: "Phone number", type: "text", required: true },
      { key: "address", label: "Site address", type: "text", required: true },
      {
        key: "job",
        label: "What needs looking at",
        type: "text",
        required: true,
      },
      {
        key: "access_notes",
        label: "Access notes",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Quotation",
    plural: "Quotations",
    purpose:
      "File one of these when a customer asks for a price for work that is not a catalogue order.",
    stages: ["Requested", "Sent", "Accepted", "Declined"],
    fields: [
      {
        key: "contact_name",
        label: "Contact name",
        type: "text",
        required: true,
      },
      { key: "company", label: "Company", type: "text", required: false },
      {
        key: "scope",
        label: "What they want quoted",
        type: "text",
        required: true,
      },
      { key: "budget", label: "Budget", type: "text", required: false },
      { key: "needed_by", label: "Needed by", type: "date", required: false },
    ],
  },
];

function NewBookDialog({ base }: { base: string }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const createBook = useMutation(api.records.createBook);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [plural, setPlural] = useState("");
  const [purpose, setPurpose] = useState("");
  const [saving, setSaving] = useState(false);

  const handle = toHandle(name || "record");
  const tools = recordToolNames(handle);

  const apply = (starter: (typeof STARTERS)[number]) => {
    setName(starter.name);
    setPlural(starter.plural);
    setPurpose(starter.purpose);
  };

  const save = async (starter?: (typeof STARTERS)[number]) => {
    const finalName = (starter?.name ?? name).trim();
    if (!finalName) {
      toast.add({ title: "Give it a name first.", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const created = await createBook({
        workspaceId: workspace._id,
        name: finalName,
        pluralName: starter?.plural ?? (plural.trim() || undefined),
        purpose: starter?.purpose ?? (purpose.trim() || undefined),
        fields: starter?.fields ?? [],
        stages: starter?.stages ?? [],
        referencePrefix: suggestPrefix(finalName),
      });
      setOpen(false);
      setName("");
      setPlural("");
      setPurpose("");
      toast.add({ title: `${finalName} created as a draft.`, type: "success" });
      router.push(`${base}/records/${created.bookId}`);
    } catch (error) {
      toast.add({
        title: error instanceof Error ? error.message : "Could not create it.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon /> New record
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What do you want to keep a record of?</DialogTitle>
          <DialogDescription>
            Name one of them in the singular — a membership, an appointment, a
            site visit. Your agents get a tool named after it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book-name">Name</Label>
            <Input
              id="book-name"
              autoFocus
              value={name}
              placeholder="Membership"
              onChange={(event) => setName(event.target.value)}
            />
            {name.trim() ? (
              <p className="text-xs text-muted-foreground">
                Agents switched on for it will call <code>{tools.file}</code>.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book-plural">Plural</Label>
            <Input
              id="book-plural"
              value={plural}
              placeholder={name.trim() ? `${name.trim()}s` : "Memberships"}
              onChange={(event) => setPlural(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book-purpose">When should an agent file one?</Label>
            <Textarea
              id="book-purpose"
              rows={2}
              value={purpose}
              placeholder="When someone signs up, asks to join, or wants to renew."
              onChange={(event) => setPurpose(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Read by the model. It decides when the tool gets called, so write
              it as an instruction rather than a description.
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label className="text-sm">Or start from one of these</Label>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <Button
                  key={starter.name}
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => apply(starter)}
                >
                  {starter.plural}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Fills the form above, and brings a set of details and stages with
              it. Everything stays editable.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !name.trim()}
            onClick={() => {
              // A starter the person clicked is only a filled-in form until
              // they save — so match on the name they are actually saving.
              const starter = STARTERS.find(
                (candidate) =>
                  candidate.name.toLowerCase() === name.trim().toLowerCase() &&
                  candidate.purpose === purpose
              );
              void save(starter);
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecordsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const books = useQuery(api.records.listBooks, {
    workspaceId: workspace._id,
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Records
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What your agents collect and file: memberships, appointments,
            quotations, site visits — whatever this business keeps. Each one
            becomes a tool your agents can call, and can send its events
            straight to another system.
          </p>
        </div>
        <NewBookDialog base={base} />
      </header>

      <Separator />

      {books === undefined ? (
        <ListSkeleton rows={3} />
      ) : books.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpenIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing recorded yet</EmptyTitle>
            <EmptyDescription>
              Orders are already handled on their own page. This is for
              everything else a conversation produces — someone joining, someone
              booking, someone asking for a price. Name one and your agents can
              start filing them.
            </EmptyDescription>
          </EmptyHeader>
          <NewBookDialog base={base} />
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => {
            const tools = recordToolNames(book.handle);
            return (
              <Card key={book._id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{book.pluralName}</CardTitle>
                    <Badge
                      variant={
                        book.status === "active"
                          ? "default"
                          : book.status === "draft"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {book.status}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {book.purpose || `Records of type “${book.name}”.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      <strong className="text-foreground">
                        {book.recordCountExact
                          ? book.recordCount
                          : `${book.recordCount - 1}+`}
                      </strong>{" "}
                      filed
                    </span>
                    <span>{book.fields.length} details</span>
                    {book.webhookCount > 0 ? (
                      <span className="flex items-center gap-1">
                        <BroadcastIcon className="size-3.5" />
                        {book.webhookCount}
                      </span>
                    ) : null}
                  </div>

                  <code className="truncate rounded bg-muted px-1.5 py-1 text-xs text-muted-foreground">
                    {tools.file}
                  </code>

                  <Button
                    variant="outline"
                    size="lg"
                    className="justify-between"
                    nativeButton={false}
                    render={<Link href={`${base}/records/${book._id}`} />}
                  >
                    Open <ArrowRightIcon />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
