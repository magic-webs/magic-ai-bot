import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexServerClient } from "@/lib/convex-server";
import { SESSION_COOKIE } from "@/lib/session";

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
    const minted = await convexServerClient().action(api.auth.mintAccessToken, {
      sessionToken,
    });
    if (!minted) {
      // Session expired, or the company's access was revoked.
      const response = NextResponse.json(
        { error: "Session is no longer valid." },
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
