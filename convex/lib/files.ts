import { R2 } from "@convex-dev/r2";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const r2 = new R2(components.r2);

export type FileFolder = "logos" | "team" | "products" | "knowledge" | "speech";

export function newFileKey(folder: FileFolder, workspaceId: Id<"workspaces">) {
  return `${folder}/${workspaceId}/${crypto.randomUUID()}`;
}

export function requireOwnKey(
  key: string | undefined,
  folder: FileFolder,
  workspaceId: Id<"workspaces">
) {
  if (key && !key.startsWith(`${folder}/${workspaceId}/`)) {
    throw new ConvexError("That file belongs to another workspace.");
  }
}

export function fileUrl(key: string): string {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error("R2_PUBLIC_URL is not set");
  return `${base.replace(/\/+$/, "")}/${key}`;
}

export async function urlFor(
  ctx: Pick<QueryCtx, "storage">,
  key: string | undefined,
  legacyId?: Id<"_storage">
): Promise<string | null> {
  if (key) return fileUrl(key);
  if (legacyId) return await ctx.storage.getUrl(legacyId);
  return null;
}

export async function deleteFile(
  ctx: MutationCtx,
  key: string | undefined,
  legacyId?: Id<"_storage">
) {
  if (key) await r2.deleteObject(ctx, key).catch(() => undefined);
  if (legacyId) await ctx.storage.delete(legacyId).catch(() => undefined);
}

export async function uploadUrlFor(
  folder: FileFolder,
  workspaceId: Id<"workspaces">
) {
  return await r2.generateUploadUrl(newFileKey(folder, workspaceId));
}
