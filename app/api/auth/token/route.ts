import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexServerClient } from "@/lib/convex-server";
import { SESSION_COOKIE } from "@/lib/session";
import { sessionEndReason } from "@/lib/session-reason";

/**
 * Exchange the httpOnly session cookie for a short-lived Convex JWT.
 * Called by the browser's Convex auth hook, so the durable session token
 * itself never reaches client-side JavaScript.
 */
export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No session." }, { status: 401 });
  }

  try {
    const convex = convexServerClient();
    const minted = await convex.action(api.auth.mintAccessToken, {
      sessionToken,
    });
    if (!minted) {
      // Session expired, the company's access was revoked, or the login was
      // signed in somewhere else — the one case worth telling the page.
      const response = NextResponse.json(
        {
          error: "Session is no longer valid.",
          reason: await sessionEndReason(convex, sessionToken),
        },
        { status: 401 }
      );
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }

    return NextResponse.json(minted, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not refresh session." }, { status: 401 });
  }
}
