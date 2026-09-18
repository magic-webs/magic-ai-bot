// Everything that talks to Google.
//
// Kept apart from the HTTP routes so the routes read as "authorise, call,
// answer" and the awkward parts — refreshing a token, and working out what
// 09:00 means in the company's timezone — are in one place with their reasons
// attached.
//
// These run inside Convex HTTP actions, so `fetch` and Web Crypto are
// available and `process.env` holds the OAuth client. Nothing here reads the
// database; the callers pass what they have.

import {
  GOOGLE_TOKEN_ENDPOINT,
  SLOT_MINUTES,
} from "./integrations";

export class GoogleError extends Error {
  /** True when the grant itself is gone, which needs a human to reconnect. */
  readonly needsReauth: boolean;

  constructor(message: string, needsReauth = false) {
    super(message);
    this.name = "GoogleError";
    this.needsReauth = needsReauth;
  }
}

export function googleClient(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new GoogleError(
      "Google is not configured on this deployment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
    );
  }
  return { id, secret };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type TokenGrant = {
  accessToken: string;
  /** Absolute, not the `expires_in` Google sends — that is unusable once stored. */
  expiresAt: number;
  refreshToken?: string;
  scopes: string[];
  email?: string;
};

/**
 * The email out of an id_token, without verifying it.
 *
 * Verification would mean fetching and checking Google's JWKS. This token came
 * back from a TLS POST to Google's own token endpoint in the same call, so
 * there is no untrusted hop to defend against — and the claim is only ever
 * used to label the card.
 */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { email?: string };
    return claims.email;
  } catch {
    return undefined;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenGrant> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  let parsed: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new GoogleError(`Google returned ${response.status}: ${text.slice(0, 200)}`);
  }

  if (!response.ok || !parsed.access_token) {
    const reason = parsed.error_description ?? parsed.error ?? text.slice(0, 200);
    // `invalid_grant` is the revoked-or-expired refresh token. Nothing we can
    // retry: somebody has to sign in again.
    throw new GoogleError(
      `Google refused the request: ${reason}`,
      parsed.error === "invalid_grant"
    );
  }

  return {
    accessToken: parsed.access_token,
    // 60s early, so a token cannot expire between this check and the call.
    expiresAt: Date.now() + ((parsed.expires_in ?? 3600) - 60) * 1000,
    refreshToken: parsed.refresh_token,
    scopes: (parsed.scope ?? "").split(" ").filter(Boolean),
    email: emailFromIdToken(parsed.id_token),
  };
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<TokenGrant> {
  const client = googleClient();
  return await tokenRequest({
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenGrant> {
  const client = googleClient();
  return await tokenRequest({
    refresh_token: refreshToken,
    client_id: client.id,
    client_secret: client.secret,
    grant_type: "refresh_token",
  });
}

// ---------------------------------------------------------------------------
// Calling the APIs
// ---------------------------------------------------------------------------

const API_TIMEOUT_MS = 12000;

async function call<T>(
  accessToken: string,
  url: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        /* keep the raw body */
      }
      // 401 means the access token was rejected; 403 is usually a scope the
      // grant never had. Both need the operator back on the consent screen.
      throw new GoogleError(
        message,
        response.status === 401 || response.status === 403
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof GoogleError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GoogleError("Google did not answer in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Sheets ----------------------------------------------------------------

export async function createSpreadsheet(
  accessToken: string,
  title: string,
  headers: string[]
): Promise<{ id: string; name: string; url: string }> {
  const created = await call<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
  }>(accessToken, "https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: {
      properties: { title },
      sheets: [{ properties: { title: "Enquiries" } }],
    },
  });

  await call(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/Enquiries!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: { values: [headers] } }
  );

  return {
    id: created.spreadsheetId,
    name: created.properties?.title ?? title,
    url: created.spreadsheetUrl,
  };
}

export async function appendRow(
  accessToken: string,
  spreadsheetId: string,
  row: Array<string | number>
): Promise<{ row: number }> {
  const result = await call<{ updates?: { updatedRange?: string } }>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Enquiries!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: { values: [row] } }
  );

  // "Enquiries!A7:F7" → 7. Only for the reply, so a miss is not an error.
  const match = result.updates?.updatedRange?.match(/![A-Z]+(\d+)/);
  return { row: match ? Number(match[1]) : 0 };
}

// --- Drive -----------------------------------------------------------------

