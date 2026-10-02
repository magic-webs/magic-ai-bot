"use node";

import { createHmac } from "node:crypto";
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
/** How long a sign-in waits at the code, or at "sign out the other one?". */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

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
// Authenticator codes: TOTP, RFC 6238 — HMAC-SHA1, six digits, 30 seconds.
// The settings every authenticator app defaults to, so none has to be told.
// ---------------------------------------------------------------------------

const TOTP_ISSUER = "Magic Agent";
const TOTP_STEP_S = 30;
const TOTP_DIGITS = 6;
/** One step either side, for a phone clock that has drifted. */
const TOTP_WINDOW = 1;
const RECOVERY_CODE_COUNT = 10;
/** Lower case only and no look-alikes: these get written down on paper. */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4226's HOTP for one counter value. */
function hotp(key: Uint8Array, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * The time step a code belongs to, or null. Steps at or before the last one
 * accepted are skipped, so a code seen over someone's shoulder is spent.
 */
function matchingStep(
  secret: string,
  code: string,
  lastUsedStep: number | null
): number | null {
  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000 / TOTP_STEP_S);
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(hotp(key, step), code)) return step;
  }
  return null;
}

function otpauthUri(secret: string, account: string): string {
  const issuer = encodeURIComponent(TOTP_ISSUER);
  const params = new URLSearchParams({
    secret,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_S),
  });
  return `otpauth://totp/${issuer}:${encodeURIComponent(account)}?${params}`;
}

/** Shown as `abcde-fghjk`; stored hashed without the dash. */
function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(
    bytes,
    (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]
  ).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toLowerCase();
}

function untilText(timestamp: number): string {
  const minutes = Math.max(1, Math.ceil((timestamp - Date.now()) / 60_000));
  if (minutes < 90) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `in ${Math.ceil(minutes / 60)} hours`;
}

/**
 * Checks a six-digit code — or, once the authenticator is on, a recovery
 * code — against a login's authenticator, and throws unless it counts.
 *
 * `expect` is which state the authenticator must be in: `pending` while it is
 * being set up, where the first good code turns it on with `activate`'s
 * recovery codes; `active` for everything after.
 */
async function checkCode(
  ctx: ActionCtx,
  principal: string,
  rawCode: string,
  expect: "pending" | "active",
  activate?: { recoveryCodeHashes: string[] }
): Promise<void> {
  const attempt = await ctx.runMutation(internal.authDb.beginCodeAttempt, {
    principal,
  });
  if (attempt.kind === "locked") {
    throw new Error(
      `Too many incorrect codes. Try again ${untilText(attempt.until)}.`
    );
  }
  if (attempt.kind === "missing" || attempt.status !== expect) {
    throw new Error(
      expect === "pending"
        ? "Start the setup again — this one is no longer waiting for a code."
        : "Two-factor authentication is not on for this login."
    );
  }

  const digits = rawCode.replace(/\s/g, "");
  let accepted = false;
  if (/^\d{6}$/.test(digits)) {
    const step = matchingStep(attempt.secret, digits, attempt.lastUsedStep);
    if (step !== null) {
      accepted = await ctx.runMutation(internal.authDb.acceptCode, {
        principal,
        step,
        activate,
      });
    }
  } else if (expect === "active") {
    const recovery = normalizeRecoveryCode(rawCode);
    if (recovery.length === 10) {
      const recoveryHash = await sha256Hex(recovery);
      if (attempt.recoveryCodeHashes.includes(recoveryHash)) {
        accepted = await ctx.runMutation(internal.authDb.acceptCode, {
          principal,
          recoveryHash,
        });
      }
    }
  }

  if (!accepted) {
    throw new Error("That code is not right. Check your authenticator app and try again.");
  }
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

    return await issueSession(ctx, { role: "admin", adminId }, "web");
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
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
    workspaceIds: v.optional(v.array(v.id("workspaces"))),
  },
  handler: async (ctx, args): Promise<{ adminId: Id<"admins"> }> => {
    await ctx.runQuery(internal.authDb.assertAdmin, {});
    if (args.password.length < 12) {
      throw new Error("Choose a password of at least 12 characters.");
    }

    const adminId: Id<"admins"> = await ctx.runMutation(
      internal.authDb.insertAdmin,
      {
        email: args.email.trim().toLowerCase(),
        name: args.name?.trim() || undefined,
        passwordHash: await hashPassword(args.password),
        role: args.role,
        workspaceIds: args.workspaceIds,
        requireFirst: false,
      }
    );
    return { adminId };
  },
});

