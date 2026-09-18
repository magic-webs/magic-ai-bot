// The integrations catalogue.
//
// No Convex imports here, so the dashboard can render the same catalogue the
// server writes from — the tool descriptions on the Integrations page are the
// ones the model will actually read.
//
// Three deliberate constraints shape the whole file.
//
// **Google only, for now.** Slack, Zapier and the "it lives elsewhere" cards
// (WhatsApp, outbound webhooks, MCP) are gone from here. A webhook is already
// a custom tool with two fields filled in, and the three surface cards were
// signposts to pages the sidebar links anyway.
//
// **Nothing to configure.** The earlier build asked for a spreadsheet id, a
// folder id and a pasted Apps Script per integration, which is four chances to
// paste the wrong thing before anything works. Connecting now signs in with
// Google and provisions whatever the integration needs — the sheet, the folder
// — in the operator's own Drive. `provisions` is the promise each card makes
// about that.
//
// **Tools are opt-in per agent.** Connecting writes the `tools` rows and stops
// there. An agent reaches an integration tool only once somebody switches it
// on under Knowledge & tools, because "the front desk can now write to the
// diary" is not something a connect button should decide.

export type IntegrationId =
  | "google_sheets"
  | "google_calendar"
  | "google_drive";

export type IntegrationToolParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
};

export type IntegrationToolSpec = {
  /** snake_case — the model's handle for it, and the per-agent switch key. */
  name: string;
  displayName: string;
  /** Shown to the model. This is what drives tool selection. */
  description: string;
  whenToUse: string;
  /** Path under `/integrations/google/` that serves this tool. */
  action: string;
  parameters: IntegrationToolParameter[];
};

export type IntegrationSpec = {
  id: IntegrationId;
  name: string;
  blurb: string;
  /** What the agents can do once it is connected, in the operator's words. */
  gives: string[];
  /**
   * OAuth scopes. Each is the narrowest one that does the job:
   *
   * - `spreadsheets` — create the enquiry sheet and append to it.
   * - `calendar.events` — read the diary to find free time, and write the
   *   booking. Not `calendar`, which would also let us edit the calendar
   *   itself; not `calendar.readonly`, which could not book.
   * - `drive.file` + `drive.metadata.readonly` — create the shared folder, then
   *   search names inside it. Metadata only: the agent sends links, so nothing
   *   here ever needs to read a file's contents.
   */
  scopes: string[];
  /** What connecting creates in their Google account. */
  provisions: string;
  tools: IntegrationToolSpec[];
};

// How the calendar integration reads a working day. Constants rather than
// fields: a bookable-hours form is exactly the manual configuration this
// rewrite is removing, and the workspace's own timezone is what turns these
// into real times.
export const BOOKABLE_FROM_HOUR = 9;
export const BOOKABLE_TO_HOUR = 18;
export const SLOT_MINUTES = 30;

/** Header row written into the enquiry sheet, in this order. */
export const ENQUIRY_SHEET_HEADERS = [
  "When",
  "Name",
  "Phone",
  "Email",
  "Summary",
  "Value",
];

