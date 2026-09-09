import { NextResponse, type NextRequest } from "next/server";
import { ROLE_COOKIE, SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/session";

const LOGIN_PATH = "/login";

/** The area a session belongs to. Mirrors the redirect the login route returns. */
function homeFor(role: string | undefined, ownSlug: string | undefined) {
  return role === "workspace" && ownSlug ? `/w/${ownSlug}` : "/admin";
}

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
  const role = cookies.get(ROLE_COOKIE)?.value;
  const ownSlug = cookies.get(WORKSPACE_COOKIE)?.value;

  // Already signed in? The sign-in form has nothing to offer — bounce to the
  // area this session owns. Doing it here rather than in the page means no
  // form flashes up before the redirect.
  if (pathname === LOGIN_PATH) {
    if (!hasSession) return NextResponse.next();

    const home = homeFor(role, ownSlug);
    const next = request.nextUrl.searchParams.get("next");

    // Honour ?next= only when it sits inside that area — the same rule the
    // form applies after a successful sign-in, and it rules out a stale or
    // hostile link sending someone somewhere they cannot open.
    return NextResponse.redirect(
      new URL(next && next.startsWith(home) ? next : home, request.url)
    );
  }

  if (!hasSession) {
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

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
  matcher: ["/login", "/admin/:path*", "/w/:path*"],
};
