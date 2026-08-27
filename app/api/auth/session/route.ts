import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexServerClient } from "@/lib/convex-server";
import { SESSION_COOKIE } from "@/lib/session";

/** Who the current cookie belongs to. Drives the app shell and route guards. */
export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ session: null }, { status: 200 });
  }

  try {
    const minted = await convexServerClient().action(api.auth.mintAccessToken, {
      sessionToken,
    });
    if (!minted) {
      const response = NextResponse.json({ session: null }, { status: 200 });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }

    return NextResponse.json(
      {
        session: {
          role: minted.role,
          workspaceSlug: minted.workspaceSlug,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ session: null }, { status: 200 });
  }
}
