"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { KeyValueEditor, type KeyValue } from "@/components/editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { FloppyDiskIcon } from "@phosphor-icons/react";

export default function CompanyProfilePage() {
  const workspace = useWorkspace();
  const updateWorkspace = useMutation(api.workspaces.update);

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: workspace.name,
    tagline: workspace.tagline ?? "",
    industry: workspace.industry ?? "",
    description: workspace.description ?? "",
    website: workspace.website ?? "",
    supportEmail: workspace.supportEmail ?? "",
    supportPhone: workspace.supportPhone ?? "",
    address: workspace.address ?? "",
    locale: workspace.locale,
    timezone: workspace.timezone,
    currency: workspace.currency,
    facts: workspace.facts as KeyValue[],
  });

  // Re-seed the form if a different workspace is opened. Adjusting state during
  // render is the supported pattern; React re-runs this pass immediately.
  const [formFor, setFormFor] = useState<string>(workspace._id);
  if (formFor !== workspace._id) {
    setFormFor(workspace._id);
    setForm({
      name: workspace.name,
      tagline: workspace.tagline ?? "",
      industry: workspace.industry ?? "",
      description: workspace.description ?? "",
      website: workspace.website ?? "",
      supportEmail: workspace.supportEmail ?? "",
      supportPhone: workspace.supportPhone ?? "",
      address: workspace.address ?? "",
      locale: workspace.locale,
      timezone: workspace.timezone,
      currency: workspace.currency,
      facts: workspace.facts as KeyValue[],
    });
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await updateWorkspace({
        workspaceId: workspace._id,
        name: form.name,
        tagline: form.tagline,
        industry: form.industry,
        description: form.description,
        website: form.website,
        supportEmail: form.supportEmail,
        supportPhone: form.supportPhone,
        address: form.address,
        locale: form.locale,
        timezone: form.timezone,
        currency: form.currency,
        facts: form.facts.filter((fact) => fact.key.trim()),
      });
      toast.add({ title: "Company profile saved", type: "success" });
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      {/* Sticky so Save stays reachable however far down the form you are. */}
      <header className="sticky top-0 z-20 flex flex-wrap items-end justify-between gap-3 border-b bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Company profile
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Injected into every agent&apos;s system prompt.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <FloppyDiskIcon />} Save
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>The business</CardTitle>
            <CardDescription>
              Who the business is, what it sells, and how customers reach a human.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-name">Name</Label>
                <Input
                  id="c-name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-tagline">Tagline</Label>
                <Input
                  id="c-tagline"
                  value={form.tagline}
                  onChange={(event) => set("tagline", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-industry">Industry</Label>
                <Input
                  id="c-industry"
                  value={form.industry}
                  onChange={(event) => set("industry", event.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-description">What the business does</Label>
              <Textarea
                id="c-description"
                rows={4}
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-website">Website</Label>
                <Input
                  id="c-website"
                  value={form.website}
                  onChange={(event) => set("website", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-email">Support email</Label>
                <Input
                  id="c-email"
                  value={form.supportEmail}
                  onChange={(event) => set("supportEmail", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-phone">Support phone</Label>
                <Input
                  id="c-phone"
                  value={form.supportPhone}
                  onChange={(event) => set("supportPhone", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-address">Address</Label>
                <Input
                  id="c-address"
                  value={form.address}
                  onChange={(event) => set("address", event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-locale">Locale</Label>
                <Input
                  id="c-locale"
                  className="font-mono"
                  value={form.locale}
                  onChange={(event) => set("locale", event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Drives spelling conventions, e.g. en-GB gives &ldquo;colour&rdquo;.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-timezone">Timezone</Label>
                <Input
                  id="c-timezone"
                  className="font-mono"
                  value={form.timezone}
                  onChange={(event) => set("timezone", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-currency">Currency</Label>
                <Input
                  id="c-currency"
                  className="font-mono"
                  value={form.currency}
                  onChange={(event) => set("currency", event.target.value)}
                />
              </div>
            </div>

            <Separator />

            <KeyValueEditor
              label="Company facts"
              description="Short, checkable facts every agent may state — delivery areas, minimum order, opening hours, lead times."
              value={form.facts}
              onChange={(next) => set("facts", next)}
              keyPlaceholder="Delivery"
              valuePlaceholder="UK mainland only, 3–7 working days"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
