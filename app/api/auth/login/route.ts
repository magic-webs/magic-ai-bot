import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexServerClient, errorMessage } from "@/lib/convex-server";
import {
  ROLE_COOKIE,
  SESSION_COOKIE,
  WORKSPACE_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";

type Body = {
  /** Only first-run setup is special; a normal sign-in needs no mode. */
  mode?: "setup";
  username?: string;
  password?: string;
  /** Setup only. */
  email?: string;
  name?: string;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  const convex = convexServerClient();

  try {
    let sessionToken: string;
    let role: "admin" | "workspace";
    let workspaceSlug: string | null;

    if (body.mode === "setup") {
      const result = await convex.action(api.auth.setupFirstAdmin, {
        email: String(body.email ?? ""),
        name: body.name ? String(body.name) : undefined,
        password,
      });
      sessionToken = result.sessionToken;
      role = "admin";
      workspaceSlug = null;
    } else {
      // The server resolves which kind of account this is — the sign-in form
      // never asks the person to choose.
      const result = await convex.action(api.auth.login, {
        username: String(body.username ?? ""),
        password,
      });
      sessionToken = result.sessionToken;
      role = result.role;
      workspaceSlug = result.workspaceSlug;
    }

    const redirectTo =
      role === "workspace" && workspaceSlug ? `/w/${workspaceSlug}` : "/admin";

    const jar = await cookies();
    jar.set({
      name: SESSION_COOKIE,
      value: sessionToken,
      ...sessionCookieOptions(),
    });
    jar.set({ name: ROLE_COOKIE, value: role, ...sessionCookieOptions() });
    if (workspaceSlug) {
      jar.set({
        name: WORKSPACE_COOKIE,
        value: workspaceSlug,
        ...sessionCookieOptions(),
      });
    } else {
      jar.delete(WORKSPACE_COOKIE);
    }

    return NextResponse.json({ ok: true, redirectTo });
  } catch (error) {
    // Deliberately generic: never reveal whether the account exists.
    return NextResponse.json({ error: errorMessage(error) }, { status: 401 });
  }
}