export const resetAdminPassword = action({
  args: { adminId: v.id("admins"), password: v.string() },
  handler: async (ctx, args): Promise<{ success: true }> => {
    await ctx.runQuery(internal.authDb.assertAdmin, {});
    if (args.password.length < 12) {
      throw new Error("Choose a password of at least 12 characters.");
    }
    await ctx.runMutation(internal.authDb.setAdminPassword, {
      adminId: args.adminId,
      passwordHash: await hashPassword(args.password),
    });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

type LoginPrincipal =
  | { role: "admin"; adminId: Id<"admins"> }
  | { role: "workspace"; workspaceId: Id<"workspaces"> }
  | {
      role: "member";
      memberId: Id<"teamMembers">;
      workspaceId: Id<"workspaces">;
    };

/**
 * Where a sign-in comes from. `web` and `app` hold one session per login
 * between them; `mcp` is exempt (see `authSessions.source`). Left undefined
 * by a client from before any of this — an app build still installed on
 * someone's phone — which is then told in words rather than handed a step it
 * does not know how to show.
 */
type Source = "web" | "app" | "mcp";

type Profile = {
  role: "admin" | "workspace" | "member";
  label: string;
  workspaceSlug: string | null;
  mustChangePassword: boolean;
};

type SignedIn = Profile & {
  status: "signedIn";
  sessionToken: string;
  expiresAt: number;
};

type ActiveSession = { device: string | null; lastUsedAt: number };

/**
 * What a sign-in step comes back with: signed in, or one more thing to ask.
 * The challenge token goes back to `continueLogin` to answer it.
 */
type LoginOutcome =
  | SignedIn
  | { status: "twoFactor"; challenge: string; expiresAt: number }
  | {
      status: "sessionActive";
      challenge: string;
      expiresAt: number;
      activeSession: ActiveSession;
    };

function principalFields(principal: LoginPrincipal) {
  return {
    role: principal.role,
    adminId: principal.role === "admin" ? principal.adminId : undefined,
    workspaceId:
      principal.role === "admin" ? undefined : principal.workspaceId,
    memberId: principal.role === "member" ? principal.memberId : undefined,
  };
}

/** The "role|id" an authenticator is stored under. See `principalKey`. */
function keyOf(principal: LoginPrincipal): string {
  if (principal.role === "admin") return `admin|${principal.adminId}`;
  if (principal.role === "member") return `member|${principal.memberId}`;
  return `workspace|${principal.workspaceId}`;
}

function cleanDevice(device: string | undefined): string | undefined {
  return device?.replace(/\s+/g, " ").trim().slice(0, 80) || undefined;
}

/**
 * Opens a session, or reports the one already open (see `createSession` for
 * the modes).
 */
async function openSession(
  ctx: ActionCtx,
  principal: LoginPrincipal,
  options: {
    source: Source | undefined;
    device?: string;
    mode: "exclusive" | "replace" | "shared";
    challengeId?: Id<"authChallenges">;
  }
): Promise<
  | { ok: true; sessionToken: string; expiresAt: number }
  | { ok: false; activeSession: ActiveSession }
> {
  const sessionToken = randomToken(32);
  const expiresAt = Date.now() + SESSION_TTL_MS;

  const result = await ctx.runMutation(internal.authDb.createSession, {
    tokenHash: await sha256Hex(sessionToken),
    ...principalFields(principal),
    expiresAt,
    source: options.source,
    device: options.device,
    mode: options.mode,
    challengeId: options.challengeId,
  });
  if (!result.ok) return result;
  return { ok: true, sessionToken, expiresAt };
}

/** A session that never displaces another: MCP, and first-run setup. */
async function issueSession(
  ctx: ActionCtx,
  principal: LoginPrincipal,
  source: Source
): Promise<{ sessionToken: string; expiresAt: number }> {
  const opened = await openSession(ctx, principal, { source, mode: "shared" });
  if (!opened.ok) throw new Error("Could not open a session.");
  return { sessionToken: opened.sessionToken, expiresAt: opened.expiresAt };
}

async function createChallenge(
  ctx: ActionCtx,
  principal: LoginPrincipal,
  stage: "twoFactor" | "replace",
  source: Source,
  device: string | undefined
): Promise<{ challenge: string; expiresAt: number }> {
  const challenge = randomToken(32);
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  await ctx.runMutation(internal.authDb.createChallenge, {
    tokenHash: await sha256Hex(challenge),
    stage,
    ...principalFields(principal),
    source,
    device,
    expiresAt,
  });
  return { challenge, expiresAt };
}

/**
 * The last step of every sign-in, once the password and any code are right:
 * open the session, unless the login already has one open elsewhere — then
 * ask first. MCP never asks, and never displaces anyone.
 */
async function finishSignIn(
  ctx: ActionCtx,
  principal: LoginPrincipal,
  profile: Profile,
  source: Source | undefined,
  device: string | undefined,
  challenge?: { id: Id<"authChallenges">; token: string; expiresAt: number }
): Promise<LoginOutcome> {
  const opened = await openSession(ctx, principal, {
    source,
    device,
    mode: source === "mcp" ? "shared" : "exclusive",
    challengeId: challenge?.id,
  });
  if (opened.ok) {
    return {
      status: "signedIn",
      sessionToken: opened.sessionToken,
      expiresAt: opened.expiresAt,
      ...profile,
    };
  }

  if (!source) {
    throw new Error(
      "This login is already signed in on another device. Sign out there first, or update the app to switch devices."
    );
  }

  // Asked on the same challenge when there is one — the code step is done,
  // and the person should not have to type it again.
  if (challenge) {
    await ctx.runMutation(internal.authDb.advanceChallenge, {
      challengeId: challenge.id,
    });
    return {
      status: "sessionActive",
      challenge: challenge.token,
      expiresAt: challenge.expiresAt,
      activeSession: opened.activeSession,
    };
  }
  const fresh = await createChallenge(ctx, principal, "replace", source, device);
  return {
    status: "sessionActive",
    ...fresh,
    activeSession: opened.activeSession,
  };
}

const sourceValidator = v.optional(
  v.union(v.literal("web"), v.literal("app"), v.literal("mcp"))
);

/**
 * One sign-in for every kind of principal.
 *
 * The username is matched against administrator emails first, then workspace
 * IDs, then human agents' usernames. An email always contains "@", a workspace
 * ID never contains "@" or ".", and a human agent's username is
 * `<workspace-id>.<name>` — so the three namespaces cannot collide. The caller
 * is told which area to open rather than being asked to choose a role up
 * front.
 *
 * A right password does not always sign in straight away. A login with an
 * authenticator comes back `twoFactor`, and one already open on another
 * device comes back `sessionActive` — either way with a challenge that
 * `continueLogin` finishes. The web and the app pass `client` and show those
 * steps; without it, they are refused in words instead.
 */
export const login = action({
  args: {
    username: v.string(),
    password: v.string(),
    client: sourceValidator,
    /** "Chrome on Windows", "Pixel 8" — shown to the next sign-in. */
    device: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LoginOutcome> => {
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

    const memberLogin: Doc<"memberCredentials"> | null =
      admin || workspace
        ? null
        : await ctx.runQuery(internal.authDb.memberCredentialByUsername, {
            username: identifier,
          });

    const stored =
      admin?.passwordHash ??
      (credential?.status === "active" ? credential.passwordHash : undefined) ??
      (memberLogin?.status === "active" ? memberLogin.passwordHash : undefined);

    // Always verify something, so a wrong username and a wrong password are
    // indistinguishable from the outside.
    const ok = await verifyPassword(args.password, stored ?? unmatchableHash());
    if (!ok || !stored) throw new Error(generic);

    // Only reachable with a matching, active credential of one of the three.
    const principal: LoginPrincipal | null = admin
      ? { role: "admin", adminId: admin._id }
      : memberLogin
        ? {
            role: "member",
            memberId: memberLogin.memberId,
            workspaceId: memberLogin.workspaceId,
          }
        : workspace && credential
          ? { role: "workspace", workspaceId: workspace._id }
          : null;
    if (!principal) throw new Error(generic);

    // Checked after the password, so a stranger learns nothing about which
    // people exist or which workspaces are archived.
    const profile = await profileOf(ctx, principal);
    const source = args.client;
    const device = cleanDevice(args.device);

    const protectedLogin = await ctx.runQuery(
      internal.authDb.twoFactorForPrincipal,
      { principal: keyOf(principal) }
    );
    if (protectedLogin) {
      if (!source) {
        throw new Error(
          "Two-factor authentication is on for this login. Update the app to sign in."
        );
      }
      if (source === "mcp") {
        throw new Error(
          "Two-factor authentication is on for this login, so the MCP server cannot sign in with its password. Use a connector URL from the dashboard instead."
        );
      }
      const challenge = await createChallenge(
        ctx,
        principal,
        "twoFactor",
        source,
        device
      );
      return { status: "twoFactor", ...challenge };
    }

    return await finishSignIn(ctx, principal, profile, source, device);
  },
});

/**
 * Who a principal is, for the signed-in response — re-checked, since a
 * sign-in can sit at the code for minutes and a person can be switched off
 * in the meantime.
 */
async function profileOf(
  ctx: ActionCtx,
  principal: LoginPrincipal
): Promise<Profile> {
  const found = await ctx.runQuery(
    internal.authDb.principalProfile,
    principalFields(principal)
  );
  if (!found.ok) throw new Error(found.error);
  return {
    role: principal.role,
    label: found.label,
    workspaceSlug: found.workspaceSlug,
    mustChangePassword: found.mustChangePassword,
  };
}

/**
 * The rest of a sign-in `login` could not finish in one go: the code from the
 * authenticator app (or a recovery code), then — if the login is open on
 * another device — the person's go-ahead to sign that one out, as `replace`.
 */
export const continueLogin = action({
  args: {
    challenge: v.string(),
    code: v.optional(v.string()),
    replace: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<LoginOutcome> => {
    const token = args.challenge.trim();
    const found: Doc<"authChallenges"> | null = await ctx.runQuery(
      internal.authDb.challengeByHash,
      { tokenHash: await sha256Hex(token) }
    );
    if (!found || found.expiresAt < Date.now()) {
      throw new Error("This sign-in has expired. Sign in again.");
    }

    const principal: LoginPrincipal | null =
      found.role === "admin" && found.adminId
        ? { role: "admin", adminId: found.adminId }
        : found.role === "member" && found.memberId && found.workspaceId
          ? {
              role: "member",
              memberId: found.memberId,
              workspaceId: found.workspaceId,
            }
          : found.role === "workspace" && found.workspaceId
            ? { role: "workspace", workspaceId: found.workspaceId }
            : null;
    if (!principal) throw new Error("This sign-in has expired. Sign in again.");

    const profile = await profileOf(ctx, principal);
    const challenge = { id: found._id, token, expiresAt: found.expiresAt };

    if (found.stage === "twoFactor") {
      if (!args.code?.trim()) {
        throw new Error("Enter the code from your authenticator app.");
      }
      await checkCode(ctx, keyOf(principal), args.code, "active");
      return await finishSignIn(
        ctx,
        principal,
        profile,
        found.source,
        found.device,
        challenge
      );
    }

    if (!args.replace) {
      throw new Error("Sign out the other session to continue.");
    }
    const opened = await openSession(ctx, principal, {
      source: found.source,
      device: found.device,
      mode: "replace",
      challengeId: found._id,
    });
    if (!opened.ok) throw new Error("Could not open a session.");
    return {
      status: "signedIn",
      sessionToken: opened.sessionToken,
      expiresAt: opened.expiresAt,
      ...profile,
    };
  },
});

/**
 * Why a session stopped working, for the device it was on. Only "replaced"
 * has a reason worth telling: another sign-in took its place.
 */
export const endedReason = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, args): Promise<"replaced" | null> => {
    const session: Doc<"authSessions"> | null = await ctx.runQuery(
      internal.authDb.sessionByHash,
      { tokenHash: await sha256Hex(args.sessionToken) }
    );
    return session?.endedReason ?? null;
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
    role: "admin" | "workspace" | "member";
    workspaceSlug: string | null;
  } | null> => {
    const session: Doc<"authSessions"> | null = await ctx.runQuery(
      internal.authDb.sessionByHash,
      { tokenHash: await sha256Hex(args.sessionToken) }
    );
    if (
      !session ||
      session.expiresAt < Date.now() ||
      // Replaced by a sign-in on another device.
      session.endedAt !== undefined
    ) {
      return null;
    }

    let subject: string;
    let workspaceSlug: string | null = null;

    if (session.role === "admin") {
      if (!session.adminId) return null;
      subject = `admin|${session.adminId}`;
    } else if (session.role === "member") {
      if (!session.memberId) return null;
      const login: Doc<"memberCredentials"> | null = await ctx.runQuery(
        internal.authDb.memberCredentialForMember,
        { memberId: session.memberId }
      );
      if (login?.status !== "active") return null;
      const state = await ctx.runQuery(internal.authDb.memberSignInState, {
        memberId: session.memberId,
      });
      if (!state || state.member.status === "inactive" || !state.companyActive) {
        return null;
      }
      workspaceSlug = state.workspace.slug;
      subject = `member|${session.memberId}`;
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

    // Web and app tokens name their session, so ending it — a sign-in
    // elsewhere — locks them out on the next request instead of the next
    // renewal. Those two clients watch for it and sign out cleanly; see
    // `parseSubject` in convex/lib/auth.ts for why the others do not.
    if (session.source === "web" || session.source === "app") {
      subject = `${subject}|${session._id}`;
    }

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

// ---------------------------------------------------------------------------
// MCP connector tokens
//
// A company connects an assistant by pasting a URL into claude.ai, which has
// nowhere to put a header — so the token sits in the URL path and is the whole
// credential. That shapes everything here: it is issued once and only hashed
// afterwards, rotating invalidates the old URL on the spot, and signing in with
// it produces an ordinary workspace session, so every `requireWorkspace` guard
// in convex/ applies to it unchanged. It is not a new permission level; it is
// another way to hold the same one.
// ---------------------------------------------------------------------------

const MCP_TOKEN_BYTES = 32;
/** Enough to recognise which token is live, too little to guess the rest. */
const MCP_PREFIX_CHARS = 6;

export const issueMcpToken = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{ token: string; prefix: string; slug: string }> => {
    // A company may issue its own connector, and an admin may issue one for
    // any workspace. Not a human agent: the token would outlive their login.
    await ctx.runQuery(internal.authDb.assertOwner, {
      workspaceId: args.workspaceId,
    });

    const workspace: Doc<"workspaces"> | null = await ctx.runQuery(
      internal.workspaces.getInternal,
      { workspaceId: args.workspaceId }
    );
    if (!workspace) throw new Error("Workspace not found");

    const token = randomToken(MCP_TOKEN_BYTES);
    const prefix = token.slice(0, MCP_PREFIX_CHARS);

    await ctx.runMutation(internal.authDb.setMcpToken, {
      workspaceId: args.workspaceId,
      tokenHash: await sha256Hex(token),
      prefix,
    });

    // Returned once. Only the hash is kept, so a lost URL is reissued rather
    // than recovered.
    return { token, prefix, slug: workspace.slug };
  },
});

export const revokeMcpToken = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    await ctx.runQuery(internal.authDb.assertOwner, {
      workspaceId: args.workspaceId,
    });
    return await ctx.runMutation(internal.authDb.clearMcpToken, {
      workspaceId: args.workspaceId,
    });
  },
});

/**
 * The administrator's own connectors.
 *
 * Unlike a workspace's, these reach every tenant and unlock the platform tools
 * — so they are issued to the administrator asking, not to a workspace. An
 * admin can hold several, one per assistant they plug in, each with its own
 * name and its own URL: rotating or revoking one leaves the others working.
 */
export const issueAdminMcpToken = action({
  args: { name: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ token: string; prefix: string; tokenId: Id<"adminMcpTokens"> }> => {
    const { adminId } = await ctx.runQuery(internal.authDb.assertAdmin, {});

    const token = randomToken(MCP_TOKEN_BYTES);
    const prefix = token.slice(0, MCP_PREFIX_CHARS);

    const tokenId: Id<"adminMcpTokens"> = await ctx.runMutation(
      internal.authDb.addAdminMcpToken,
      {
        adminId,
        name: args.name,
        tokenHash: await sha256Hex(token),
        prefix,
      }
    );

    // Returned once, like the workspace one. Only the hash is kept.
    return { token, prefix, tokenId };
  },
});

/** A new URL for one of this administrator's connectors. */
export const rotateAdminMcpToken = action({
  args: { tokenId: v.id("adminMcpTokens") },
  handler: async (ctx, args): Promise<{ token: string; prefix: string }> => {
    const { adminId } = await ctx.runQuery(internal.authDb.assertAdmin, {});

    const token = randomToken(MCP_TOKEN_BYTES);
    const prefix = token.slice(0, MCP_PREFIX_CHARS);

    await ctx.runMutation(internal.authDb.rotateAdminMcpToken, {
      adminId,
      tokenId: args.tokenId,
      tokenHash: await sha256Hex(token),
      prefix,
    });
    return { token, prefix };
  },
});

export const revokeAdminMcpToken = action({
  args: { tokenId: v.id("adminMcpTokens") },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    const { adminId } = await ctx.runQuery(internal.authDb.assertAdmin, {});
    return await ctx.runMutation(internal.authDb.removeAdminMcpToken, {
      adminId,
      tokenId: args.tokenId,
    });
  },
});

