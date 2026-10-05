"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/billing";
import { templateBlocker } from "@/convex/lib/marketing";
import { useWorkspace } from "@/components/workspace-provider";
import { fail } from "@/components/marketing/calendar";
import { templateReady, templateStanding } from "@/components/marketing/format";
import { TemplateDialog, draftFor, type TemplateDraft } from "@/components/marketing/template-dialog";
import { TableSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { ArrowClockwiseIcon, MegaphoneIcon, PlusIcon, WhatsappLogoIcon } from "@phosphor-icons/react";

export default function MarketingTemplatesPage() {
  const workspace = useWorkspace();
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const templates = useMemo(() => overview?.templates ?? [], [overview]);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const checkStatus = useAction(api.marketingTemplates.checkStatus);
  const [checking, setChecking] = useState(false);

  const unlinked = templates.filter((t) => !templateReady(t)).length;
  const inReview = templates.some((t) => t.metaStatus === "PENDING" || t.metaStatus === "IN_APPEAL");

  const runStatusCheck = async () => {
    setChecking(true);
    try {
      const { changed } = await checkStatus({ workspaceId: workspace._id });
      toast.add({
        title: changed
          ? `${changed} ${changed === 1 ? "template" : "templates"} updated from Meta`
          : "No decision from Meta yet",
        type: changed ? "success" : undefined,
      });
    } catch (error) {
      fail("Could not check with Meta", error);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Templates</h2>
          <p className="text-sm text-muted-foreground">
            The WhatsApp templates campaigns, events and greetings go out as.
          </p>
        </div>
        <Button onClick={() => setDraft(draftFor())}>
          <PlusIcon /> New template
        </Button>
      </div>

      {unlinked > 0 ? (
        <Alert>
          <WhatsappLogoIcon />
          <AlertTitle>
            {unlinked === 1 ? "1 template can't send yet" : `${unlinked} templates can't send yet`}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <p>
              WhatsApp only delivers marketing messages as templates Meta has approved. Open one and
              apply it to Meta — it sends once approved, and the approval is picked up here on its
              own.
            </p>
            {inReview ? (
              <Button size="sm" variant="outline" disabled={checking} onClick={() => void runStatusCheck()}>
                {checking ? <Spinner /> : <ArrowClockwiseIcon />} Check status now
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {overview === undefined ? (
        <TableSkeleton rows={3} columns={3} />
      ) : templates.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MegaphoneIcon />
            </EmptyMedia>
            <EmptyTitle>No templates yet</EmptyTitle>
            <EmptyDescription>
              Write a birthday wish or a festival greeting — or let the marketing desk draft one in
              your company’s voice.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setDraft(draftFor())}>
            <PlusIcon /> New template
          </Button>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template._id}
              type="button"
              onClick={() => setDraft(draftFor(template))}
              className="flex flex-col gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{template.name}</span>
                <Badge variant="outline">{template.occasion}</Badge>
                {template.category && template.category !== "marketing" ? (
                  <Badge variant="outline">{CATEGORY_LABELS[template.category]}</Badge>
                ) : null}
                <Badge variant="secondary" className={templateStanding(template).className}>
                  {templateStanding(template).label}
                </Badge>
              </span>
              <span className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
                {template.body}
              </span>
              {template.metaStatus === "REJECTED" || template.metaStatus === "CHANGED" ? (
                <span className="text-xs font-medium text-destructive">{templateBlocker(template)}</span>
              ) : null}
              {template.metaTemplateName ? (
                <span className="mt-auto flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <WhatsappLogoIcon className="size-3.5" />
                  {template.metaTemplateName} · {template.languageCode}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      <TemplateDialog draft={draft} setDraft={setDraft} templates={templates} />
    </div>
  );
}
