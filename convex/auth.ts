"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

// OWASP's 2023 floor for PBKDF2-SHA256.
const PBKDF2_ITERATIONS = 210_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_TOKEN_TTL_S = 30 * 60; // 30 minutes
const JWT_AUDIENCE = "magic-ai-bot";
const JWT_KID = "magic-ai-bot-1";

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

function b64(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes as never).toString("base64");
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as never, iterations, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** Stored as `pbkdf2$<iterations>$<saltB64>$<hashB64>`. */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A well-formed hash that cannot match. Used when no account was found so the
 * failure path runs exactly one KDF pass, same as a real password check —
 * otherwise response time would reveal whether the username exists.
 */
function unmatchableHash(): string {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const noise = crypto.getRandomValues(new Uint8Array(32));
    return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(noise)}`;
}

async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, iterationsRaw, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationsRaw || !saltB64 || !hashB64) {
    return false;
  }
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  const salt = new Uint8Array(Buffer.from(saltB64, "base64"));
  const candidate = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(b64(candidate), hashB64);
}

// ---------------------------------------------------------------------------
// Generated passwords
//
// Ambiguous glyphs (0/O, 1/l/I) are excluded because these get read aloud,
// pasted into chat and retyped by hand.
// ---------------------------------------------------------------------------

const PASSWORD_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(groups = 4, groupSize = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * groupSize));
  const chars = Array.from(
    bytes,
    (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
  );
  const out: string[] = [];
  for (let i = 0; i < groups; i++) {
    out.push(chars.slice(i * groupSize, (i + 1) * groupSize).join(""));
  }
  return out.join("-");
}

// ---------------------------------------------------------------------------
// Session tokens and access JWTs
// ---------------------------------------------------------------------------

function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .toString("base64url");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function b64url(input: string | Uint8Array): string {
  return Buffer.from(input as never).toString("base64url");
}

async function signAccessToken(subject: string, ttlSeconds: number) {
  const privateB64 = process.env.JWT_PRIVATE_KEY;
  if (!privateB64) {
    throw new Error(
      "JWT_PRIVATE_KEY is not set on the Convex deployment. See the Authentication section of README.md for key setup."
    );
  }

  const key = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(privateB64, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: JWT_KID })
  );
  const payload = b64url(
    JSON.stringify({
      iss: process.env.CONVEX_SITE_URL,
      aud: JWT_AUDIENCE,
      sub: subject,
      iat: now,
      nbf: now - 5,
      exp: now + ttlSeconds,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  return {
    token: `${signingInput}.${b64url(new Uint8Array(signature))}`,
    expiresAt: (now + ttlSeconds) * 1000,
  };
}

// ---------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------

export const setupFirstAdmin = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    password: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sessionToken: string; expiresAt: number }> => {
    // Only reachable while the platform has no administrator at all.
    const existing: number = await ctx.runQuery(internal.authDb.countAdmins, {});
    if (existing > 0) {
      throw new Error("Setup has already been completed.");
    }

    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    if (args.password.length < 12) {
      throw new Error("Choose a password of at least 12 characters.");
    }

    const adminId: Id<"admins"> = await ctx.runMutation(
      internal.authDb.insertAdmin,
      {
        email,
        name: args.name?.trim() || undefined,
        passwordHash: await hashPassword(args.password),
        requireFirst: true,
      }
    );

    return await issueSession(ctx, { role: "admin", adminId });
  },
});

/**
 * Set the administrator's password from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * An internalAction, so the only callers are the Convex CLI and dashboard:
 * deploy access *is* the authorization. That is what makes it safe to be the
 * recovery path — a lost administrator password cannot be reset through any
 * signed-in flow, because you cannot sign in to use it.
 *
 * Run it with `npm run provision:admin`.
 */
export const provisionAdmin = internalAction({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    password: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    email: string;
    created: boolean;
    sessionsRevoked: number;
  }> => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(`ADMIN_EMAIL is not a valid email address: "${email}"`);
    }
    if (args.password.length < 16) {
      throw new Error(
        "ADMIN_PASSWORD must be at least 16 characters. This account administers every workspace on the platform."
      );
    }

    const result: { created: boolean; sessionsRevoked: number } =
      await ctx.runMutation(internal.authDb.upsertAdminPassword, {
        email,
        name: args.name?.trim() || undefined,
        passwordHash: await hashPassword(args.password),
      });

    return { email, ...result };
  },
});

export const createAdmin = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<{ adminId: Id<"admins"> }> => {
    const principal = await ctx.runQuery(api.authDb.me, {});
    if (principal?.role !== "admin") {
      throw new Error("Administrator access required.");
    }
    if (args.password.length < 12) {
      throw new Error("Choose a password of at least 12 characters.");
    }

    const adminId: Id<"admins"> = await ctx.runMutation(
      internal.authDb.insertAdmin,
      {
        email: args.email.trim().toLowerCase(),
        name: args.name?.trim() || undefined,
        passwordHash: await hashPassword(args.password),
        requireFirst: false,
      }
    );
    return { adminId };
  },
});

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

async function issueSession(
  ctx: ActionCtx,
  principal:
    | { role: "admin"; adminId: Id<"admins"> }
    | { role: "workspace"; workspaceId: Id<"workspaces"> }
): Promise<{ sessionToken: string; expiresAt: number }> {
  const sessionToken = randomToken(32);
  const expiresAt = Date.now() + SESSION_TTL_MS;

  await ctx.runMutation(internal.authDb.createSession, {
    tokenHash: await sha256Hex(sessionToken),
    role: principal.role,
    adminId: principal.role === "admin" ? principal.adminId : undefined,
    workspaceId:
      principal.role === "workspace" ? principal.workspaceId : undefined,
    expiresAt,
  });

  return { sessionToken, expiresAt };
}

/**
 * One sign-in for both kinds of principal.
 *
 * The username is matched against administrator emails first, then workspace
 * IDs. An email always contains "@" and a workspace ID never does, so the two
 * namespaces cannot collide. The caller is told which area to open rather than
 * being asked to choose a role up front.
 */
export const login = action({
  args: { username: v.string(), password: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    sessionToken: string;
    expiresAt: number;
    role: "admin" | "workspace";
    label: string;
    workspaceSlug: string | null;
    mustChangePassword: boolean;
  }> => {
    const identifier = args.username.trim().toLowerCase();
    const generic = "Incorrect username or password.";

    const admin: Doc<"admins"> | null = await ctx.runQuery(
      internal.authDb.adminByEmail,
      { email: identifier }
    );

    const workspace: Doc<"workspaces"> | null = admin
      ? null
      : await ctx.runQuery(internal.authDb.workspaceBySlug, {
          slug: identifier,
        });

    const credential: Doc<"workspaceCredentials"> | null = workspace
      ? await ctx.runQuery(internal.authDb.credentialForWorkspace, {
          workspaceId: workspace._id,
        })
      : null;

    const stored =
      admin?.passwordHash ??
      (credential?.status === "active" ? credential.passwordHash : undefined);

    // Always verify something, so a wrong username and a wrong password are
    // indistinguishable from the outside.
    const ok = await verifyPassword(args.password, stored ?? unmatchableHash());
    if (!ok || !stored) throw new Error(generic);

    if (admin) {
      const session = await issueSession(ctx, {
        role: "admin",
        adminId: admin._id,
      });
      return {
        ...session,
        role: "admin",
        label: admin.name?.trim() || admin.email,
        workspaceSlug: null,
        mustChangePassword: false,
      };
    }

    // Only reachable with a matching, active workspace credential.
    if (!workspace || !credential) throw new Error(generic);
    if (workspace.status === "archived") {
      throw new Error("This workspace has been archived.");
    }

    const session = await issueSession(ctx, {
      role: "workspace",
      workspaceId: workspace._id,
    });
    return {
      ...session,
      role: "workspace",
      label: workspace.name,
      workspaceSlug: workspace.slug,
      mustChangePassword: credential.mustChangePassword,
    };
  },
});

export const logout = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ success: true }> => {
    await ctx.runMutation(internal.authDb.deleteSession, {
      tokenHash: await sha256Hex(args.sessionToken),
    });
    return { success: true };
  },
});

/**
 * Exchange the long-lived session cookie for a short-lived JWT that Convex
 * will accept. Called by the Next route handler, never by the browser, so the
 * session token itself stays in an httpOnly cookie.
 */
export const mintAccessToken = action({
  args: { sessionToken: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    token: string;
    expiresAt: number;
    role: "admin" | "workspace";
    workspaceSlug: string | null;
  } | null> => {
    const session: Doc<"authSessions"> | null = await ctx.runQuery(
      internal.authDb.sessionByHash,
      { tokenHash: await sha256Hex(args.sessionToken) }
    );
    if (!session || session.expiresAt < Date.now()) return null;

    let subject: string;
    let workspaceSlug: string | null = null;

    if (session.role === "admin") {
      if (!session.adminId) return null;
      subject = `admin|${session.adminId}`;
    } else {
      if (!session.workspaceId) return null;
      const credential: Doc<"workspaceCredentials"> | null =
        await ctx.runQuery(internal.authDb.credentialForWorkspace, {
          workspaceId: session.workspaceId,
        });
      if (credential?.status !== "active") return null;

      const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
        internal.workspaces.getInternal,
        { workspaceId: session.workspaceId }
      );
      if (!workspace) return null;
      workspaceSlug = workspace.slug;
      subject = `workspace|${session.workspaceId}`;
    }

    await ctx.runMutation(internal.authDb.touchSession, {
      sessionId: session._id,
    });

    const signed = await signAccessToken(subject, ACCESS_TOKEN_TTL_S);
    return {
      token: signed.token,
      expiresAt: signed.expiresAt,
      role: session.role,
      workspaceSlug,
    };
  },
});

// ---------------------------------------------------------------------------
// Workspace access management (admin)
// ---------------------------------------------------------------------------

export const generateWorkspacePassword = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{ password: string; slug: string }> => {
    const principal = await ctx.runQuery(api.authDb.me, {});
    if (principal?.role !== "admin") {
      throw new Error("Administrator access required.");
    }

    const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
      internal.workspaces.getInternal,
      { workspaceId: args.workspaceId }
    );
    if (!workspace) throw new Error("Workspace not found");

    const password = generatePassword();
    await ctx.runMutation(internal.authDb.upsertWorkspaceCredential, {
      workspaceId: args.workspaceId,
      passwordHash: await hashPassword(password),
      // Not flagged for a forced change: the prompt this drove was advisory
      // only — nothing gated on it — and it is no longer shown.
      mustChangePassword: false,
      revokeSessions: true,
    });

    // Returned once. Only the hash is kept.
    return { password, slug: workspace.slug };
  },
});

export const setWorkspaceAccess = action({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.union(v.literal("active"), v.literal("revoked")),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const principal = await ctx.runQuery(api.authDb.me, {});
    if (principal?.role !== "admin") {
      throw new Error("Administrator access required.");
    }
    await ctx.runMutation(internal.authDb.setCredentialStatus, {
      workspaceId: args.workspaceId,
      status: args.status,
    });
    return { success: true };
  },
});

/** The company changing its own password after first sign-in. */
export const changeWorkspacePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const principal = await ctx.runQuery(api.authDb.me, {});
    if (principal?.role !== "workspace" || !principal.workspaceSlug) {
      throw new Error("Sign in to the workspace first.");
    }
    if (args.newPassword.length < 12) {
      throw new Error("Choose a password of at least 12 characters.");
    }

    const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
      internal.authDb.workspaceBySlug,
      { slug: principal.workspaceSlug }
    );
    if (!workspace) throw new Error("Workspace not found");

    const credential: Doc<"workspaceCredentials"> | null = await ctx.runQuery(
      internal.authDb.credentialForWorkspace,
      { workspaceId: workspace._id }
    );
    if (!credential) throw new Error("This workspace has no password yet.");

    if (!(await verifyPassword(args.currentPassword, credential.passwordHash))) {
      throw new Error("The current password is incorrect.");
    }

    await ctx.runMutation(internal.authDb.replaceOwnCredential, {
      workspaceId: workspace._id,
      passwordHash: await hashPassword(args.newPassword),
    });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

export const purgeExpiredSessions = internalAction({
  args: {},
  handler: async (ctx): Promise<{ removed: number }> => {
    return await ctx.runMutation(internal.authDb.deleteExpiredSessions, {});
  },
});
