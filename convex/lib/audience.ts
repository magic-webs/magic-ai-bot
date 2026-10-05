import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { audienceCategory, audienceSelection } from "../schema/marketing";

export type AudienceSelection = Infer<typeof audienceSelection>;
export type AudienceCategory = Infer<typeof audienceCategory>;

export const EVERYONE: AudienceSelection = {
  audienceIds: [],
  categories: [],
  tags: [],
  excludeAudienceIds: [],
};

export const DEFAULT_CATEGORIES: AudienceCategory[] = [
  {
    key: "customer",
    label: "Customers",
    description: "Has bought from the business or uses its service now.",
  },
  {
    key: "lead",
    label: "Leads",
    description: "Showed interest or asked about buying, but has not bought yet.",
  },
  {
    key: "partner",
    label: "Partners & vendors",
    description: "A supplier, vendor, agent, dealer or business the company works with.",
  },
  {
    key: "personal",
    label: "Personal",
    description: "Family, friends, staff or someone known personally rather than as a customer.",
  },
  {
    key: "unknown",
    label: "Unsorted",
    description: "Nothing in the details says which of the others this person is.",
  },
];

export function isEveryone(selection: AudienceSelection | undefined): boolean {
  return (
    !selection ||
    (selection.audienceIds.length === 0 &&
      selection.categories.length === 0 &&
      selection.tags.length === 0)
  );
}

export async function membershipsOf(
  ctx: QueryCtx,
  contactId: Id<"contacts">
): Promise<Set<Id<"audiences">>> {
  const rows = await ctx.db
    .query("audienceMembers")
    .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
    .take(200);
  return new Set(rows.map((row) => row.audienceId));
}

export async function inSelection(
  ctx: QueryCtx,
  contact: Doc<"contacts">,
  selection: AudienceSelection | undefined
): Promise<boolean> {
  if (!selection) return true;
  const needsLists =
    selection.audienceIds.length > 0 || selection.excludeAudienceIds.length > 0;
  const lists = needsLists ? await membershipsOf(ctx, contact._id) : new Set();
  if (selection.excludeAudienceIds.some((id) => lists.has(id))) return false;
  if (isEveryone(selection)) return true;
  if (contact.category && selection.categories.includes(contact.category)) return true;
  if (contact.tags?.some((tag) => selection.tags.includes(tag))) return true;
  return selection.audienceIds.some((id) => lists.has(id));
}

export function reachable(contact: Doc<"contacts">): boolean {
  return contact.channelType === "whatsapp" && !contact.optedOutAt;
}

export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}\-_]/gu, "").slice(0, 40);
}
