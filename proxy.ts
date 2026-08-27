import { NextResponse, type NextRequest } from "next/server";
import { ROLE_COOKIE, SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/session";

// Route-level gate, named `proxy` per the Next 16 convention that replaced
// `middleware`.
//
// This is a UX guard only: it keeps signed-out visitors off protected pages and
// sends each role to the area that belongs to it, so nothing flashes before a
// redirect. Every authorization decision that actually matters is made inside
// the Convex functions, which verify the JWT and re-read the principal on each
// request — a forged cookie here buys nothing.
export function proxy(request: NextRequest) {
  const cookies = request.cookies;
  const hasSession = Boolean(cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;

  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const role = cookies.get(ROLE_COOKIE)?.value;
  const ownSlug = cookies.get(WORKSPACE_COOKIE)?.value;

  if (role === "workspace" && ownSlug) {
    // A company has no platform area.
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return NextResponse.redirect(new URL(`/w/${ownSlug}`, request.url));
    }

    // …and exactly one workspace.
    const match = pathname.match(/^\/w\/([^/]+)/);
    if (match && match[1] !== ownSlug) {
      return NextResponse.redirect(new URL(`/w/${ownSlug}`, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/w/:path*"],
};
