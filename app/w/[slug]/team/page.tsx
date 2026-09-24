"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ArrowRightIcon,
  ChatTeardropTextIcon,
  DotsThreeIcon,
  PlusIcon,
  RobotIcon,
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

/** The last thing a card's owner actually said, quoted on hover. */
type LastMessage = { text: string; at: number } | null;

type Member = Doc<"teamMembers"> & {
  photo: string | null;
  lastMessage: LastMessage;
};

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

function relative(timestamp: number): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function countLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

// ---------------------------------------------------------------------------
// One card on the rail.
//
// A poster rather than a data row: a tall tinted panel, the face as the
// artwork, and one line of what they do. A roster is the first thing anybody
// is shown about a workspace, and eight identical grey rectangles say less
// about a team than eight cards you can tell apart at a glance.
//
// Each card carries its own colour rather than the theme's, which is why the
// foreground is set explicitly on every tone — these do not follow light and
// dark, so contrast has to be decided here rather than inherited.
// ---------------------------------------------------------------------------

type Tone = {
  card: string;
  title: string;
  body: string;
  eyebrow: string;
  pill: string;
  art: string;
};

const TONES: Tone[] = [
  {
    card: "bg-[#1F2422]",
    title: "text-white",
    body: "text-white/70",
    eyebrow: "text-white/55",
    pill: "border-white/25 text-white/80",
    art: "bg-white/[0.06]",
  },
  {
    card: "bg-[#E2703F]",
    title: "text-[#2A1206]",
    body: "text-[#2A1206]/75",
    eyebrow: "text-[#2A1206]/60",
    pill: "border-[#2A1206]/30 text-[#2A1206]/80",
    art: "bg-[#2A1206]/[0.07]",
  },
  {
    card: "bg-[#B7C0A8]",
    title: "text-[#1F2422]",
    body: "text-[#1F2422]/75",
    eyebrow: "text-[#1F2422]/60",
    pill: "border-[#1F2422]/25 text-[#1F2422]/80",
    art: "bg-[#1F2422]/[0.07]",
  },
  {
    card: "bg-[#DED4C3]",
    title: "text-[#1F2422]",
    body: "text-[#1F2422]/75",
    eyebrow: "text-[#1F2422]/60",
    pill: "border-[#1F2422]/25 text-[#1F2422]/80",
    art: "bg-[#1F2422]/[0.07]",
  },
  {
    card: "bg-[#A9BDC9]",
    title: "text-[#16212B]",
    body: "text-[#16212B]/75",
    eyebrow: "text-[#16212B]/60",
    pill: "border-[#16212B]/25 text-[#16212B]/80",
    art: "bg-[#16212B]/[0.07]",
  },
];

// Hand-laid, not random: the tilt has to be the same on every render or a card
// jumps each time the roster reloads. Straightens on hover, so the one you are
// reading is the one sitting square.
const TILTS = [
  "-rotate-[1.2deg]",
  "rotate-[0.9deg]",
  "-rotate-[0.6deg]",
  "rotate-[1.4deg]",
  "-rotate-[0.9deg]",
];