export const INTEGRATIONS: IntegrationSpec[] = [
  {
    id: "google_sheets",
    name: "Google Sheets",
    blurb: "Every enquiry lands as a row in a spreadsheet in your own Drive.",
    gives: [
      "Agents log a completed enquiry as it happens",
      "Nothing to export — the sheet is the export",
      "Share it, filter it, pivot it: it is an ordinary spreadsheet",
    ],
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    provisions:
      "A spreadsheet called “<workspace> — Enquiries”, headers already in row 1.",
    tools: [
      {
        name: "log_enquiry_to_sheet",
        displayName: "Log enquiry to Google Sheets",
        description:
          "Append this enquiry as a row in the company's spreadsheet. Call it once, after the customer's details and what they want are both known.",
        whenToUse:
          "After a complete enquiry — you have a name, a way to reach them, and what they are asking for.",
        action: "sheets/append",
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
      },
    ],
  },

  {
    id: "google_calendar",
    name: "Google Calendar",
    blurb: "Agents offer real free slots and book the meeting into your diary.",
    gives: [
      "Agents read your actual availability before offering a time",
      "The meeting is created with the customer invited",
      "A slot taken between the offer and the booking is caught, not double-booked",
    ],
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    provisions:
      "Nothing new — it reads and writes the main calendar of the account you sign in with.",
    tools: [
      {
        name: "check_availability",
        displayName: "Check calendar availability",
        description:
          "List the free meeting slots on one day, in the company's timezone. Always call this before offering a customer a time — never guess at availability.",
        whenToUse: "The customer asks to meet, or asks when someone is free.",
        action: "calendar/availability",
        parameters: [
          {
            name: "date",
            type: "string",
            description: "The day to check, as YYYY-MM-DD",
            required: true,
          },
        ],
      },
      {
        name: "book_meeting",
        displayName: "Book a meeting",
        description:
          "Create the meeting in the company's calendar and invite the customer. Only call this with a time you got back from check_availability and the customer has agreed to. If it comes back saying the slot has gone, offer another.",
        whenToUse:
          "The customer has agreed to a specific time and given you an email address.",
        action: "calendar/book",
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
      },
    ],
  },

  {
    id: "google_drive",
    name: "Google Drive",
    blurb:
      "Agents find a brochure or price list and send the customer the link.",
    gives: [
      "Agents answer “can you send me the spec sheet?” with the real file",
      "Only the folder we create is searched, subfolders and all, so nothing else can leak",
      "Drop a new price list in the folder and it is live — no re-connecting",
    ],
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    provisions:
      "A folder called “<workspace> — Agent documents”. Put anything agents may send in it — subfolders are searched too.",
    tools: [
      {
        name: "find_document",
        displayName: "Find a document in Drive",
        description:
          "Search the company's shared folder by filename and get back links. Send the customer the link, not the file. If nothing matches, say so rather than inventing a document.",
        whenToUse:
          "The customer asks for a brochure, price list, spec sheet or similar.",
        action: "drive/search",
        parameters: [
          {
            name: "query",
            type: "string",
            description:
              "Words from the filename, e.g. 'price list' or 'installation guide'",
            required: true,
          },
        ],
      },
    ],
  },
];

export const findIntegration = (id: string): IntegrationSpec | undefined =>
  INTEGRATIONS.find((integration) => integration.id === id);

/** Every tool name the catalogue can create, for validating a per-agent list. */
export const INTEGRATION_TOOL_NAMES: string[] = INTEGRATIONS.flatMap(
  (integration) => integration.tools.map((tool) => tool.name)
);

export const INTEGRATION_IDS: string[] = INTEGRATIONS.map(
  (integration) => integration.id
);

/**
 * Whether a `tools.integration` tag belongs to the catalogue as it stands.
 *
 * Workspaces connected before this rewrite carry tools tagged `slack` or
 * `zapier`, which are now just HTTP tools with a tag nobody reads. Only
 * catalogue integrations are gated per agent — gating the others would have
 * quietly switched off a working Slack notification the day this shipped.
 */
export const isCatalogueIntegration = (id: string | undefined): boolean =>
  Boolean(id && INTEGRATION_IDS.includes(id));

/** The integration a tool name belongs to, for grouping the per-agent switches. */
export function integrationForToolName(
  name: string
): IntegrationSpec | undefined {
  return INTEGRATIONS.find((integration) =>
    integration.tools.some((tool) => tool.name === name)
  );
}

/**
 * Where a tool sends its call.
 *
 * The endpoint is on the Convex deployment rather than the Next app: the
 * refresh token never leaves Convex, and the engine's HTTP executor reaches it
 * without the web app having to be deployed at all. The call token in the
 * query string is the whole credential, which also means the stored tool looks
 * exactly like the hand-written HTTP tools the executor already runs — no
 * engine changes, and no per-call credential for it to know about.
 *
 * One trap that follows: the executor appends every tool parameter the URL
 * template did not consume to the query string, so a parameter named `token`
 * would overwrite this one and every call would come back unauthorised. None
 * of the parameters above is called that, and none should be.
 */
export function integrationToolUrl(
  siteUrl: string,
  action: string,
  callToken: string
): string {
  return `${siteUrl.replace(/\/+$/, "")}/integrations/google/${action}?token=${encodeURIComponent(
    callToken
  )}`;
}

// Google's OAuth endpoints, so nothing hardcodes them twice.
export const GOOGLE_AUTH_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Asked for alongside every integration, so the card can name the account. */
export const GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
];

/** The callback Google redirects to, and the one the console must whitelist. */
export function googleRedirectUri(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/integrations/google/callback`;
}
