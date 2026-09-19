// Posting a signed event to somebody else's endpoint.
//
// Pulled out of `webhooks.ts` when record books gained their own destinations:
// there are now two callers, and an endpoint written against the workspace
// webhook has to verify a record webhook the same way or the signature is
// worse than useless. One implementation, so the headers and the signature
// cannot drift apart.

export type Delivery = {
  ok: boolean;
  responseStatus?: number;
  error?: string;
};

// HMAC-SHA256 via Web Crypto, so this stays in Convex's default runtime.
export async function signPayload(
  secret: string,
  body: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function postWebhook(opts: {
  url: string;
  body: string;
  event: string;
  workspaceSlug: string;
  secret?: string;
  /** Extra headers the destination needs, such as a bearer token. */
  headers?: Array<{ key: string; value: string }>;
  timeoutMs?: number;
}): Promise<Delivery> {
  const signature = opts.secret
    ? await signPayload(opts.secret, opts.body)
    : undefined;

  const extra: Record<string, string> = {};
  for (const header of opts.headers ?? []) {
    const key = header.key.trim();
    if (key) extra[key] = header.value;
  }

  // An endpoint that accepts the connection and then never answers would
  // otherwise hold an action open until Convex kills it, and take the rest of
  // the fan-out with it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);

  try {
    const response = await fetch(opts.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Magic-Event": opts.event,
        "X-Magic-Workspace": opts.workspaceSlug,
        ...extra,
        // Ours last: a custom header must not be able to forge the signature.
        ...(signature ? { "X-Magic-Signature": `sha256=${signature}` } : {}),
      },
      body: opts.body,
      signal: controller.signal,
    });

    if (response.ok) return { ok: true, responseStatus: response.status };

    const text = await response.text().catch(() => "");
    return {
      ok: false,
      responseStatus: response.status,
      error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error:
        err instanceof Error && err.name === "AbortError"
          ? "The endpoint did not respond in time."
          : message,
    };
  } finally {
    clearTimeout(timer);
  }
}
