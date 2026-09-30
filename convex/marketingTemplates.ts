// Applying the marketing desk's templates to Meta, through the WhatsApp panel
// the sending number is connected through, and following Meta's review.
//
//   owner saves "Diwali wishes" and presses Apply
//     -> apply posts it to {panel}/{version}/{waba}/message_templates in the
//        numbered form Meta reads, with a sample for every variable
//     -> Meta answers PENDING; the template waits, and nothing sends on it
//     -> the review sweep (convex/crons.ts) reads the panel's template list
//        every half hour until Meta decides, and "Check status" does the same
//        on demand
//     -> APPROVED, and it sends; REJECTED, and the reason is shown
//
// A template already approved and then edited is applied again as an edit to
// the same Meta template, not a second one beside it.
//
// fetch only, so the default runtime.

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  exampleValues,
  metaBody,
  metaNameFor,
  templateProblems,
} from "./lib/marketing";
import {
  channelHeaders,
  discoverWaba,
  errorText,
  listTemplates,
  panelRoot,
  providerError,
  request,
  type Json,
  type PanelConfig,
} from "./lib/panel";

const NO_PANEL = "Connect a WhatsApp number under Channels first — templates are applied through it.";
const NO_WABA =
  "The WhatsApp channel has no WABA ID. Add it on the channel under Channels, then apply again.";

/** A language code Meta and the panel may write differently: "en_US" is "en-US". */
const sameLanguage = (a: string, b: string) =>
  a.toLowerCase().replace("-", "_") === b.toLowerCase().replace("-", "_");

export const apply = action({
  args: { templateId: v.id("marketingTemplates") },
  handler: async (ctx, args): Promise<{ status: string; name: string }> => {
    const { template, business, panel } = await ctx.runQuery(
      internal.marketing.applyContext,
      { templateId: args.templateId }
    );
    if (!panel) throw new Error(NO_PANEL);
    if (template.metaStatus === "PENDING") {
      throw new Error("Meta is still reviewing it. Apply again once it has decided.");
    }
    const problems = templateProblems(template.body);
    if (problems.length > 0) throw new Error(problems[0]);

    const text = metaBody(template.body);
    const samples = exampleValues(template.body, business);
    const body: Json = {
      type: "BODY",
      text,
      ...(samples.length ? { example: { body_text: [samples] } } : {}),
    };
    const category = (template.category ?? "marketing").toUpperCase();
    // The name it already goes by, when it has one: Meta keys a template on
    // its name and language, and an edit keeps both.
    const name = template.metaTemplateName ?? metaNameFor(template.name);

    let url: string;
    let payload: Json;
    if (template.metaTemplateId) {
      url = `${panelRoot(panel)}/${template.metaTemplateId}`;
      payload = { category, components: [body] };
    } else {
      const wabaId = panel.wabaId ?? (await discoverWaba(panel));
      if (!wabaId) throw new Error(NO_WABA);
      url = `${panelRoot(panel)}/${wabaId}/message_templates`;
      payload = { name, category, language: template.languageCode, components: [body] };
    }

    let response;
    try {
      response = await request(url, {
        method: "POST",
        headers: channelHeaders(panel),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new Error(`Could not reach the WhatsApp panel: ${errorText(error)}`);
    }
    if (!response.ok) {
      throw new Error(
        `Meta did not accept it — ${providerError(response.status, response.body, response.text)}`
      );
    }

    // Meta answers a new template with its id, status and category; an edit
    // with `success` alone, which means it has gone back into review.
    const answer = ((response.body ?? {}) as Json) ?? {};
    const inner = ((answer.data as Json | undefined) ?? answer) as Json;
    const status = typeof inner.status === "string" ? inner.status : "PENDING";
    await ctx.runMutation(internal.marketing.recordApplied, {
      templateId: template._id,
      metaTemplateName: name,
      metaTemplateId: inner.id !== undefined ? String(inner.id) : undefined,
      status,
      category: typeof inner.category === "string" ? inner.category : undefined,
    });
    return { status: status.toUpperCase(), name };
  },
});

/**
 * Reads the panel's template list and records where each of this
 * workspace's templates stands. Returns how many changed.
 */
async function reviewWorkspace(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">
): Promise<number> {
  const context = await ctx.runQuery(internal.marketing.reviewContext, { workspaceId });
  if (!context.panel) throw new Error(NO_PANEL);
  if (context.templates.length === 0) return 0;

  const panel: PanelConfig = context.panel;
  const wabaId = context.panel.wabaId ?? (await discoverWaba(panel));
  if (!wabaId) throw new Error(NO_WABA);

  const listed = await listTemplates(panel, wabaId);
  if (!listed.ok) throw new Error(listed.error);

  const rows = context.templates.flatMap((template) => {
    const found = listed.templates.find(
      (row) =>
        row.name === template.metaTemplateName &&
        sameLanguage(row.language, template.languageCode)
    );
    return found
      ? [
          {
            templateId: template.templateId,
            status: found.status,
            metaTemplateId: found.providerId,
            reason: found.rejectedReason,
            category: found.category,
          },
        ]
      : [];
  });
  if (rows.length === 0) return 0;
  const { changed } = await ctx.runMutation(internal.marketing.recordReviews, { rows });
  return changed;
}

/** "Check status" on the Templates tab. */
export const checkStatus = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ changed: number }> => {
    await ctx.runQuery(internal.marketing.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    return { changed: await reviewWorkspace(ctx, args.workspaceId) };
  },
});

/** The review sweep's per-workspace call. Quiet on failure: it runs again. */
export const checkReviews = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<null> => {
    try {
      await reviewWorkspace(ctx, args.workspaceId);
    } catch (error) {
      console.warn("[marketing] template review check failed", args.workspaceId, errorText(error));
    }
    return null;
  },
});
