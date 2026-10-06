import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { audienceCategory, audienceSelection } from "../schema/marketing";
import { sentRecently } from "./marketingStats";
import { tidyName } from "./contactClean";
import { marketOf } from "./markets";

const SIZE_SCAN_CAP = 5000;
const CAP_CHECKS = 1500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type AudienceSelection = Infer<typeof audienceSelection>;
export type AudienceCategory = Infer<typeof audienceCategory>;

export const EVERYONE: AudienceSelection = {
  audienceIds: [],
  categories: [],
  tags: [],
  excludeAudienceIds: [],
};

export const VALID = "valid";
export const NOT_VALID = "invalid";

export const BUILT_IN_CATEGORIES: AudienceCategory[] = [
  {
    key: VALID,
    label: "Valid",
    description: "Has a real name and a WhatsApp number that can receive messages.",
  },
  {
    key: NOT_VALID,
    label: "Not valid",
    description: "The name is missing, fake or a placeholder, or the number cannot be used.",
  },
];

export function isBuiltIn(key: string) {
  return key === VALID || key === NOT_VALID;
}

export function withBuiltIns(stored: AudienceCategory[] | undefined): AudienceCategory[] {
  return [...BUILT_IN_CATEGORIES, ...(stored ?? []).filter((category) => !isBuiltIn(category.key))];
}

export function validityOf(name: string | undefined): string {
  return tidyName(name).value ? VALID : NOT_VALID;
}

export function categoryOf(contact: Pick<Doc<"contacts">, "category" | "name">): string {
  if (contact.category && contact.category !== "unknown") return contact.category;
  return validityOf(contact.name);
}

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
  if (selection.categories.includes(categoryOf(contact))) return true;
  if (contact.tags?.some((tag) => selection.tags.includes(tag))) return true;
  return selection.audienceIds.some((id) => lists.has(id));
}

export async function loadMemberSets(
  ctx: QueryCtx,
  selection: AudienceSelection,
  limit: number
): Promise<Map<Id<"audiences">, Set<Id<"contacts">>>> {
  const sets = new Map<Id<"audiences">, Set<Id<"contacts">>>();
  for (const audienceId of [...selection.audienceIds, ...selection.excludeAudienceIds]) {
    if (sets.has(audienceId)) continue;
    const rows = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", audienceId))
      .take(limit);
    sets.set(audienceId, new Set(rows.map((row) => row.contactId)));
  }
  return sets;
}

export function matchesWith(
  contact: Doc<"contacts">,
  selection: AudienceSelection,
  sets: Map<Id<"audiences">, Set<Id<"contacts">>>
): boolean {
  const member = (id: Id<"audiences">) => sets.get(id)?.has(contact._id) ?? false;
  if (selection.excludeAudienceIds.some(member)) return false;
  if (isEveryone(selection)) return true;
  if (selection.categories.includes(categoryOf(contact))) return true;
  if (contact.tags?.some((tag) => selection.tags.includes(tag))) return true;
  return selection.audienceIds.some(member);
}

export function reachable(contact: Doc<"contacts">): boolean {
  return contact.channelType === "whatsapp" && !contact.optedOutAt;
}

export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}\-_]/gu, "").slice(0, 40);
}

export async function measureAudience(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  selection: AudienceSelection,
  now: number
) {
  const settings = await ctx.db
    .query("marketingSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const cap = settings?.weeklyCap ?? 0;
  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(SIZE_SCAN_CAP);
  const sets = await loadMemberSets(ctx, selection, SIZE_SCAN_CAP);
  let matched = 0;
  let optedOut = 0;
  let overCap = 0;
  let capChecks = 0;
  const byMarket: Record<string, number> = {};
  for (const contact of contacts) {
    if (contact.channelType !== "whatsapp") continue;
    if (!matchesWith(contact, selection, sets)) continue;
    if (!reachable(contact)) {
      optedOut++;
      continue;
    }
    if (cap > 0 && capChecks < CAP_CHECKS) {
      capChecks++;
      if ((await sentRecently(ctx, contact._id, now - WEEK_MS)) >= cap) {
        overCap++;
        continue;
      }
    }
    matched++;
    const market = marketOf(contact.externalId);
    byMarket[market] = (byMarket[market] ?? 0) + 1;
  }
  return {
    reachable: matched,
    byMarket,
    optedOut,
    overCap,
    partial: contacts.length >= SIZE_SCAN_CAP || capChecks >= CAP_CHECKS,
  };
}