/**
 * Signs in a connector token, for the MCP endpoint.
 *
 * Deliberately says nothing useful on failure: this is reached by whatever URL
 * a stranger cares to try, and the route answers 404 either way, so a specific
 * error here would only tell a prober which part they got right.
 */
export const mcpLogin = action({
  args: { token: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    sessionToken: string;
    expiresAt: number;
    role: "admin" | "workspace";
    label: string;
    // Null for an administrator, who is not in a workspace: the MCP server
    // reads this to decide whether a tool may assume one.
    workspaceSlug: string | null;
  }> => {
    const generic = "Invalid connector token.";
    const token = args.token.trim();
    if (token.length < 24) throw new Error(generic);

    const tokenHash = await sha256Hex(token);

    // An administrator's connector first: the two live in different tables, and
    // this one is the rarer of the two, so a miss costs one indexed read.
    const asAdmin: {
      tokenId: Id<"adminMcpTokens">;
      adminId: Id<"admins">;
      label: string;
      connectorName: string;
    } | null = await ctx.runQuery(internal.authDb.adminByMcpTokenHash, {
      tokenHash,
    });
    if (asAdmin) {
      await ctx.runMutation(internal.authDb.touchAdminMcpToken, {
        tokenId: asAdmin.tokenId,
      });
      const session = await issueSession(
        ctx,
        { role: "admin", adminId: asAdmin.adminId },
        "mcp"
      );
      return {
        ...session,
        role: "admin",
        // Which connector, too: an admin with several can then tell from
        // whoami which of their URLs an assistant is holding.
        label: `${asAdmin.label} · ${asAdmin.connectorName}`,
        workspaceSlug: null,
      };
    }

    const found: {
      tokenId: Id<"mcpTokens">;
      workspace: Doc<"workspaces">;
    } | null = await ctx.runQuery(internal.authDb.workspaceByMcpTokenHash, {
      tokenHash,
    });
    if (!found) throw new Error(generic);

    const { workspace } = found;
    if (workspace.status === "archived") {
      throw new Error("This workspace has been archived.");
    }

    // A company whose dashboard access was revoked must not keep a working
    // connector. The session guards would refuse every call anyway — this
    // fails at the door instead of on the first tool.
    const credential: Doc<"workspaceCredentials"> | null = await ctx.runQuery(
      internal.authDb.credentialForWorkspace,
      { workspaceId: workspace._id }
    );
    if (!credential || credential.status !== "active") {
      throw new Error(generic);
    }

    await ctx.runMutation(internal.authDb.touchMcpToken, {
      tokenId: found.tokenId,
    });

    const session = await issueSession(
      ctx,
      { role: "workspace", workspaceId: workspace._id },
      "mcp"
    );
    return {
      ...session,
      role: "workspace",
      label: workspace.name,
      workspaceSlug: workspace.slug,
    };
  },
});

