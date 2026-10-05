"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { templateBlocker } from "@/convex/lib/marketing";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  HOURS,
  dayLabel,
  templateOptionLabel,
  templateReady,
} from "@/components/marketing/format";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { GiftIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { fail, type Template } from "@/components/marketing/calendar";

// --------------------------------------------------------------- birthdays

/**
 * The standing birthday wish. Keyed on the saved settings by its parent, so
 * the form starts from what is stored and a save elsewhere resets it — no
 * effect copying the query into state.
 */
export function BirthdaySettings({
  settings,
  templates,
  timezone,
  withBirthday,
}: {
  settings: {
    birthdayEnabled: boolean;
    birthdayTemplateId: Id<"marketingTemplates"> | null;
    birthdayHour: number;
    lastBirthdayRun: string | null;
  };
  templates: Template[];
  timezone: string;
  withBirthday: number;
}) {
  const workspace = useWorkspace();
  const saveSettings = useMutation(api.marketing.saveSettings);
  const [enabled, setEnabled] = useState(settings.birthdayEnabled);
  const [templateId, setTemplateId] = useState<string>(
    settings.birthdayTemplateId ??
      templates.find((t) => t.occasion === "birthday")?._id ??
      ""
  );
  const [hour, setHour] = useState(settings.birthdayHour);
  const [busy, setBusy] = useState(false);

  const dirty =
    enabled !== settings.birthdayEnabled ||
    templateId !== (settings.birthdayTemplateId ?? "") ||
    hour !== settings.birthdayHour;
  const chosen = templates.find((t) => t._id === templateId);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({
        workspaceId: workspace._id,
        birthdayEnabled: enabled,
        birthdayTemplateId: templateId ? (templateId as Id<"marketingTemplates">) : undefined,
        birthdayHour: hour,
      });
      toast.add({
        title: enabled ? "Birthday wishes are on" : "Birthday wishes are off",
        type: "success",
      });
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GiftIcon className="size-5 text-pink-600 dark:text-pink-400" />
          Birthday wishes
        </CardTitle>
        <CardDescription>
          Every customer whose birthday is today gets this, once, at the hour you pick.{" "}
          {withBirthday} {withBirthday === 1 ? "customer has" : "customers have"} a birthday on
          file.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          {enabled ? "On" : "Off"}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <SelectField
              aria-label="Birthday template"
              value={templateId}
              placeholder="Pick a template"
              onValueChange={setTemplateId}
              options={templates.map((t) => ({
                value: t._id as string,
                label: templateOptionLabel(t),
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Send at ({timezone})</Label>
            <SelectField
              aria-label="Send birthday wishes at"
              value={String(hour)}
              onValueChange={(next) => setHour(Number(next))}
              options={HOURS}
            />
          </div>
        </div>

        {chosen && !templateReady(chosen) ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <WarningCircleIcon className="size-3.5" />
            {templateBlocker(chosen)} The wishes will not send until it is approved.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {settings.lastBirthdayRun
              ? `Last sent on ${dayLabel(settings.lastBirthdayRun)}.`
              : "Not sent yet."}
          </p>
          <Button onClick={() => void save()} disabled={busy || !dirty || (enabled && !templateId)}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
