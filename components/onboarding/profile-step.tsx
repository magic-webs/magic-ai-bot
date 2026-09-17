"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { FormRow } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { stepHref } from "@/lib/onboarding";
import { FloppyDiskIcon } from "@phosphor-icons/react";

/**
 * Step 1 — the company profile.
 *
 * Every field is compiled into the system prompt of every agent in the
 * workspace, which is why the hints say what the agents do with a field rather
 * than what it is called. The description matters most: it is the only place an
 * agent learns what the business actually sells.
 *
 * This is the same data Settings edits. It is repeated here rather than linked
 * to because a setup flow that sends you to five other pages is a list of
 * links, not a flow — and Settings surrounds these fields with webhooks,
 * themes and deletion, which is the wrong company on day one.
 */

/** The values these are most often set to. Every field stays free text. */
const CURRENCIES = ["GBP", "USD", "EUR", "INR", "AED"];
const TIMEZONES = [
  "Europe/London",
  "America/New_York",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
];
const LOCALES = ["en-GB", "en-US", "en-IN", "en-AE"];

function Suggestions({
  options,
  value,
  onPick,
  format = (option: string) => option,
}: {
  options: string[];
  value: string;
  onPick: (option: string) => void;
  format?: (option: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={value === option ? "secondary" : "outline"}
          onClick={() => onPick(option)}
        >
          {format(option)}
        </Button>
      ))}
    </div>
  );
}

