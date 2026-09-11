/**
 * Authenticated Convex access.
 *
 * It signs in exactly the way the dashboard does: `auth.login` for a session
 * token, `auth.mintAccessToken` for a short-lived JWT, then that JWT on every
 * call. So it has precisely the permissions of the account it signs in as, and
 * every `requireWorkspace` / `requireAdmin` guard applies unchanged. There is
 * no admin key here and no back door.
 *
 * The JWT lasts 30 minutes; it is re-minted a minute early so a long session
 * never fails mid-call. The durable session token is exchanged for a fresh JWT
 * rather than being sent as a credential itself.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { CONVEX_URL, PASSWORD, USERNAME, assertConfigured } from "./config.mjs";

// convex/_generated/api.js exports exactly this. Building it here instead of
// importing that file keeps this server independent of codegen output and
// avoids Node reparsing a type-less .js as ESM on every start.
export const api = anyApi;

const REFRESH_MARGIN_MS = 60_000;

/**
 * Who this server is acting as, and everything derived from that — the Convex
 * client, the session, the access token, the resolved-workspace cache.
 *
 * Per request, not per module, because the HTTP route now serves more than one
 * identity. A warm serverless instance reuses the module, so module scope is
 * shared between invocations: with a single env-configured account that is
 * only a useful cache, but once each company has its own connector token it
 * would mean the second request reusing the first company's session and its
 * cached workspace documents. The stdio server is one process for one identity
 * and keeps using `processState`.
 */
const requestState = new AsyncLocalStorage();

function newState(identity) {
  return {
    identity,
    client: null,
    session: null, // { sessionToken, role, label, workspaceSlug }
    access: null, // { token, expiresAt }
    workspaces: new Map(), // slug -> workspace document
  };
}

const processState = newState(
  USERNAME && PASSWORD
    ? { kind: "password", username: USERNAME, password: PASSWORD }
    : null
);

export function state() {
  return requestState.getStore() ?? processState;
}

/**
 * Exchanges a connector token for a workspace session, or null if it is not a
 * token anybody issued.
 *
 * Exists so an HTTP caller can be turned away *before* being handed an MCP
 * server. Checking lazily on the first tool call meant a stranger with any
 * long-enough URL still got a successful handshake and the whole tool list
 * back, which is exactly what the 404 is supposed to withhold.
 */
export async function verifyConnectorToken(token) {
  const client = new ConvexHttpClient(CONVEX_URL);
  try {
    return await client.action(api.auth.mcpLogin, { token });
  } catch {
    return null;
  }
}

/** Runs `fn` with its own identity, and its own everything derived from it. */
export function runWithIdentity(identity, fn) {
  return requestState.run(newState(identity), fn);
}

function convex() {
  const st = state();
  if (!st.client) {
    assertConfigured(st.identity);
    st.client = new ConvexHttpClient(CONVEX_URL);
  }
  return st.client;
}

async function signIn() {
  const st = state();
  const identity =
    st.identity ??
    (USERNAME && PASSWORD
      ? { kind: "password", username: USERNAME, password: PASSWORD }
      : null);
  if (!identity) assertConfigured(null);

  st.session =
    // Already signed in by whoever verified the token at the door. Reused
    // rather than exchanged again: two logins per request would issue two
    // sessions and double the round trips.
    identity.kind === "session"
      ? identity.session
      : identity.kind === "token"
        ? await convex().action(api.auth.mcpLogin, { token: identity.token })
        : await convex().action(api.auth.login, {
            username: identity.username,
            password: identity.password,
          });
  st.access = null;
}

export async function authorize() {
  const st = state();
  assertConfigured(st.identity);
  if (!st.session) await signIn();
  if (st.access && st.access.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    convex().setAuth(st.access.token);
    return;
  }

  // Drop the dead token before asking for a new one. Convex validates the
  // Authorization header on every request before the function runs, so an
  // expired JWT fails the very call that would replace it — the refresh path
  // blocked itself, and a server left running past the 30-minute token life
  // could never recover. mintAccessToken needs no identity anyway: the session
  // token in the argument is the credential.
  convex().clearAuth();

  let minted = await convex().action(api.auth.mintAccessToken, {
    sessionToken: st.session.sessionToken,
  });
  if (!minted) {
    // The session was revoked or expired — sign in again before giving up.
    await signIn();
    minted = await convex().action(api.auth.mintAccessToken, {
      sessionToken: st.session.sessionToken,
    });
  }
  if (!minted) throw new Error("Could not authenticate with Magic Agent.");

  st.access = { token: minted.token, expiresAt: minted.expiresAt };
  convex().setAuth(st.access.token);
}

/** The signed-in principal for this request, once `authorize()` has run. */
export function currentSession() {
  const { session } = state();
  if (!session) throw new Error("Not signed in.");
  return session;
}

/** Who this server is signed in as, for a startup log line. */
export function describeSession() {
  const { session } = state();
  return session ? `${session.label} (${session.role})` : "not signed in";
}

export const call = {
  query: async (ref, args) => {
    await authorize();
    return convex().query(ref, args);
  },
  mutation: async (ref, args) => {
    await authorize();
    return convex().mutation(ref, args);
  },
  action: async (ref, args) => {
    await authorize();
    return convex().action(ref, args);
  },
};
