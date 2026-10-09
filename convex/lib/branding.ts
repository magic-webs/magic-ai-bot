import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { urlFor } from "./files";

/**
 * The company logo to draw, whichever way it was supplied, or null for none.
 *
 * An upload wins over a pasted link, the rule team photos follow: somebody who
 * uploads over a link they pasted earlier means the upload. Resolved on the
 * server because a storage id is not something a browser can draw.
 */
export async function logoSrcFor(
  ctx: Pick<QueryCtx, "storage">,
  workspace: Pick<Doc<"workspaces">, "logoKey" | "logoStorageId" | "logoUrl">
): Promise<string | null> {
  const url = await urlFor(ctx, workspace.logoKey, workspace.logoStorageId);
  if (url) return url;
  return workspace.logoUrl?.trim() || null;
}
