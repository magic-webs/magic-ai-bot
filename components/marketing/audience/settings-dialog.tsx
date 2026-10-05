"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { fail, type Category } from "./shared";

const CAP_OPTIONS = [
  { value: "0", label: "No limit" },
  ...[1, 2, 3, 4, 5, 7].map((n) => ({
    value: String(n),
    label: `${n} per person a week`,
  })),
];

export function AudienceSettingsDialog({
  open,
  categories: initialCategories,
  weeklyCap: initialCap,
  onClose,
}: {
  open: boolean;
  categories: Category[];
  weeklyCap: number;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const saveSettings = useMutation(api.marketing.saveAudienceSettings);
  const [categories, setCategories] = useState(initialCategories);
  const [cap, setCap] = useState(String(initialCap));
  const [busy, setBusy] = useState(false);

  const change = (index: number, patch: Partial<Category>) =>
    setCategories(categories.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({
        workspaceId: workspace._id,
        weeklyCap: Number(cap),
        categories: categories.map((category) => ({
          ...category,
          key: category.key || category.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        })),
      });
      toast.add({ title: "Audience settings saved", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Audience settings</DialogTitle>
          <DialogDescription>
            The categories new contacts are sorted into, and how often one person can be messaged.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Messages per person</Label>
            <SelectField aria-label="Weekly limit" value={cap} onValueChange={setCap} options={CAP_OPTIONS} />
            <p className="text-xs text-muted-foreground">
              Campaigns and event reminders skip anyone who has already had this many in the last
              seven days. Birthday wishes are not counted. Meta limits marketing messages per person
              too, and sends past its limit fail.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Categories</Label>
            <p className="text-xs text-muted-foreground">
              Describe each one the way you would explain it to a new colleague — the description
              is what sorting reads.
            </p>
            {categories.map((category, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]"
              >
                <Input
                  value={category.label}
                  placeholder="Name"
                  onChange={(e) => change(index, { label: e.target.value })}
                />
                <Textarea
                  rows={2}
                  value={category.description}
                  placeholder="Who belongs here"
                  onChange={(e) => change(index, { description: e.target.value })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove category"
                  disabled={categories.length <= 2}
                  onClick={() => setCategories(categories.filter((_, i) => i !== index))}
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={categories.length >= 12}
              onClick={() => setCategories([...categories, { key: "", label: "", description: "" }])}
            >
              <PlusIcon /> Add a category
            </Button>
          </div>
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