export async function createFolder(
  accessToken: string,
  name: string
): Promise<{ id: string; name: string; url: string }> {
  const created = await call<{
    id: string;
    name: string;
    webViewLink?: string;
  }>(
    accessToken,
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      body: { name, mimeType: "application/vnd.google-apps.folder" },
    }
  );

  return {
    id: created.id,
    name: created.name,
    url: created.webViewLink ?? `https://drive.google.com/drive/folders/${created.id}`,
  };
}

export type DriveHit = { name: string; url: string; updated: string };

export async function searchFolder(
  accessToken: string,
  folderId: string,
  term: string,
  limit = 5
): Promise<DriveHit[]> {
  // Single quotes would close the string in Drive's query language and
  // backslashes would escape their way out of it. Stripped rather than
  // escaped: a filename search does not need either.
  const safe = term.replace(/['\\]/g, "").trim();
  if (!safe) return [];

  const query = [
    `'${folderId}' in parents`,
    "trashed = false",
    `name contains '${safe}'`,
  ].join(" and ");

  const result = await call<{ files?: DriveHit[] }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
      `&fields=files(name,webViewLink,modifiedTime)&pageSize=${limit}` +
      `&orderBy=modifiedTime desc`
  );

  const files = (result.files ?? []) as Array<{
    name?: string;
    webViewLink?: string;
    modifiedTime?: string;
  }>;

  return files
    .filter((file) => file.name && file.webViewLink)
    .map((file) => ({
      name: file.name!,
      url: file.webViewLink!,
      updated: (file.modifiedTime ?? "").slice(0, 10),
    }));
}

// --- Calendar --------------------------------------------------------------

type CalendarEvent = {
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  transparency?: string;
};

async function busyRanges(
  accessToken: string,
  fromIso: string,
  toIso: string
): Promise<Array<{ start: number; end: number }>> {
  const result = await call<{ items?: CalendarEvent[] }>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
      `?timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso)}` +
      "&singleEvents=true&orderBy=startTime&maxResults=250" +
      "&fields=items(start,end,status,transparency)"
  );

  return (result.items ?? [])
    // Declined events and ones marked "free" are not a reason to refuse a
    // meeting; an all-day event has no dateTime and blocks the whole day.
    .filter((event) => event.status !== "cancelled" && event.transparency !== "transparent")
    .map((event) => {
      if (event.start?.dateTime && event.end?.dateTime) {
        return {
          start: new Date(event.start.dateTime).getTime(),
          end: new Date(event.end.dateTime).getTime(),
        };
      }
      if (event.start?.date) {
        return {
          start: new Date(`${event.start.date}T00:00:00Z`).getTime(),
          end: new Date(`${event.end?.date ?? event.start.date}T23:59:59Z`).getTime(),
        };
      }
      return null;
    })
    .filter((range): range is { start: number; end: number } => range !== null);
}

/** Free start times on one day, as "HH:mm" in the company's timezone. */
export async function freeSlots(
  accessToken: string,
  date: string,
  timeZone: string,
  fromHour: number,
  toHour: number
): Promise<string[]> {
  const dayStart = zonedToInstant(date, fromHour, 0, timeZone);
  const dayEnd = zonedToInstant(date, toHour, 0, timeZone);
  const busy = await busyRanges(
    accessToken,
    dayStart.toISOString(),
    new Date(dayEnd.getTime() + SLOT_MINUTES * 60000).toISOString()
  );

  const now = Date.now();
  const free: string[] = [];

  for (
    let start = dayStart.getTime();
    start <= dayEnd.getTime();
    start += SLOT_MINUTES * 60000
  ) {
    const end = start + SLOT_MINUTES * 60000;
    if (start < now) continue; // never offer the past
    if (busy.some((range) => range.start < end && range.end > start)) continue;
    free.push(formatTime(new Date(start), timeZone));
  }

  return free;
}

export async function isFree(
  accessToken: string,
  startsAt: Date,
  minutes: number
): Promise<boolean> {
  const end = new Date(startsAt.getTime() + minutes * 60000);
  const busy = await busyRanges(
    accessToken,
    startsAt.toISOString(),
    end.toISOString()
  );
  return !busy.some(
    (range) => range.start < end.getTime() && range.end > startsAt.getTime()
  );
}

