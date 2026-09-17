/**
 * The integrations catalogue.
 *
 * Every integration here is a recipe for the custom-tool machinery that already
 * exists: connecting one writes one or more `tools` rows, marked with the
 * integration's id so disconnecting can take exactly those away again. Nothing
 * new runs at reply time — the engine's HTTP tool executor does the work, which
 * is why these can be added without touching the engine at all.
 *
 * Two deliberate constraints shape the whole file.
 *
 * **No body templates.** `renderTemplate` substitutes values into a template
 * without JSON-escaping them, so a body template of `{"note": "{{note}}"}`
 * produces invalid JSON the moment a customer's note contains a quote. With no
 * body template the executor falls back to `JSON.stringify(input)`, which is
 * correct for any input — so every tool below names its parameters to match
 * what the far end expects rather than reshaping them on the way out. The
 * executor also appends unconsumed parameters to the query string; that is
 * harmless duplication here, and the body is the copy that gets read.
 *
 * **No OAuth.** Google's APIs need a consent screen, a client secret and a
 * token store per workspace, and a half-built OAuth flow is worse than none.
 * The Google integrations instead go through a Google Apps Script web app the
 * company deploys in their own account: it runs as them, needs no credentials
 * from us, and reaches their Sheet, Calendar or Drive with the permissions they
 * already have. The trade is that they paste a script once.
 */

export type ToolParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enumValues?: string[];
};

export type IntegrationTool = {
  /** snake_case — the model's handle for it. */
  name: string;
  displayName: string;
  /** Shown to the model. This is what drives tool selection. */
  description: string;
  whenToUse?: string;
  parameters: ToolParameter[];
  http: {
    method: "GET" | "POST";
    urlTemplate: string;
    headers: Array<{ key: string; value: string }>;
    timeoutMs?: number;
  };
};

export type SetupField = {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  required: boolean;
};

export type IntegrationKind =
  /** Connecting writes tools. */
  | "tools"
  /** Already exists elsewhere in the console; this card only points at it. */
  | "surface";

export type Integration = {
  id: string;
  name: string;
  category: "Google" | "Automation" | "Messaging" | "Platform";
  blurb: string;
  /** What the agents can do once it is connected, in the operator's words. */
  gives: string[];
  kind: IntegrationKind;
  /** `surface` only: where the thing actually lives. */
  href?: (base: string) => string;
  hrefLabel?: string;
  /** `tools` only. */
  setup?: {
    fields: SetupField[];
    /** Numbered instructions shown above the script. */
    steps: string[];
    /** The Apps Script to paste, or null for a plain webhook. */
    script?: (values: Record<string, string>, token: string) => string;
    /** Where the URL they paste comes from. */
    urlField: string;
  };
  tools?: (values: Record<string, string>, token: string) => IntegrationTool[];
};

// ---------------------------------------------------------------- the scripts

/**
 * The header every generated Apps Script carries.
 *
 * The token check is not decoration. A web app deployed "anyone with the link"
 * is an open endpoint, and an open endpoint that writes to somebody's calendar
 * is a problem — so the tool sends a shared token in the query string and the
 * script refuses anything else. It goes in the query string rather than a
 * header because Apps Script's `doPost(e)` is given no request headers at all.
 */
const scriptPreamble = (token: string) => `// Magic Agent — generated. Paste into script.google.com and deploy as a Web app.
// Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
// Copy the /exec URL it gives you back into Magic Agent.

var TOKEN = ${JSON.stringify(token)}; // must match the one in Magic Agent

function reply(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readRequest(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return null;
  try {
    return JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return {};
  }
}
`;

const sheetsScript = (values: Record<string, string>, token: string) => `${scriptPreamble(token)}
// Appends one row per enquiry. Column order is fixed — put these headers in
// row 1 of the sheet: When, Name, Phone, Email, Summary, Value.
var SHEET_ID = ${JSON.stringify(values.sheetId || "PASTE_THE_SHEET_ID")};

function doPost(e) {
  var body = readRequest(e);
  if (!body) return reply({ ok: false, error: 'Unauthorised' });

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.appendRow([
    new Date(),
    body.name || '',
    body.phone || '',
    body.email || '',
    body.summary || '',
    body.value === undefined ? '' : body.value
  ]);

  return reply({ ok: true, row: sheet.getLastRow() });
}
`;

