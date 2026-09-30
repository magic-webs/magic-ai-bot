// Talking to the WhatsApp panel a channel is connected through.
//
// The panel speaks Meta's Cloud API shapes behind its own base URL — the
// channel's `apiBaseUrl`, e.g. https://<panel>/api/meta — so a template list
// is GET {base}/{version}/{waba}/message_templates and a new template is a
// POST to the same path, exactly as against graph.facebook.com. Shared by the
// alert template sync (convex/notificationsSend.ts) and the marketing desk's
// template submission (convex/marketingTemplates.ts).
//
// fetch only, so it runs in the default runtime.

export const TIMEOUT_MS = 15_000;
/** Templates read per page, at the most the panel hands back per page. */
export const TEMPLATE_PAGE = 100;
export const MAX_TEMPLATE_PAGES = 20;

export type Json = Record<string, unknown>;

export type PanelConfig = {
  apiBaseUrl: string;
  apiVersion: string;
  accessToken: string;
};

export function errorText(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "The provider did not respond in time.";
  }
  return error instanceof Error ? error.message : String(error);
}

export async function request(
  url: string,
  init: RequestInit
): Promise<{ status: number; ok: boolean; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, body, text };
  } finally {
    clearTimeout(timer);
  }
}

/** The most specific message a provider's error body offers. */
export function providerError(status: number, body: unknown, text: string): string {
  const root = (body ?? {}) as Json;
  const error = (root.error ?? root.data ?? root) as Json;
  const details = Array.isArray(error.details) ? (error.details[0] as Json) : null;
  const message =
    (details?.message as string | undefined) ??
    ((error.error_data as Json | undefined)?.details as string | undefined) ??
    (error.error_user_msg as string | undefined) ??
    (error.message as string | undefined) ??
    (root.message as string | undefined);
  return `HTTP ${status}: ${(typeof message === "string" && message) || text.slice(0, 300) || "no response body"}`;
}

export function channelHeaders(channel: { accessToken: string }): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channel.accessToken}`,
    // The panel's WABA management endpoints read the same token from API-KEY.
    "API-KEY": channel.accessToken,
  };
}

/** `{base}/{version}`, with no trailing slash on the base. */
export function panelRoot(config: PanelConfig): string {
  return `${config.apiBaseUrl.replace(/\/$/, "")}/${config.apiVersion}`;
}

/** A template list's rows, whichever envelope the panel wraps them in. */
function rowsOf(body: unknown): Json[] {
  if (Array.isArray(body)) return body as Json[];
  const root = (body ?? {}) as Json;
  for (const key of ["data", "templates", "message_templates", "results"]) {
    const value = root[key];
    if (Array.isArray(value)) return value as Json[];
    if (value && typeof value === "object") {
      const nested = rowsOf(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

export type PanelTemplate = {
  providerId?: string;
  name: string;
  language: string;
  category: string;
  status: string;
  /** Why Meta turned it down, when it did and the panel says. */
  rejectedReason?: string;
  components: string;
};

function templateRow(row: Json): PanelTemplate | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  const language =
    typeof row.language === "string"
      ? row.language
      : typeof (row.language as Json | undefined)?.code === "string"
        ? String((row.language as Json).code)
        : "en";
  const reason =
    typeof row.rejected_reason === "string" && row.rejected_reason !== "NONE"
      ? row.rejected_reason
      : undefined;
  return {
    providerId: row.id !== undefined ? String(row.id) : undefined,
    name,
    language,
    category: String(row.category ?? "UTILITY").toUpperCase(),
    status: String(row.status ?? "UNKNOWN").toUpperCase(),
    rejectedReason: reason,
    components: JSON.stringify(row.components ?? []),
  };
}

/**
 * The business account id, when the channel was saved without one.
 *
 * The panel's "Fetch Channel Information" answers for the token alone, and
 * somewhere in it is the WABA — under a name that differs by panel, so the
 * likely ones are all tried.
 */
export async function discoverWaba(config: PanelConfig): Promise<string | null> {
  try {
    const response = await request(`${panelRoot(config)}/info`, {
      method: "GET",
      headers: channelHeaders(config),
    });
    if (!response.ok) return null;
    const search = (node: unknown, depth: number): string | null => {
      if (!node || typeof node !== "object" || depth > 4) return null;
      for (const [key, value] of Object.entries(node as Json)) {
        if (
          /^(waba_?id|whatsapp_business_account_id|business_account_id)$/i.test(key) &&
          (typeof value === "string" || typeof value === "number")
        ) {
          return String(value);
        }
      }
      for (const value of Object.values(node as Json)) {
        const hit = search(value, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    return search(response.body, 0);
  } catch {
    return null;
  }
}

/** Every template the panel holds for a business account. */
export async function listTemplates(
  config: PanelConfig,
  wabaId: string
): Promise<{ ok: true; templates: PanelTemplate[] } | { ok: false; error: string }> {
  const base = `${panelRoot(config)}/${wabaId}/message_templates`;
  const rows = new Map<string, PanelTemplate>();
  let offset = 0;
  let after: string | undefined;

  for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
    const url = new URL(base);
    url.searchParams.set("limit", String(TEMPLATE_PAGE));
    // The panel pages by offset; Meta itself by cursor. Both are sent, and
    // whichever the far end understands is the one it reads.
    url.searchParams.set("offset", String(offset));
    if (after) url.searchParams.set("after", after);

    let response;
    try {
      response = await request(url.toString(), {
        method: "GET",
        headers: channelHeaders(config),
      });
    } catch (error) {
      return { ok: false, error: `Could not reach the WhatsApp panel: ${errorText(error)}` };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `The panel refused the template list — ${providerError(response.status, response.body, response.text)}`,
      };
    }

    const found = rowsOf(response.body);
    let added = 0;
    for (const raw of found) {
      const row = templateRow(raw);
      if (!row) continue;
      const key = `${row.name}|${row.language}`;
      if (!rows.has(key)) added++;
      rows.set(key, row);
    }

    const paging = ((response.body ?? {}) as Json).paging as Json | undefined;
    const cursor = (paging?.cursors as Json | undefined)?.after;
    after = paging?.next && typeof cursor === "string" ? cursor : undefined;
    offset += found.length;
    // Stop on a short page, or a page that added nothing new — a panel
    // ignoring both offset and cursor would otherwise return page one
    // twenty times.
    if (found.length < TEMPLATE_PAGE || added === 0) {
      if (!after || added === 0) break;
    }
  }

  return { ok: true, templates: [...rows.values()] };
}