function PosterCard({
  index,
  eyebrow,
  name,
  description,
  art,
  messages,
  lastMessage,
  status,
  statusLabel,
  menu,
  action,
}: {
  /** Position on the rail, which picks the colour and the tilt. */
  index: number;
  eyebrow: string;
  name: string;
  description: string;
  art: React.ReactNode;
  messages: number | null | undefined;
  lastMessage?: LastMessage;
  status: string;
  statusLabel: string;
  menu?: React.ReactNode;
  action?: { label: string; href: string };
}) {
  const tone = TONES[index % TONES.length];

  // The count and the quote behind it are one thing, so the label is built
  // once and worn either by a plain span or by the tooltip's trigger.
  const countClass = cn("flex items-center gap-1.5 text-[13px]", tone.body);
  const count = (
    <>
      <ChatTeardropTextIcon weight="fill" aria-hidden className="size-4 shrink-0" />
      {countLabel(messages)} msg{messages === 1 ? "" : "s"}
    </>
  );

  return (
    <article
      className={cn(
        "group relative flex h-[26rem] w-72 shrink-0 snap-start flex-col rounded-[28px] p-6",
        // The depth. A light wash at the head and a shade at the foot are
        // painted into the card's own background-image, over the tone's
        // background-colour — two different properties, so they compose
        // instead of one winning. An overlay element would have had to be
        // positioned, and a positioned overlay paints over the text.
        //
        // Every stop is written out rather than using `via-transparent`,
        // because a gradient that interpolates through the transparent
        // keyword drags a grey band through the middle of a saturated card.
        "bg-[linear-gradient(to_bottom,rgba(255,255,255,0.20)_0%,rgba(255,255,255,0)_42%,rgba(0,0,0,0)_64%,rgba(0,0,0,0.12)_100%)]",
        // Two shadows and two hairlines: a tight one for where the card meets
        // the page, a wide soft one for how far above it the card sits, and
        // inset lines for the lit top edge and the dark bottom edge.
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.30),inset_0_-1px_0_rgba(0,0,0,0.12),0_2px_4px_-2px_rgba(16,24,32,0.28),0_24px_44px_-16px_rgba(16,24,32,0.38)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-1px_0_rgba(0,0,0,0.12),0_6px_12px_-6px_rgba(16,24,32,0.30),0_40px_70px_-22px_rgba(16,24,32,0.50)]",
        // `rotate`, `translate` and `transform` are three separate properties
        // in v4 and compose in that order, which is what lets the flat tilt
        // straighten while the perspective tip is applied on top of it.
        "transition-[transform,translate,rotate,box-shadow] duration-300 ease-out",
        "hover:-translate-y-1.5 hover:rotate-0",
        "hover:[transform:perspective(1100px)_rotateX(6deg)]",
        tone.card,
        TILTS[index % TILTS.length]
      )}
    >
      {/* ------------------------------------------------- eyebrow + pill */}
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "pt-1 font-mono text-[11px] tracking-[0.14em] uppercase",
            tone.eyebrow
          )}
        >
          {eyebrow}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] uppercase",
              tone.pill
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                STATUS_TONE[status] ?? STATUS_TONE.inactive
              )}
            />
            {statusLabel}
          </span>
          {menu ? <span className={tone.title}>{menu}</span> : null}
        </div>
      </div>

      {/* -------------------------------------------------------- the name */}
      <h3
        className={cn(
          "mt-3 truncate font-heading text-2xl font-bold tracking-tight",
          tone.title
        )}
        title={name}
      >
        {name}
      </h3>
      <p className={cn("mt-1 line-clamp-2 text-sm", tone.body)}>
        {description}
      </p>

      {/* --------------------------------------------------- the face as art */}
      <div
        className={cn(
          "mt-4 flex flex-1 items-center justify-center rounded-2xl",
          // Pressed into the card, where the card is raised off the page.
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.10)]",
          tone.art
        )}
      >
        <div className="transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.04]">
          {art}
        </div>
      </div>

      {/* ------------------------------------------------------- the footer
          The one number and the one way in. Set in the body face rather than
          the mono eyebrow the header uses: the top of the card is a label and
          reads as one, the bottom is a sentence and a button. */}
      <div className="mt-4 flex items-center justify-between gap-2">
        {/* The count answers how much; the quote behind it answers what. A
            button rather than a span, because a tooltip that only opens on
            hover is a tooltip nobody on a keyboard ever sees. */}
        {lastMessage ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Last reply from ${name}`}
                  className={cn(
                    countClass,
                    "cursor-help decoration-dotted underline-offset-4 outline-none hover:underline focus-visible:underline"
                  )}
                >
                  {count}
                </button>
              }
            />
            <TooltipContent
              side="top"
              align="start"
              className="max-w-72 flex-col items-start gap-1.5 px-3 py-2 text-left"
            >
              <span className="font-mono text-[10px] tracking-[0.12em] uppercase opacity-60">
                Last reply · {relative(lastMessage.at)}
              </span>
              <span className="line-clamp-5 leading-relaxed">
                {lastMessage.text}
              </span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className={countClass}>{count}</span>
        )}
        {action ? (
          <Link
            href={action.href}
            className={cn(
              "flex items-center gap-1.5 text-[13px] font-semibold",
              "transition-transform duration-200 ease-out hover:translate-x-0.5",
              tone.title
            )}
          >
            {action.label}
            <ArrowRightIcon weight="bold" className="size-4" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** The rail itself: a row that scrolls sideways and snaps. */
function Rail({ children }: { children: React.ReactNode }) {
  // Padded rather than flush, and padded further at the foot than the head:
  // `overflow-x-auto` computes the other axis to `auto` too, so the box crops
  // anything that leaves it — and what leaves it is the tilt, the hover lift
  // and a soft shadow that falls some 60px below each card.
  //
  // `no-scrollbar` hides the bar, not the scrolling: a full-width rule under a
  // row of poster cards read as a divider between the roster and the page, and
  // the card cropped at the right edge already says the rail carries on.
  // The provider carries no DOM, only the delay: base-ui waits 600ms on its
  // own, which is long enough that a quote nobody was told about never gets
  // read. Scoped here rather than at the root, where it would quietly change
  // every tooltip in the sidebar too.
  return (
    <TooltipProvider delay={150}>
      <div className="no-scrollbar -mx-2 flex snap-x snap-mandatory gap-5 overflow-x-auto px-2 pt-6 pb-16">
        {children}
      </div>
    </TooltipProvider>
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
              // Inherits the card's colour, including on hover — ghost's own
              // hover colour is the theme's foreground, which is invisible on
              // the dark tone.
              className="text-current hover:bg-current/10 hover:text-current!"
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
  const loading = agents === undefined || members === undefined;
  const empty = !loading && bots.length === 0 && people.length === 0;

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

        {/* The composition, where the tabs used to say it. A roster of eleven
            that is ten bots and one person is a different business from one
            that is the other way round, and that is worth knowing before the
            cards are read. */}
        {loading ? null : (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              <RobotIcon /> {bots.length} AI
            </Badge>
            <Badge variant="secondary">
              <UsersThreeIcon /> {people.length}{" "}
              {people.length === 1 ? "person" : "people"}
            </Badge>
            <MemberDialog
              trigger={
                <Button size="sm" variant="outline">
                  <PlusIcon /> Add a teammate
                </Button>
              }
            />
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading the team…
        </div>
      ) : empty ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersThreeIcon />
            </EmptyMedia>
            <EmptyTitle>Nobody here yet</EmptyTitle>
            <EmptyDescription>
              Build an agent — describe the job and the model drafts the persona
              for you — and add the people who pick a thread up when it hands
              one over.
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href={`${base}/agents`} />}
            >
              Go to Agents
            </Button>
            <MemberDialog
              trigger={
                <Button size="lg" variant="outline">
                  <PlusIcon /> Add a teammate
                </Button>
              }
            />
          </div>
        </Empty>
      ) : (
        /* One rail, agents first. They answer first, and a roster split in two
           is a roster the reader has to join back together to answer the only
           question this page is asked: who answers for us. */
        <Rail>
          {bots.map((agent, index) => (
            <PosterCard
              key={agent._id}
              index={index}
              eyebrow={
                agent.kind === "router"
                  ? "Front desk"
                  : agent.kind === "follow_up"
                    ? "Follow-up desk"
                    : agent.kind === "marketing"
                      ? "Marketing desk"
                      : "AI agent"
              }
              name={agent.botName}
              description={agent.role}
              art={
                <AgentAvatar
                  name={agent.botName}
                  gender={agent.gender}
                  size={124}
                />
              }
              messages={statsById.get(agent._id)?.messages ?? 0}
              lastMessage={statsById.get(agent._id)?.lastMessage ?? null}
              status={agent.status === "active" ? "active" : "away"}
              statusLabel={agent.status}
              action={{
                label: "Configure",
                href: `${base}/agents/${agent._id}`,
              }}
            />
          ))}

          {/* The tones and tilts run off the index, so the people carry on
              from where the agents stopped rather than restarting the
              sequence half way along the rail. */}
          {people.map((member, index) => (
            <PosterCard
              key={member._id}
              index={bots.length + index}
              eyebrow="Teammate"
              name={member.name}
              description={member.role || member.note || member.email || "Team"}
              art={
                <TeamAvatar
                  name={member.name}
                  photo={member.photo}
                  size={124}
                />
              }
              messages={member.messageCount}
              lastMessage={member.lastMessage}
              status={member.status}
              statusLabel={member.status}
              menu={<MemberMenu member={member} />}
            />
          ))}

          {/* The add tile lives at the end of the rail, so adding somebody is
              where you are already looking. */}
          <MemberDialog
            trigger={
              <button
                type="button"
                className="flex h-[26rem] w-72 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-[28px] border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <PlusIcon className="size-6" />
                <span className="text-sm font-medium">Add a teammate</span>
              </button>
            }
          />
        </Rail>
      )}
    </div>
  );
}