const calendarScript = (values: Record<string, string>, token: string) => `${scriptPreamble(token)}
// Leave CALENDAR_ID empty to use the account's default calendar.
var CALENDAR_ID = ${JSON.stringify(values.calendarId || "")};
var OPENS_AT = ${Number(values.opensAt) || 9};   // first hour a meeting may start
var CLOSES_AT = ${Number(values.closesAt) || 17}; // last hour a meeting may start
var SLOT_MINUTES = 30;

function calendar() {
  return CALENDAR_ID
    ? CalendarApp.getCalendarById(CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();
}

function doPost(e) {
  var body = readRequest(e);
  if (!body) return reply({ ok: false, error: 'Unauthorised' });

  if (e.parameter.action === 'availability') return availability(body);
  if (e.parameter.action === 'book') return book(body);
  return reply({ ok: false, error: 'Unknown action' });
}

// Free slots on one day, as plain times the agent can read out.
function availability(body) {
  var day = new Date((body.date || '') + 'T00:00:00');
  if (isNaN(day.getTime())) return reply({ ok: false, error: 'Send date as YYYY-MM-DD' });

  var cal = calendar();
  var zone = Session.getScriptTimeZone();
  var free = [];

  for (var hour = OPENS_AT; hour <= CLOSES_AT; hour++) {
    for (var minute = 0; minute < 60; minute += SLOT_MINUTES) {
      var start = new Date(day);
      start.setHours(hour, minute, 0, 0);
      var end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      if (start < new Date()) continue;          // never offer the past
      if (cal.getEvents(start, end).length > 0) continue;
      free.push(Utilities.formatDate(start, zone, 'HH:mm'));
    }
  }

  return reply({
    ok: true,
    date: body.date,
    timezone: zone,
    slotMinutes: SLOT_MINUTES,
    free: free
  });
}

function book(body) {
  var start = new Date(body.startsAt || '');
  if (isNaN(start.getTime())) {
    return reply({ ok: false, error: 'Send startsAt as an ISO time, e.g. 2026-09-24T14:30' });
  }

  var minutes = Number(body.minutes) || SLOT_MINUTES;
  var end = new Date(start.getTime() + minutes * 60000);
  var cal = calendar();

  // Last check before writing — the agent may have been told a slot that has
  // since gone, and a double booking is worse than a re-ask.
  if (cal.getEvents(start, end).length > 0) {
    return reply({ ok: false, error: 'That time has just been taken. Offer another.' });
  }

  var event = cal.createEvent(
    body.title || 'Meeting',
    start,
    end,
    {
      description: body.notes || '',
      guests: body.attendeeEmail || '',
      sendInvites: true
    }
  );

  return reply({
    ok: true,
    eventId: event.getId(),
    startsAt: start.toISOString(),
    endsAt: end.toISOString()
  });
}
`;

const driveScript = (values: Record<string, string>, token: string) => `${scriptPreamble(token)}
// Only this folder is searched, so an agent can never hand out a file you did
// not put here. Share the folder as "anyone with the link can view" if you want
// customers to be able to open what the agent sends.
var FOLDER_ID = ${JSON.stringify(values.folderId || "PASTE_THE_FOLDER_ID")};
var MAX_RESULTS = 5;

function doPost(e) {
  var body = readRequest(e);
  if (!body) return reply({ ok: false, error: 'Unauthorised' });

  // Quotes would break out of the search expression, so they are removed
  // rather than escaped — a filename search does not need them.
  var term = String(body.query || '').replace(/["\\\\]/g, '').trim();
  if (!term) return reply({ ok: false, error: 'Send a query' });

  var files = DriveApp.getFolderById(FOLDER_ID)
    .searchFiles('title contains "' + term + '"');

  var found = [];
  while (files.hasNext() && found.length < MAX_RESULTS) {
    var file = files.next();
    found.push({
      name: file.getName(),
      url: file.getUrl(),
      updated: file.getLastUpdated().toISOString()
    });
  }

  return reply({ ok: true, count: found.length, files: found });
}
`;

// ------------------------------------------------------------- the catalogue

