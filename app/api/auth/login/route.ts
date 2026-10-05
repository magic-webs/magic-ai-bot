import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexServerClient, errorMessage } from "@/lib/convex-server";
import { describeUserAgent } from "@/lib/device";
import {
  CHALLENGE_COOKIE,
  DESK_PATH,
  ROLE_COOKIE,
  SESSION_COOKIE,
  WORKSPACE_COOKIE,
  challengeCookieOptions,
  sessionCookieOptions,
  type SessionRole,
} from "@/lib/session";

type Body = {
  /**
   * Only first-run setup and the second step are special; a normal sign-in
   * needs no mode. `continue` answers whatever the first step asked — the
   * authenticator code, or whether to sign out the session already open.
   */
  mode?: "setup" | "continue";
  username?: string;
  password?: string;
  /** Setup only. */
  email?: string;
  name?: string;
  /** Continue only: a six-digit code, or a recovery code. */
  code?: string;
  /** Continue only: sign out the other session and take its place. */
  replace?: boolean;
};

type Jar = Awaited<ReturnType<typeof cookies>>;

function signedIn(
  jar: Jar,
  sessionToken: string,
  role: SessionRole,
  workspaceSlug: string | null
) {
  // A human agent lands in the company's workspace, like the company login.
  const redirectTo =
    (role === "workspace" || role === "member" || role === "user") && workspaceSlug
      ? `/w/${workspaceSlug}`
      : role === "member"
        ? DESK_PATH
        : "/admin";

  jar.delete(CHALLENGE_COOKIE);
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
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (body.mode !== "continue" && !password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  const convex = convexServerClient();
  const jar = await cookies();

  try {
    if (body.mode === "setup") {
      const result = await convex.action(api.auth.setupFirstAdmin, {
        email: String(body.email ?? ""),
        name: body.name ? String(body.name) : undefined,
        password,
      });
      return signedIn(jar, result.sessionToken, "admin", null);
    }

    let outcome;
    if (body.mode === "continue") {
      // Held in a cookie rather than handed to the page, so script on it
      // never sees a token that can finish somebody's sign-in.
      const challenge = jar.get(CHALLENGE_COOKIE)?.value;
      if (!challenge) {
        return NextResponse.json(
          { error: "This sign-in has expired. Sign in again.", restart: true },
          { status: 401 }
        );
      }
      outcome = await convex.action(api.auth.continueLogin, {
        challenge,
        code: typeof body.code === "string" ? body.code : undefined,
        replace: body.replace === true,
      });
    } else {
      // The server resolves which kind of account this is — the sign-in form
      // never asks the person to choose.
      outcome = await convex.action(api.auth.login, {
        username: String(body.username ?? ""),
        password,
        client: "web",
        device: describeUserAgent(request.headers.get("user-agent")),
      });
    }

    if (outcome.status === "signedIn") {
      return signedIn(
        jar,
        outcome.sessionToken,
        outcome.role,
        outcome.workspaceSlug
      );
    }

    jar.set({
      name: CHALLENGE_COOKIE,
      value: outcome.challenge,
      ...challengeCookieOptions(),
    });
    return NextResponse.json(
      outcome.status === "twoFactor"
        ? { step: "twoFactor" }
        : { step: "sessionActive", activeSession: outcome.activeSession }
    );
  } catch (error) {
    // Deliberately generic: never reveal whether the account exists.
    const message = errorMessage(error);
    const restart = body.mode === "continue" && /expired/i.test(message);
    if (restart) jar.delete(CHALLENGE_COOKIE);
    return NextResponse.json({ error: message, restart }, { status: 401 });
  }
}
