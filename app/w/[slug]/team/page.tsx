"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { AgentAvatar } from "@/components/agent-avatar";
import { TeamAvatar } from "@/components/team-avatar";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ChatsIcon,
  DotsThreeIcon,
  PlusIcon,
  RobotIcon,
  SlidersIcon,
  UploadSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

/**
 * The team — the agents and the people, on one page.
 *
 * Two tabs over one idea: a workspace is answered by a roster, and some of
 * that roster is software. The cards are the same shape on both so the
 * comparison is honest — a face, a name, a role, and how much of the talking
 * it has actually done.
 *
 * Laid out as a horizontal rail rather than a grid. A roster is a short list
 * you scan sideways, and a grid of eight makes a team of eight look like a
 * database table. The agents tab links out to the existing Agents page for
 * anything beyond a glance; nothing here duplicates that editor.
 */

type Member = Doc<"teamMembers"> & { photo: string | null };

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "away", label: "Away" },
  { value: "inactive", label: "Inactive" },
];

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500",
  away: "bg-amber-500",
  inactive: "bg-muted-foreground/40",
};

function countLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

// ---------------------------------------------------------------------------
// One card on the rail. Same frame for both kinds, so the two tabs read as one
// roster rather than as two unrelated lists.
// ---------------------------------------------------------------------------

function RosterCard({
  avatar,
  name,
  role,
  messages,
  status,
  statusLabel,
  menu,
  actions,
  footnote,
}: {
  avatar: React.ReactNode;
  name: string;
  role: string;
  messages: number | null | undefined;
  status: string;
  statusLabel: string;
  menu?: React.ReactNode;
  actions?: React.ReactNode;
  footnote?: string | null;
}) {
  return (
    <Card className="flex w-60 shrink-0 snap-start flex-col items-center gap-0 rounded-2xl p-5 text-center transition-shadow hover:shadow-md">
      {menu ? <div className="-mt-1 mb-1 self-end">{menu}</div> : null}

      <div className="relative">
        {avatar}
        {/* The status dot rides the avatar rather than sitting in a badge: it
            is about the person, and a card this small has no room for a
            second row of chips. */}
        <span
          aria-label={statusLabel}
          title={statusLabel}
          className={cn(
            "absolute right-0.5 bottom-0.5 size-3.5 rounded-full border-2 border-card",
            STATUS_TONE[status] ?? STATUS_TONE.inactive
          )}
        />
      </div>

      <p className="mt-3 w-full truncate font-heading text-base font-semibold">
        {name}
      </p>
      <p className="mt-0.5 line-clamp-2 min-h-8 text-sm text-muted-foreground">
        {role}
      </p>

      <Badge variant="secondary" className="mt-2 gap-1.5">
        <ChatsIcon className="size-3.5" />
        {countLabel(messages)} message{messages === 1 ? "" : "s"}
      </Badge>

      {footnote ? (
        <p className="mt-2 line-clamp-1 w-full text-xs text-muted-foreground">
          {footnote}
        </p>
      ) : null}

      {actions ? <div className="mt-4 w-full">{actions}</div> : null}
    </Card>
  );
}

/** The rail itself: a row that scrolls sideways and snaps. */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pt-1 pb-3">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding and editing a person
// ---------------------------------------------------------------------------