export const generateWorkspacePassword = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{ password: string; slug: string }> => {
    await ctx.runQuery(internal.authDb.assertAdmin, {});

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
    await ctx.runQuery(internal.authDb.assertAdmin, {});
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

/**
 * Give a human agent a login of their own, or reset theirs.
 *
 * The company does this from its Team page — they are its people. The
 * password is shown once and only its hash is kept; a reset signs out
 * whatever the old one had open.
 */
export const issueMemberLogin = action({
  args: { memberId: v.id("teamMembers") },
  handler: async (
    ctx,
    args
  ): Promise<{ username: string; password: string }> => {
    // The guard, and the check that there is somebody to issue it to.
    const found = await ctx.runQuery(internal.authDb.memberForLogin, {
      memberId: args.memberId,
    });
    if (found.member.status === "inactive") {
      throw new Error(
        `${found.member.name} is inactive. Set them to active or away first.`
      );
    }

    const password = generatePassword();
    const { username } = await ctx.runMutation(
      internal.authDb.upsertMemberCredential,
      {
        memberId: args.memberId,
        passwordHash: await hashPassword(password),
      }
    );

    // Returned once. Only the hash is kept.
    return { username, password };
  },
});

// ---------------------------------------------------------------------------
// Two-factor authentication, set up by each login for itself.
//
// Turned off again with a code, or by whoever can reset the password: the
// admin for a company, the company for its human agents, and the
// provision-admin script for an administrator. That reset is the way back in
// for somebody who has lost their phone and their recovery codes.
// ---------------------------------------------------------------------------

/**
 * A new secret for the caller's authenticator app, as a key and as the
 * otpauth:// URI a QR code carries. Nothing is protected by it until
 * `confirmTwoFactorSetup` sees a code from it.
 */
export const beginTwoFactorSetup = action({
  args: {},
  handler: async (ctx): Promise<{ secret: string; uri: string }> => {
    const caller: { key: string; account: string } = await ctx.runQuery(
      internal.authDb.callerPrincipal,
      {}
    );
    // 160 bits, the size RFC 4226 recommends for HMAC-SHA1.
    const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    await ctx.runMutation(internal.authDb.putPendingFactor, {
      principal: caller.key,
      secret,
    });
    return { secret, uri: otpauthUri(secret, caller.account) };
  },
});

/**
 * The first code from the new authenticator, which turns it on. Returns the
 * recovery codes — once, like a password: only their hashes are kept.
 */
export const confirmTwoFactorSetup = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ recoveryCodes: string[] }> => {
    const caller: { key: string; account: string } = await ctx.runQuery(
      internal.authDb.callerPrincipal,
      {}
    );
    const recoveryCodes = Array.from(
      { length: RECOVERY_CODE_COUNT },
      generateRecoveryCode
    );
    const recoveryCodeHashes = await Promise.all(
      recoveryCodes.map((code) => sha256Hex(normalizeRecoveryCode(code)))
    );
    await checkCode(ctx, caller.key, args.code, "pending", {
      recoveryCodeHashes,
    });
    return { recoveryCodes };
  },
});

/** Turns it off, with a current code or a recovery code as proof. */
export const disableTwoFactor = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const caller: { key: string; account: string } = await ctx.runQuery(
      internal.authDb.callerPrincipal,
      {}
    );
    await checkCode(ctx, caller.key, args.code, "active");
    await ctx.runMutation(internal.authDb.removeFactor, {
      principal: caller.key,
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