export async function createEvent(
  accessToken: string,
  event: {
    title: string;
    notes?: string;
    /** Local wall time, "YYYY-MM-DDTHH:MM:SS", read in `timeZone`. */
    startLocal: string;
    endLocal: string;
    timeZone: string;
    attendeeEmail?: string;
  }
): Promise<{ id: string; url?: string }> {
  const created = await call<{ id: string; htmlLink?: string }>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      body: {
        summary: event.title,
        description: event.notes ?? "",
        // Wall time plus a zone, rather than an instant: Google then shows
        // 14:30 to everybody who reads the calendar in that zone, and handles
        // the DST arithmetic itself.
        start: { dateTime: event.startLocal, timeZone: event.timeZone },
        end: { dateTime: event.endLocal, timeZone: event.timeZone },
        attendees: event.attendeeEmail
          ? [{ email: event.attendeeEmail }]
          : undefined,
      },
    }
  );

  return { id: created.id, url: created.htmlLink };
}

// ---------------------------------------------------------------------------
// Timezones
//
// The workspace stores an IANA zone and the agent talks in local time, but
// the Calendar API filters on absolute instants. There is no date library in
// the Convex runtime, so these two do the conversion with `Intl`.
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");

/** The wall-clock fields of an instant, read in a zone. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const field = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    // en-CA renders midnight as hour 24 rather than 0.
    hour: field("hour") % 24,
    minute: field("minute"),
    second: field("second"),
  };
}

/**
 * Minutes east of UTC for a zone, at a given instant (so DST is included).
 *
 * Read by differencing the zone's wall clock against the instant rather than
 * by parsing a `timeZoneName: "longOffset"` string. That token needs full ICU
 * data, and where it is missing it does not throw — it returns a bare "GMT",
 * which would silently book every meeting in a non-UTC workspace at the wrong
 * hour. This form needs only that `Intl` knows the zone, which is the same
 * thing every other function here depends on, and throws a RangeError it does
 * not when the zone is nonsense.
 */
function offsetMinutes(at: Date, timeZone: string): number {
  const local = wallClock(at, timeZone);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second
  );
  // Milliseconds are not in the parts, so the difference is a whole minute
  // give or take the instant's own sub-minute remainder.
  return Math.round((asIfUtc - at.getTime()) / 60000);
}

/** The instant at which it is `hh:mm` on `date` in `timeZone`. */
export function zonedToInstant(
  date: string,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = new Date(`${date}T${pad(hour)}:${pad(minute)}:00Z`);
  const firstPass = offsetMinutes(guess, timeZone);
  const candidate = new Date(guess.getTime() - firstPass * 60000);
  // A second pass matters only within an hour of a DST change, where the
  // offset at the guess is not the offset at the answer.
  const secondPass = offsetMinutes(candidate, timeZone);
  return secondPass === firstPass
    ? candidate
    : new Date(guess.getTime() - secondPass * 60000);
}

/**
 * "HH:mm" for an instant, read in a zone.
 *
 * No fallback on purpose. A zone `Intl` cannot read is a broken workspace
 * setting, and a time silently rendered in UTC is a customer told to turn up
 * five and a half hours early.
 */
export function formatTime(at: Date, timeZone: string): string {
  const local = wallClock(at, timeZone);
  return `${pad(local.hour)}:${pad(local.minute)}`;
}

/**
 * Splits a local "YYYY-MM-DDTHH:MM" into the pieces the Calendar API wants.
 *
 * Returns null for anything unparseable rather than guessing — a booking at
 * the wrong time is worse than a booking that did not happen, and the tool
 * hands the error straight back to the model to ask again.
 */
export function parseLocalDateTime(
  value: string
): { date: string; hour: number; minute: number; local: string } | null {
  const match = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;

  return {
    date: match[1],
    hour,
    minute,
    local: `${match[1]}T${pad(hour)}:${pad(minute)}:00`,
  };
}

/** Local wall time `minutes` after a local wall time, in the same zone. */
export function addMinutesLocal(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
  minutes: number
): string {
  // Out to an instant and back, rather than adding to the clock directly: an
  // hour added across a DST boundary is not an hour on the wall.
  const end = new Date(
    zonedToInstant(date, hour, minute, timeZone).getTime() + minutes * 60000
  );
  const local = wallClock(end, timeZone);
  return (
    `${local.year}-${pad(local.month)}-${pad(local.day)}` +
    `T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}`
  );
}