/** Appends the token, and an action where one script serves two tools. */
const scriptUrl = (base: string | undefined, token: string, action?: string) => {
  const url = (base ?? "").trim();
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}token=${encodeURIComponent(token)}${
    action ? `&action=${action}` : ""
  }`;
};

export const INTEGRATIONS: Integration[] = [
  {
    id: "google_sheets",
    name: "Google Sheets",
    category: "Google",
    blurb: "Every enquiry lands as a row in a spreadsheet you already look at.",
    gives: [
      "Agents log a completed enquiry to your sheet as it happens",
      "Nothing to export — the sheet is the export",
    ],
    kind: "tools",
    setup: {
      urlField: "webAppUrl",
      fields: [
        {
          key: "sheetId",
          label: "Spreadsheet ID",
          placeholder: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
          hint: "The long code in the sheet's address, between /d/ and /edit.",
          required: true,
        },
        {
          key: "webAppUrl",
          label: "Web app URL",
          placeholder: "https://script.google.com/macros/s/AKfy…/exec",
          hint: "What Apps Script gives you after you deploy the script below.",
          required: true,
        },
      ],
      steps: [
        "Open the spreadsheet and put these headers in row 1: When, Name, Phone, Email, Summary, Value.",
        "Copy the sheet's ID out of its address and paste it above.",
        "Go to script.google.com, start a new project and paste the script below over whatever is there.",
        "Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.",
        "Copy the /exec URL it hands back and paste it above, then connect.",
      ],
      script: sheetsScript,
    },
    tools: (values, token) => [
      {
        name: "log_enquiry_to_sheet",
        displayName: "Log enquiry to Google Sheets",
        description:
          "Append this enquiry as a row in the company's spreadsheet. Call it once, after the customer's details and what they want are both known.",
        whenToUse:
          "After a complete enquiry — you have a name, a way to reach them, and what they are asking for.",
        parameters: [
          {
            name: "name",
            type: "string",
            description: "The customer's name",
            required: true,
          },
          {
            name: "phone",
            type: "string",
            description: "Phone number, if they gave one",
            required: false,
          },
          {
            name: "email",
            type: "string",
            description: "Email address, if they gave one",
            required: false,
          },
          {
            name: "summary",
            type: "string",
            description:
              "One or two sentences: what they want, quantities, and anything agreed",
            required: true,
          },
          {
            name: "value",
            type: "number",
            description: "Order value, if one was quoted",
            required: false,
          },
        ],
        http: {
          method: "POST",
          urlTemplate: scriptUrl(values.webAppUrl, token),
          headers: [],
        },
      },
    ],
  },

  {
    id: "google_calendar",
    name: "Google Calendar",
    category: "Google",
    blurb: "Agents offer real free slots and book the meeting into your diary.",
    gives: [
      "Agents read your actual availability before offering a time",
      "The meeting is created with the customer invited",
      "A slot taken between the offer and the booking is caught, not double-booked",
    ],
    kind: "tools",
    setup: {
      urlField: "webAppUrl",
      fields: [
        {
          key: "calendarId",
          label: "Calendar ID",
          placeholder: "Leave empty for your main calendar",
          hint: "Calendar settings → Integrate calendar → Calendar ID. Empty uses the default.",
          required: false,
        },
        {
          key: "opensAt",
          label: "First hour bookable",
          placeholder: "9",
          hint: "24-hour clock. 9 means the earliest meeting starts at 09:00.",
          required: false,
        },
        {
          key: "closesAt",
          label: "Last hour bookable",
          placeholder: "17",
          hint: "The latest hour a meeting may start.",
          required: false,
        },
        {
          key: "webAppUrl",
          label: "Web app URL",
          placeholder: "https://script.google.com/macros/s/AKfy…/exec",
          hint: "What Apps Script gives you after you deploy the script below.",
          required: true,
        },
      ],
      steps: [
        "Set your bookable hours above — the script will never offer a time outside them.",
        "Go to script.google.com, start a new project and paste the script below over whatever is there.",
        "Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.",
        "Run it once from the editor first so Google asks you to grant calendar access.",
        "Copy the /exec URL and paste it above, then connect.",
      ],
      script: calendarScript,
    },
    tools: (values, token) => [
      {
        name: "check_availability",
        displayName: "Check calendar availability",
        description:
          "List the free meeting slots on one day. Returns times in the company's timezone. Always call this before offering a customer a time — never guess at availability.",
        whenToUse:
          "The customer asks to meet, or asks when someone is free.",
        parameters: [
          {
            name: "date",
            type: "string",
            description: "The day to check, as YYYY-MM-DD",
            required: true,
          },
        ],
        http: {
          method: "POST",
          urlTemplate: scriptUrl(values.webAppUrl, token, "availability"),
          headers: [],
        },
      },
      {
        name: "book_meeting",
        displayName: "Book a meeting",
        description:
          "Create the meeting in the company's calendar and invite the customer. Only call this with a time you got back from check_availability and the customer has agreed to. If it comes back saying the slot has gone, offer another.",
        whenToUse:
          "The customer has agreed to a specific time and given you an email address.",
        parameters: [
          {
            name: "title",
            type: "string",
            description:
              "What the meeting is, e.g. 'Site survey — Northgate Signs'",
            required: true,
          },
          {
            name: "startsAt",
            type: "string",
            description:
              "Start time as YYYY-MM-DDTHH:MM in the company's timezone, e.g. 2026-09-24T14:30",
            required: true,
          },
          {
            name: "minutes",
            type: "number",
            description: "How long, in minutes. 30 if unsure.",
            required: false,
          },
          {
            name: "attendeeEmail",
            type: "string",
            description: "The customer's email, so they get the invitation",
            required: true,
          },
          {
            name: "notes",
            type: "string",
            description: "What the meeting is about, for the invitation body",
            required: false,
          },
        ],
        http: {
          method: "POST",
          urlTemplate: scriptUrl(values.webAppUrl, token, "book"),
          headers: [],
        },
      },
    ],
  },

  {
    id: "google_drive",
    name: "Google Drive",
    category: "Google",
    blurb:
      "Agents find a brochure or price list in one folder and send the link.",
    gives: [
      "Agents answer “can you send me the spec sheet?” with the real file",
      "Only the folder you name is searchable, so nothing else can leak",
    ],
    kind: "tools",
    setup: {
      urlField: "webAppUrl",
      fields: [
        {
          key: "folderId",
          label: "Folder ID",
          placeholder: "1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv",
          hint: "The code at the end of the folder's address. Only this folder is searched.",
          required: true,
        },
        {
          key: "webAppUrl",
          label: "Web app URL",
          placeholder: "https://script.google.com/macros/s/AKfy…/exec",
          hint: "What Apps Script gives you after you deploy the script below.",
          required: true,
        },
      ],
      steps: [
        "Put the documents agents may send — brochures, price lists, spec sheets — in one Drive folder.",
        "Share that folder as “Anyone with the link can view”, or customers will not be able to open what the agent sends.",
        "Copy the folder's ID out of its address and paste it above.",
        "Go to script.google.com, paste the script below, and deploy it as a Web app (Execute as: Me, Access: Anyone).",
        "Copy the /exec URL and paste it above, then connect.",
      ],
      script: driveScript,
    },
    tools: (values, token) => [
      {
        name: "find_document",
        displayName: "Find a document in Drive",
        description:
          "Search the company's shared folder by filename and get back links. Send the customer the link, not the file. If nothing matches, say so rather than inventing a document.",
        whenToUse:
          "The customer asks for a brochure, price list, spec sheet or similar.",
        parameters: [
          {
            name: "query",
            type: "string",
            description:
              "Words from the filename, e.g. 'price list' or 'installation guide'",
            required: true,
          },
        ],
        http: {
          method: "POST",
          urlTemplate: scriptUrl(values.webAppUrl, token),
          headers: [],
        },
      },
    ],
  },

  {
    id: "slack",
    name: "Slack",
    category: "Messaging",
    blurb: "Agents post into a channel when something needs a person.",
    gives: [
      "A message in Slack the moment an agent takes a serious enquiry",
      "No polling the dashboard to find out something happened",
    ],
    kind: "tools",
    setup: {
      urlField: "webhookUrl",
      fields: [
        {
          key: "webhookUrl",
          label: "Incoming webhook URL",
          placeholder: "https://hooks.slack.com/services/T000/B000/XXXX",
          hint: "Slack → your app → Incoming Webhooks → Add New Webhook to Workspace.",
          required: true,
        },
      ],
      steps: [
        "In Slack, go to api.slack.com/apps and create an app for your workspace (or open an existing one).",
        "Turn on Incoming Webhooks, then Add New Webhook to Workspace and pick the channel.",
        "Copy the webhook URL and paste it above.",
      ],
    },
    tools: (values) => [
      {
        name: "notify_team",
        displayName: "Post to Slack",
        description:
          "Post a short message into the team's Slack channel. Use it to flag something a person needs to see — a large order, an unhappy customer, a question you could not answer.",
        whenToUse:
          "Something has happened that a human should know about now rather than later.",
        parameters: [
          {
            // Named `text` on purpose: with no body template the executor sends
            // the parameters as the JSON body, and `{ "text": … }` is exactly
            // the payload a Slack incoming webhook expects.
            name: "text",
            type: "string",
            description:
              "The message. Include who it is about and what is needed — Slack shows it with no other context.",
            required: true,
          },
        ],
        http: {
          method: "POST",
          urlTemplate: (values.webhookUrl ?? "").trim(),
          headers: [],
        },
      },
    ],
  },

  {
    id: "zapier",
    name: "Zapier, Make or n8n",
    category: "Automation",
    blurb:
      "One webhook into whatever else you run — a CRM, an inbox, a database.",
    gives: [
      "Agents push an event into your automation, which fans it out anywhere",
      "Nothing here to maintain when the far end changes",
    ],
    kind: "tools",
    setup: {
      urlField: "webhookUrl",
      fields: [
        {
          key: "webhookUrl",
          label: "Webhook URL",
          placeholder: "https://hooks.zapier.com/hooks/catch/000000/abcdef/",
          hint: "A Zapier “Catch Hook”, a Make custom webhook, or an n8n webhook node.",
          required: true,
        },
      ],
      steps: [
        "Create a new automation triggered by a webhook: Zapier “Webhooks by Zapier → Catch Hook”, Make “Custom webhook”, or an n8n Webhook node.",
        "Copy the URL it gives you and paste it above.",
        "Connect here, then send one test from the agent playground so the far end learns the field names.",
      ],
    },
    tools: (values) => [
      {
        name: "send_to_automation",
        displayName: "Send to automation",
        description:
          "Push an event to the company's automation, which routes it onward. Use it when something has been agreed or captured that other systems need to know about.",
        whenToUse:
          "An enquiry is complete, an order is agreed, or a customer has asked for something another system handles.",
        parameters: [
          {
            name: "event",
            type: "string",
            description:
              "What happened, in snake_case — enquiry_captured, meeting_booked, complaint_raised",
            required: true,
          },
          {
            name: "customer",
            type: "string",
            description: "Who it concerns — name, and phone or email",
            required: true,
          },
          {
            name: "summary",
            type: "string",
            description: "What happened, in a sentence or two",
            required: true,
          },
          {
            name: "value",
            type: "number",
            description: "Amount involved, if there is one",
            required: false,
          },
        ],
        http: {
          method: "POST",
          urlTemplate: (values.webhookUrl ?? "").trim(),
          headers: [],
        },
      },
    ],
  },

  // The three below already exist in the console. They are listed because this
  // is the page somebody opens looking for them — a card that admits it lives
  // elsewhere beats a page that silently omits half the answer.
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    category: "Messaging",
    blurb: "Where most of your customers actually message you.",
    gives: [
      "Agents answer on WhatsApp under your own number",
      "Set up with a phone number ID and an access token",
    ],
    kind: "surface",
    href: (base) => `${base}/channels`,
    hrefLabel: "Open channels",
  },
  {
    id: "webhook_out",
    name: "Outbound webhook",
    category: "Automation",
    blurb:
      "The platform POSTs to you when an order is captured or a chat is escalated.",
    gives: [
      "Events pushed to your own server, signed with a shared secret",
      "The other direction from the integrations above — this one is us calling you",
    ],
    kind: "surface",
    href: (base) => `${base}/settings`,
    hrefLabel: "Open settings",
  },
  {
    id: "mcp",
    name: "Claude and MCP",
    category: "Platform",
    blurb:
      "Run this workspace from Claude — agents, catalogue, knowledge and orders.",
    gives: [
      "One connector URL that gives Claude the whole workspace",
      "For you and your team, not for customers",
    ],
    kind: "surface",
    href: (base) => `${base}/settings`,
    hrefLabel: "Open settings",
  },
];

export const INTEGRATION_CATEGORIES = [
  "Google",
  "Messaging",
  "Automation",
  "Platform",
] as const;

export const findIntegration = (id: string) =>
  INTEGRATIONS.find((integration) => integration.id === id);

/**
 * A shared secret for a generated script.
 *
 * `crypto.getRandomValues` rather than `Math.random`: this is the only thing
 * standing between a public web app URL and somebody else's calendar.
 */
export function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Recovers the token and the pasted URL from a tool this file created.
 *
 * Reconnecting to change a folder or a bookable hour should not force a new
 * token and a re-paste of the script, so the dialog reads what is already
 * stored instead of starting again. Returns nulls for anything it cannot read,
 * which is the signal to generate a fresh one.
 */
export function readConnection(urlTemplate: string): {
  baseUrl: string | null;
  token: string | null;
} {
  try {
    const url = new URL(urlTemplate);
    const token = url.searchParams.get("token");
    url.searchParams.delete("token");
    url.searchParams.delete("action");
    const base = url.toString().replace(/\?$/, "");
    return { baseUrl: base, token };
  } catch {
    return { baseUrl: null, token: null };
  }
}
