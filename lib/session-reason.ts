import { api } from "@/convex/_generated/api";
import type { ConvexHttpClient } from "convex/browser";
import type { SessionEndReason } from "@/lib/session";

/**
 * Why a session cookie no longer works, for the page it was open on. Only
 * asked once minting has already failed, so it costs nothing on the way in.
 */
export async function sessionEndReason(
  convex: ConvexHttpClient,
  sessionToken: string
): Promise<SessionEndReason | null> {
  try {
    return await convex.action(api.auth.endedReason, { sessionToken });
  } catch {
    return null;
  }
}
