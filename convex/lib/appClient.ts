// One request to a Magic app's API.
//
// Plain fetch, so it runs in both runtimes: the connect flow calls it from the
// default runtime, the engine's send_form and send_offer from Node. Never
// throws — every caller wants the app's own error message to hand on, to the
// operator on the Integrations page or to the model mid-turn.

const REQUEST_TIMEOUT_MS = 10_000;

export type AppResponse = {
  ok: boolean;
  /** 0 when the app could not be reached at all. */
  status: number;
  body: unknown;
  error?: string;
};

export async function callApp(
  connection: { baseUrl: string; apiKey: string },
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<AppResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${connection.baseUrl.replace(/\/+$/, "")}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      }
    );

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (response.ok) return { ok: true, status: response.status, body: parsed };

    // Both apps answer `{ error }`; Magic Reward's older routes add `message`.
    const shape =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const said = [shape.message, shape.error].find(
      (value): value is string => typeof value === "string" && value.trim() !== ""
    );
    return {
      ok: false,
      status: response.status,
      body: parsed,
      error:
        response.status === 401
          ? "The app refused the API key. It may have been revoked — connect again with a new one."
          : (said ?? `The app answered HTTP ${response.status}.`),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: controller.signal.aborted
        ? "The app did not answer in time."
        : `Could not reach the app: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
