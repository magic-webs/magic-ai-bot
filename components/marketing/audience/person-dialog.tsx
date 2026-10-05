"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate } from "@/components/marketing/format";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { XIcon } from "@phosphor-icons/react";
import { fail, formatPhone, type Category } from "./shared";

export type Person = {
  _id: Id<"contacts">;
  name: string | null;
  phone: string;
  email: string | null;
  company: string | null;
  birthday: string | null;
  category: string | null;
  tags: string[];
  source: string | null;
  optedOutAt: number | null;
  createdAt: number;
};

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: "Wrote in on WhatsApp",
  web: "Wrote in on the website",
  manual: "Added by hand",
  import: "Imported",
};

const birthdayText = (monthDay: string | null) =>
  monthDay ? formatDate(`2000-${monthDay}`, { day: "numeric", month: "short" }) : "";

export function PersonDialog({
  person,
  categories,
  onClose,
}: {
  person: Person | null;
  categories: Category[];
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const update = useMutation(api.contacts.update);
  const updatePeople = useMutation(api.audience.updatePeople);
  const setSubscribed = useMutation(api.contacts.setSubscribed);

  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [company, setCompany] = useState(person?.company ?? "");
  const [birthday, setBirthday] = useState(birthdayText(person?.birthday ?? null));
  const [category, setCategory] = useState(person?.category ?? "");
  const [tags, setTags] = useState<string[]>(person?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [subscribed, setSubscribedState] = useState(!person?.optedOutAt);
  const [busy, setBusy] = useState(false);

  if (!person) return null;

  const save = async () => {
    setBusy(true);
    try {
      await update({ contactId: person._id, name, email, company, birthday });
      await updatePeople({
        workspaceId: workspace._id,
        contactIds: [person._id],
        category,
        addTags: tags,
        removeTags: person.tags.filter((tag) => !tags.includes(tag)),
      });
      if (subscribed !== !person.optedOutAt) {
        await setSubscribed({ contactId: person._id, subscribed });
      }
      toast.add({ title: "Saved", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setBusy(false);
    }
  };

  const addTag = () => {
    const tag = tagDraft.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagDraft("");
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{person.name ?? formatPhone(person.phone)}</DialogTitle>
          <DialogDescription>
            {formatPhone(person.phone)} · {SOURCE_LABELS[person.source ?? ""] ?? "Contact"} ·{" "}
            since {new Date(person.createdAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="person-name">Name</Label>
              <Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <SelectField
                aria-label="Category"
                value={category}
                placeholder="Not sorted"
                onValueChange={setCategory}
                options={categories.map((c) => ({ value: c.key, label: c.label }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="person-email">Email</Label>
              <Input id="person-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="person-company">Company</Label>
              <Input id="person-company" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="person-birthday">Birthday</Label>
              <Input
                id="person-birthday"
                value={birthday}
                placeholder="25 Dec"
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="person-tag">Tags</Label>
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove ${tag}`}
                    onClick={() => setTags(tags.filter((t) => t !== tag))}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              id="person-tag"
              value={tagDraft}
              placeholder="Type a tag and press Enter"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <span>
              <span className="font-medium">Gets marketing messages</span>
              <span className="block text-xs text-muted-foreground">
                {person.optedOutAt
                  ? `Unsubscribed on ${new Date(person.optedOutAt).toLocaleDateString()}.`
                  : "Turn off if they asked not to be messaged. A reply of STOP does this on its own."}
              </span>
            </span>
            <Switch checked={subscribed} onCheckedChange={setSubscribedState} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