function MemberDialog({
  member,
  trigger,
}: {
  /** Absent for a new teammate. */
  member?: Member;
  trigger: React.ReactElement;
}) {
  const workspace = useWorkspace();
  const create = useMutation(api.team.create);
  const update = useMutation(api.team.update);
  const generateUploadUrl = useMutation(api.team.generateUploadUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(member?.role ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [note, setNote] = useState(member?.note ?? "");
  const [status, setStatus] = useState(member?.status ?? "active");
  // What to show now, and what to save. The preview is a blob URL while a file
  // is pending, so the card updates before anything is uploaded.
  const [preview, setPreview] = useState<string | null>(member?.photo ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState(member?.photoUrl ?? "");

  const pick = (chosen: File | null) => {
    if (!chosen) return;
    if (!chosen.type.startsWith("image/")) {
      toast.add({ title: "That is not an image", type: "error" });
      return;
    }
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    // A file beats a link, so clear the link rather than leave both to fight.
    setPhotoUrl("");
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      let photoStorageId: Id<"_storage"> | undefined;
      if (file) {
        const uploadUrl = await generateUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!response.ok) {
          throw new Error(`Upload failed with HTTP ${response.status}`);
        }
        ({ storageId: photoStorageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        });
      }

      const fields = {
        name,
        role,
        email,
        phone,
        note,
        status: status as "active" | "away" | "inactive",
        photoStorageId,
        photoUrl: photoUrl.trim() || undefined,
      };

      if (member) {
        await update({ memberId: member._id, ...fields });
      } else {
        await create({ workspaceId: workspace._id, ...fields });
      }

      toast.add({
        title: member ? "Teammate updated" : `${name.trim()} added`,
        type: "success",
      });
      setOpen(false);
      setFile(null);
    } catch (error) {
      toast.add({
        title: "Could not save",
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? "Edit teammate" : "Add a teammate"}</DialogTitle>
          <DialogDescription>
            Who they are and what they do. Used on the roster, and to sign a
            reply you send by hand from the inbox.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          {/* ------------------------------------------------------- photo */}
          <div className="flex items-center gap-4">
            <TeamAvatar name={name || "?"} photo={preview} size={64} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => pick(event.target.files?.[0] ?? null)}
              />
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => fileRef.current?.click()}
              >
                <UploadSimpleIcon /> {preview ? "Change photo" : "Upload photo"}
              </Button>
              <Input
                value={photoUrl}
                placeholder="…or paste an image URL"
                onChange={(event) => {
                  setPhotoUrl(event.target.value);
                  setFile(null);
                  setPreview(event.target.value.trim() || null);
                }}
              />
            </div>
          </div>

          {/* ------------------------------------------------------ fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-name">Name</Label>
              <Input
                id="member-name"
                value={name}
                placeholder="Priya Raman"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-role">Role</Label>
              <Input
                id="member-role"
                value={role}
                placeholder="Sales lead"
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                value={email}
                placeholder="priya@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-phone">Phone</Label>
              <Input
                id="member-phone"
                value={phone}
                placeholder="+91 98200 12345"
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-note">Note</Label>
            <Textarea
              id="member-note"
              value={note}
              rows={2}
              placeholder="Covers weekends. Escalate wiring questions here."
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <SelectField
              value={status}
              onValueChange={(next) =>
                setStatus(next as "active" | "away" | "inactive")
              }
              options={STATUSES}
              aria-label="Status"
            />
            <p className="text-xs text-muted-foreground">
              Inactive takes them off the list you can send a reply as.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim() || busy}>
            {busy ? <Spinner /> : null}
            {member ? "Save" : "Add teammate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberMenu({ member }: { member: Member }) {
  const remove = useMutation(api.team.remove);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Options for ${member.name}`}
            >
              <DotsThreeIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <MemberDialog
            member={member}
            trigger={<DropdownMenuItem closeOnClick={false}>Edit</DropdownMenuItem>}
          />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirming(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They come off the roster and off the list you can reply as. The
              replies they already sent stay in their threads exactly as the
              customer saw them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await remove({ memberId: member._id });
                toast.add({ title: `${member.name} removed`, type: "success" });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------

export default function TeamPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const now = useHourBucket();

  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const roster = useQuery(api.agents.roster, {
    workspaceId: workspace._id,
    now,
  });
  const members = useQuery(api.team.listByWorkspace, {
    workspaceId: workspace._id,
  });

  const statsById = new Map(
    (roster?.byAgent ?? []).map((row) => [row.agentId, row])
  );

  const people = members ?? [];
  const bots = agents ?? [];
  const humanMessages = people.reduce(
    (sum, member) => sum + member.messageCount,
    0
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Team
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everyone who answers for {workspace.name} — the agents that reply on
            their own, and the people who step in.
          </p>
        </div>
      </header>

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">
            <RobotIcon /> AI agents
            <Badge variant="secondary">{bots.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="people">
            <UsersThreeIcon /> People
            <Badge variant="secondary">{people.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ----------------------------------------------------- AI agents */}
        <TabsContent value="agents" className="flex flex-col gap-3 pt-4">
          {agents === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading agents…
            </div>
          ) : bots.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RobotIcon />
                </EmptyMedia>
                <EmptyTitle>No agents yet</EmptyTitle>
                <EmptyDescription>
                  Agents are built on the Agents page — describe the job and the
                  model drafts the persona for you.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href={`${base}/agents`} />}
              >
                Go to Agents
              </Button>
            </Empty>
          ) : (
            <>
              <Rail>
                {bots.map((agent) => (
                  <RosterCard
                    key={agent._id}
                    avatar={
                      <AgentAvatar
                        name={agent.botName}
                        gender={agent.gender}
                        size={72}
                      />
                    }
                    name={agent.botName}
                    role={agent.role}
                    messages={statsById.get(agent._id)?.messages ?? 0}
                    status={agent.status === "active" ? "active" : "away"}
                    statusLabel={agent.status}
                    footnote={
                      agent.kind === "router"
                        ? "Front desk — answers first"
                        : agent.kind === "follow_up"
                          ? "Follow-up desk"
                          : null
                    }
                    actions={
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        nativeButton={false}
                        render={<Link href={`${base}/agents/${agent._id}`} />}
                      >
                        <SlidersIcon /> Configure
                      </Button>
                    }
                  />
                ))}
              </Rail>
              <p className="text-xs text-muted-foreground">
                Message counts are what each agent has said recently, not for
                all time — the roster reads the most recent messages only.
              </p>
            </>
          )}
        </TabsContent>

        {/* -------------------------------------------------------- people */}
        <TabsContent value="people" className="flex flex-col gap-3 pt-4">
          {members === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading team…
            </div>
          ) : people.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersThreeIcon />
                </EmptyMedia>
                <EmptyTitle>Nobody on the team yet</EmptyTitle>
                <EmptyDescription>
                  Add the people who pick up a thread when an agent hands it
                  over. Their name signs the replies they send from the inbox.
                </EmptyDescription>
              </EmptyHeader>
              <MemberDialog
                trigger={
                  <Button size="lg">
                    <PlusIcon /> Add a teammate
                  </Button>
                }
              />
            </Empty>
          ) : (
            <>
              <Rail>
                {people.map((member) => (
                  <RosterCard
                    key={member._id}
                    avatar={
                      <TeamAvatar
                        name={member.name}
                        photo={member.photo}
                        size={72}
                      />
                    }
                    name={member.name}
                    role={member.role}
                    messages={member.messageCount}
                    status={member.status}
                    statusLabel={member.status}
                    menu={<MemberMenu member={member} />}
                    footnote={member.note ?? member.email ?? null}
                  />
                ))}

                {/* The add tile lives at the end of the rail, so adding
                    somebody is where you are already looking. */}
                <MemberDialog
                  trigger={
                    <button
                      type="button"
                      className="flex w-60 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <PlusIcon className="size-6" />
                      <span className="text-sm font-medium">Add a teammate</span>
                    </button>
                  }
                />
              </Rail>

              <p className="text-xs text-muted-foreground">
                {humanMessages} repl{humanMessages === 1 ? "y" : "ies"} sent by
                hand. Pick who you are replying as in the{" "}
                <Link
                  href={`${base}/conversations`}
                  className="underline underline-offset-4"
                >
                  inbox
                </Link>
                .
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
