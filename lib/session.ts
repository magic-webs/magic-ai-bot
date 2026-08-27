// Shared session-cookie contract between the route handlers and middleware.
//
// The cookie holds an opaque, long-lived session token and is httpOnly, so
// JavaScript in the browser can never read it. The browser instead calls
// /api/auth/token, which exchanges the cookie for a short-lived JWT that
// Convex verifies. That keeps the durable credential out of reach of XSS.

export const SESSION_COOKIE = "mab_session";

// Non-secret hints so proxy.ts can route the right role to the right place
// without a network call. They are advisory only — Convex re-derives the real
// principal from the JWT on every request.
export const ROLE_COOKIE = "mab_role";
export const WORKSPACE_COOKIE = "mab_ws";

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

export type SessionRole = "admin" | "workspace";

export type SessionInfo = {
  role: SessionRole;
  label: string;
  workspaceSlug: string | null;
};

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}
