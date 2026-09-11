/**
 * Workspace resolution.
 *
 * Every tool takes an optional `workspace` slug. A company account has exactly
 * one workspace and never needs it; an admin can reach them all, so it either
 * names one, sets MAGIC_AI_BOT_WORKSPACE, or is told which are available.
 */

import { DEFAULT_WORKSPACE } from "./config.mjs";
import { api, authorize, call, currentSession, state } from "./convex.mjs";

export async function reachableWorkspaces() {
  await authorize();
  const session = currentSession();
  if (session.role === "admin") return await call.query(api.workspaces.list, {});
  const own = await call.query(api.workspaces.getBySlug, {
    slug: session.workspaceSlug,
  });
  return own ? [own] : [];
}

export async function resolveWorkspace(slug) {
  await authorize();
  const st = state();
  const wanted =
    slug?.trim() || DEFAULT_WORKSPACE || currentSession().workspaceSlug;

  if (wanted) {
    // The cache lives on the request's state, not the module: a document
    // resolved for one company must not be handed to the next request, which
    // would be returning a workspace nobody checked this caller may read.
    const cached = st.workspaces.get(wanted);
    if (cached) return cached;
    const found = await call.query(api.workspaces.getBySlug, { slug: wanted });
    if (!found) {
      throw new Error(
        `No workspace with the slug "${wanted}". Call list_workspaces to see what is available.`
      );
    }
    st.workspaces.set(found.slug, found);
    return found;
  }

  // An admin with no default: pick for them only when the choice is obvious.
  const all = await reachableWorkspaces();
  if (all.length === 1) {
    state().workspaces.set(all[0].slug, all[0]);
    return all[0];
  }
  throw new Error(
    `Which workspace? Pass "workspace" with one of: ${all
      .map((w) => w.slug)
      .join(", ")} — or set MAGIC_AI_BOT_WORKSPACE.`
  );
}

/**
 * Like resolveWorkspace, but the slug is mandatory.
 *
 * The admin tools archive, delete and re-credential whole tenants. Letting
 * those inherit MAGIC_AI_BOT_WORKSPACE, or "the only workspace", would turn a
 * forgotten argument into the wrong company.
 */
export async function requireNamedWorkspace(slug) {
  if (!slug?.trim()) {
    const all = await reachableWorkspaces();
    throw new Error(
      `This tool needs an explicit workspace slug — it will not guess. One of: ${all
        .map((w) => w.slug)
        .join(", ")}`
    );
  }
  return await resolveWorkspace(slug);
}
