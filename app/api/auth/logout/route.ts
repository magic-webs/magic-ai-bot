import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexServerClient } from "@/lib/convex-server";
import {
  ROLE_COOKIE,
  SESSION_COOKIE,
  WORKSPACE_COOKIE,
} from "@/lib/session";

export async function POST() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;

  if (sessionToken) {
    // Best effort: drop the server-side session so the token cannot be reused.
    try {
      await convexServerClient().action(api.auth.logout, { sessionToken });
    } catch {
      /* the cookie is cleared regardless */
    }
  }

  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ROLE_COOKIE);
  jar.delete(WORKSPACE_COOKIE);

  return NextResponse.json({ ok: true });
}
