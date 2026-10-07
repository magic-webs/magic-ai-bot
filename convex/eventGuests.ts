import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { choiceOf, evaluate, JEV_MODEL } from "./lib/jev";
import { normalisePhone } from "./lib/notifications";
import { rsvpStatus } from "./schema/marketing";

const SUMMARY_SCAN = 5000;
const BULK = 400;
const RSVP_CONFIDENCE = 0.7;

async function requireEvent(ctx: QueryCtx, campaignId: Id<"marketingCampaigns">) {
  const campaign = await ctx.db.get("marketingCampaigns", campaignId);
  if (!campaign) throw new ConvexError("Event not found");
  await requireWorkspace(ctx, campaign.workspaceId);
  return campaign;
}

async function guestOf(
  ctx: QueryCtx,
  campaignId: Id<"marketingCampaigns">,
  contactId: Id<"contacts">
) {
  return await ctx.db
    .query("eventGuests")
    .withIndex("by_campaignId_and_contactId", (q) =>
      q.eq("campaignId", campaignId).eq("contactId", contactId)
    )
    .unique();
}

async function upsertGuest(
  ctx: MutationCtx,
  campaign: Doc<"marketingCampaigns">,
  contactId: Id<"contacts">,
  patch: Partial<Doc<"eventGuests">>
) {
  const now = Date.now();
  const existing = await guestOf(ctx, campaign._id, contactId);
  if (existing) {
    await ctx.db.patch("eventGuests", existing._id, { ...patch, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("eventGuests", {
    workspaceId: campaign.workspaceId,
    campaignId: campaign._id,
    contactId,
    ...patch,
    updatedAt: now,
  });
}

export const summary = query({
  args: { campaignId: v.id("marketingCampaigns") },
  handler: async (ctx, args) => {
    await requireEvent(ctx, args.campaignId);
    const guests = await ctx.db
      .query("eventGuests")
      .withIndex("by_campaignId_and_contactId", (q) => q.eq("campaignId", args.campaignId))
      .take(SUMMARY_SCAN);
    const counts = { going: 0, maybe: 0, declined: 0, attended: 0, noShow: 0 };
    for (const guest of guests) {
      if (guest.rsvp) counts[guest.rsvp]++;
      if (guest.attended) counts.attended++;
      else if (guest.rsvp === "going" || guest.rsvp === "maybe") counts.noShow++;
    }
    return { ...counts, partial: guests.length >= SUMMARY_SCAN };
  },
});

export const list = query({
  args: {
    campaignId: v.id("marketingCampaigns"),
    filter: v.union(
      v.literal("all"),
      v.literal("going"),
      v.literal("maybe"),
      v.literal("declined"),
      v.literal("attended")
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireEvent(ctx, args.campaignId);
    const filter = args.filter;
    const page =
      filter === "all"
        ? await ctx.db
            .query("eventGuests")
            .withIndex("by_campaignId_and_contactId", (q) => q.eq("campaignId", args.campaignId))
            .paginate(args.paginationOpts)
        : filter === "attended"
          ? await ctx.db
              .query("eventGuests")
              .withIndex("by_campaignId_and_attended", (q) =>
                q.eq("campaignId", args.campaignId).eq("attended", true)
              )
              .paginate(args.paginationOpts)
          : await ctx.db
              .query("eventGuests")
              .withIndex("by_campaignId_and_rsvp", (q) =>
                q.eq("campaignId", args.campaignId).eq("rsvp", filter)
              )
              .paginate(args.paginationOpts);
    const rows = [];
    for (const guest of page.page) {
      const contact = await ctx.db.get("contacts", guest.contactId);
      rows.push({
        ...guest,
        name: contact?.name ?? null,
        phone: contact?.externalId ?? "",
      });
    }
    return { ...page, page: rows };
  },
});

export const setRsvp = mutation({
  args: {
    campaignId: v.id("marketingCampaigns"),
    contactId: v.id("contacts"),
    rsvp: v.union(rsvpStatus, v.null()),
  },
  handler: async (ctx, args) => {
    const campaign = await requireEvent(ctx, args.campaignId);
    await upsertGuest(ctx, campaign, args.contactId, {
      rsvp: args.rsvp ?? undefined,
      rsvpSource: args.rsvp ? "manual" : undefined,
      respondedAt: args.rsvp ? Date.now() : undefined,
    });
    return { success: true };
  },
});

export const setAttended = mutation({
  args: {
    campaignId: v.id("marketingCampaigns"),
    contactIds: v.array(v.id("contacts")),
    attended: v.boolean(),
  },
  handler: async (ctx, args) => {
    const campaign = await requireEvent(ctx, args.campaignId);
    if (args.contactIds.length > BULK) throw new ConvexError(`Pick at most ${BULK} people.`);
    const now = Date.now();
    for (const contactId of args.contactIds) {
      await upsertGuest(ctx, campaign, contactId, {
        attended: args.attended || undefined,
        checkedInAt: args.attended ? now : undefined,
      });
    }
    return { updated: args.contactIds.length };
  },
});

export const checkIn = mutation({
  args: {
    campaignId: v.id("marketingCampaigns"),
    phone: v.string(),
    name: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const campaign = await requireEvent(ctx, args.campaignId);
    const digits = normalisePhone(args.phone, args.countryCode ?? "91");
    if (!digits) throw new ConvexError("That is not a phone number.");
    const now = Date.now();
    let contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", campaign.workspaceId).eq("externalId", digits)
      )
      .unique();
    if (!contact) {
      const contactId = await ctx.db.insert("contacts", {
        workspaceId: campaign.workspaceId,
        externalId: digits,
        channelType: "whatsapp",
        phone: digits,
        name: args.name?.trim() || undefined,
        attributes: [],
        source: "manual",
        tags: ["walk-in"],
        lastSeenAt: now,
        createdAt: now,
      });
      contact = (await ctx.db.get("contacts", contactId))!;
    }
    await upsertGuest(ctx, campaign, contact._id, { attended: true, checkedInAt: now });
    return { name: contact.name ?? null, phone: digits };
  },
});

export const markInterestedAttended = mutation({
  args: { campaignId: v.id("marketingCampaigns") },
  handler: async (ctx, args) => {
    const campaign = await requireEvent(ctx, args.campaignId);
    await ctx.scheduler.runAfter(0, internal.eventGuests.markBatch, {
      campaignId: campaign._id,
      cursor: null,
    });
    return { success: true };
  },
});

export const markBatch = internalMutation({
  args: { campaignId: v.id("marketingCampaigns"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("eventGuests")
      .withIndex("by_campaignId_and_contactId", (q) => q.eq("campaignId", args.campaignId))
      .paginate({ numItems: BULK, cursor: args.cursor });
    const now = Date.now();
    for (const guest of page.page) {
      if (guest.attended || guest.rsvp !== "going") continue;
      await ctx.db.patch("eventGuests", guest._id, { attended: true, checkedInAt: now, updatedAt: now });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.eventGuests.markBatch, {
        ...args,
        cursor: page.continueCursor,
      });
    }
  },
});

export const readReply = internalAction({
  args: {
    campaignId: v.id("marketingCampaigns"),
    contactId: v.id("contacts"),
    workspaceId: v.id("workspaces"),
    eventTitle: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const text = args.text.trim().slice(0, 600);
    if (!text) return null;
    try {
      const result = await evaluate(
        `A customer was invited to "${args.eventTitle}" and replied:\n${text}`,
        {
          rsvp: {
            type: "choice",
            instructions: "What does the reply say about coming to the event",
            criteria: {
              going: "They will come, or say yes, confirm, or ask to book a place",
              maybe: "They might come, are unsure, or will try",
              declined: "They will not come, say no, or cannot make it",
              unrelated: "The reply is about something else or does not say",
            },
          },
        }
      );
      await ctx.runMutation(internal.usage.record, {
        workspaceId: args.workspaceId,
        source: "sort_contacts",
        model: JEV_MODEL,
        kind: "chat",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      const choice = choiceOf(result.answers.rsvp);
      if (!choice || choice.choice === "unrelated" || choice.confidence < RSVP_CONFIDENCE) return null;
      await ctx.runMutation(internal.eventGuests.recordRsvp, {
        campaignId: args.campaignId,
        contactId: args.contactId,
        rsvp: choice.choice as "going" | "maybe" | "declined",
        text,
      });
    } catch (error) {
      console.warn("[events] could not read an RSVP", error);
    }
    return null;
  },
});

export const recordRsvp = internalMutation({
  args: {
    campaignId: v.id("marketingCampaigns"),
    contactId: v.id("contacts"),
    rsvp: rsvpStatus,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get("marketingCampaigns", args.campaignId);
    if (!campaign) return;
    const existing = await guestOf(ctx, campaign._id, args.contactId);
    if (existing?.rsvpSource === "manual") return;
    await upsertGuest(ctx, campaign, args.contactId, {
      rsvp: args.rsvp,
      rsvpSource: "reply",
      rsvpText: args.text.slice(0, 300),
      respondedAt: Date.now(),
    });
  },
});