export function ProfileStep() {
  const workspace = useWorkspace();
  const router = useRouter();
  const updateWorkspace = useMutation(api.workspaces.update);

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: workspace.name,
    ownerName: workspace.ownerName ?? "",
    tagline: workspace.tagline ?? "",
    description: workspace.description ?? "",
    industry: workspace.industry ?? "",
    website: workspace.website ?? "",
    supportEmail: workspace.supportEmail ?? "",
    supportPhone: workspace.supportPhone ?? "",
    address: workspace.address ?? "",
    currency: workspace.currency,
    timezone: workspace.timezone,
    locale: workspace.locale,
  });

  /* Re-seed if a different workspace is opened under the same mounted page.
     Adjusting state during render is the supported pattern — React re-runs the
     pass immediately — and it is what Settings does for the same reason: the
     workspace query is live, so an effect would overwrite what is being typed
     every time anything else in the workspace changed. */
  const [formFor, setFormFor] = useState<string>(workspace._id);
  if (formFor !== workspace._id) {
    setFormFor(workspace._id);
    setForm({
      name: workspace.name,
      ownerName: workspace.ownerName ?? "",
      tagline: workspace.tagline ?? "",
      description: workspace.description ?? "",
      industry: workspace.industry ?? "",
      website: workspace.website ?? "",
      supportEmail: workspace.supportEmail ?? "",
      supportPhone: workspace.supportPhone ?? "",
      address: workspace.address ?? "",
      currency: workspace.currency,
      timezone: workspace.timezone,
      locale: workspace.locale,
    });
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async (then?: "continue") => {
    setSaving(true);
    try {
      await updateWorkspace({
        workspaceId: workspace._id,
        name: form.name.trim(),
        ownerName: form.ownerName,
        tagline: form.tagline,
        description: form.description,
        industry: form.industry,
        website: form.website,
        supportEmail: form.supportEmail,
        supportPhone: form.supportPhone,
        address: form.address,
        /* Required columns with no null to fall back to, so a blank box means
           "leave what is stored" rather than "clear it" — writing "" would
           leave every price in the console formatting against no currency. */
        ...(form.currency.trim() ? { currency: form.currency.trim() } : {}),
        ...(form.timezone.trim() ? { timezone: form.timezone.trim() } : {}),
        ...(form.locale.trim() ? { locale: form.locale.trim() } : {}),
      });
      toast.add({ title: "Company profile saved", type: "success" });
      if (then === "continue") {
        router.push(stepHref(workspace.slug, "facts"));
      }
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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Who you are</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormRow
            label="Company name"
            htmlFor="name"
            hint="The name the agents use when they introduce themselves."
          >
            <Input
              id="name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Northgate Signs"
            />
          </FormRow>

          <FormRow
            label="What the company does"
            htmlFor="description"
            hint="Two or three sentences. This is the single most-read line in the whole setup — it is how an agent knows what it is selling."
          >
            <Textarea
              id="description"
              rows={4}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              placeholder="We design, print and install shop signage for independent retailers across the north of England. Everything is made in our own workshop."
            />
          </FormRow>

          <FormRow
            label="Industry"
            htmlFor="industry"
            hint="Sets the vocabulary an agent reaches for."
          >
            <Input
              id="industry"
              value={form.industry}
              onChange={(event) => set("industry", event.target.value)}
              placeholder="Signage and print"
            />
          </FormRow>

          <FormRow label="Tagline" htmlFor="tagline" optional>
            <Input
              id="tagline"
              value={form.tagline}
              onChange={(event) => set("tagline", event.target.value)}
              placeholder="Shopfront signage, made in Leeds"
            />
          </FormRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How customers reach you</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow
              label="Phone"
              htmlFor="phone"
              hint="Handed out when an agent cannot answer something itself."
            >
              <Input
                id="phone"
                value={form.supportPhone}
                onChange={(event) => set("supportPhone", event.target.value)}
                placeholder="+44 113 496 0000"
              />
            </FormRow>
            <FormRow label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={form.supportEmail}
                onChange={(event) => set("supportEmail", event.target.value)}
                placeholder="hello@northgatesigns.co.uk"
              />
            </FormRow>
          </div>

          <FormRow label="Website" htmlFor="website" optional>
            <Input
              id="website"
              value={form.website}
              onChange={(event) => set("website", event.target.value)}
              placeholder="https://northgatesigns.co.uk"
            />
          </FormRow>

          <FormRow label="Address" htmlFor="address" optional>
            <Textarea
              id="address"
              rows={2}
              value={form.address}
              onChange={(event) => set("address", event.target.value)}
              placeholder="Unit 4, Sheepscar Way, Leeds LS7 2BB"
            />
          </FormRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Money and time</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormRow
            label="Currency"
            htmlFor="currency"
            hint="What an agent quotes in, and how every price in this console is written."
          >
            <Input
              id="currency"
              value={form.currency}
              maxLength={3}
              onChange={(event) =>
                set("currency", event.target.value.toUpperCase())
              }
              placeholder="GBP"
              className="max-w-32"
            />
            <Suggestions
              options={CURRENCIES}
              value={form.currency}
              onPick={(code) => set("currency", code)}
            />
          </FormRow>

          <FormRow
            label="Timezone"
            htmlFor="timezone"
            hint="An IANA name. It decides what an agent counts as today."
          >
            <Input
              id="timezone"
              value={form.timezone}
              onChange={(event) => set("timezone", event.target.value)}
              placeholder="Europe/London"
              className="max-w-80"
            />
            <Suggestions
              options={TIMEZONES}
              value={form.timezone}
              onPick={(zone) => set("timezone", zone)}
              format={(zone) => zone.split("/")[1].replace(/_/g, " ")}
            />
          </FormRow>

          <FormRow
            label="Locale"
            htmlFor="locale"
            hint="How dates and numbers are written back to a customer."
          >
            <Input
              id="locale"
              value={form.locale}
              onChange={(event) => set("locale", event.target.value)}
              placeholder="en-GB"
              className="max-w-32"
            />
            <Suggestions
              options={LOCALES}
              value={form.locale}
              onPick={(code) => set("locale", code)}
            />
          </FormRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>You</CardTitle>
        </CardHeader>
        <CardContent>
          <FormRow
            label="What the agents should call you"
            htmlFor="ownerName"
            optional
            hint={`Used when an agent speaks to you rather than to a customer. Leave it empty to be addressed as ${
              form.name.trim() || "your company"
            }.`}
          >
            <Input
              id="ownerName"
              value={form.ownerName}
              onChange={(event) => set("ownerName", event.target.value)}
              placeholder="Sanjeev"
              className="max-w-80"
            />
          </FormRow>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void save("continue")}
          disabled={saving || !form.name.trim()}
        >
          <FloppyDiskIcon /> {saving ? "Saving…" : "Save and continue"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void save()}
          disabled={saving || !form.name.trim()}
        >
          Save and stay
        </Button>
      </div>
    </div>
  );
}
