import type { Icon } from "@phosphor-icons/react";
import {
  CalendarCheckIcon,
  ChatCircleTextIcon,
  ClockIcon,
  FileTextIcon,
  FolderIcon,
  GiftIcon,
  KeyIcon,
  LightningIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  RobotIcon,
  ShieldCheckIcon,
  TableIcon,
  TrophyIcon,
  TreeStructureIcon,
  UserCircleCheckIcon,
} from "@phosphor-icons/react";

/**
 * What the Integrations panel says about each card.
 *
 * Copy, not configuration: the model-facing tool descriptions stay in
 * convex/lib/integrations.ts and convex/lib/apps.ts, which is what the agent
 * actually reads. This is the operator's side — what connecting does, what
 * it can touch, and how to set it up — kept out of the page so the page is
 * about layout.
 */

export type Feature = { icon: Icon; title: string; body: string };

export type IntegrationDetail = {
  /** The Overview tab: three things it does, in the operator's words. */
  features: Feature[];
  /** The Permissions tab. */
  permissions: { can: string[]; never: string[] };
  /** "How to connect", as numbered steps. */
  steps: string[];
  /** The reassurance under the steps. */
  note: string;
  faq: Array<{ q: string; a: string }>;
};

export const INTEGRATION_DETAILS: Record<string, IntegrationDetail> = {
  // --------------------------------------------------------------- Magic apps
  magic_forms: {
    features: [
      {
        icon: FileTextIcon,
        title: "Every form, one tool",
        body: "Agents pick the right published form for the conversation and send it as a button.",
      },
      {
        icon: UserCircleCheckIcon,
        title: "Filled in for them",
        body: "The customer's name, number and email are already there when the form opens.",
      },
      {
        icon: ChatCircleTextIcon,
        title: "Answers come back",
        body: "The submission lands in the same chat, and the agent replies to it.",
      },
    ],
    permissions: {
      can: [
        "Read the names of your published forms and which fields they have",
        "Make a prefilled link to a form for one customer",
        "Receive a copy of each submission made through a link an agent sent",
      ],
      never: [
        "Edit, publish or delete your forms",
        "Read submissions made any other way — a link on your website stays yours",
      ],
    },
    steps: [
      "In Magic Forms, open your workspace → API → Keys and create a key",
      "Paste the key above and press Connect",
      "Switch send_form on for an agent under Knowledge & tools",
    ],
    note: "Only forms sent by an agent come back into the chat. Nothing else in Magic Forms changes.",
    faq: [
      {
        q: "Which forms can an agent send?",
        a: "Every published form in the workspace the key belongs to. Publish a new one and it is offered within half an hour — or press Refresh.",
      },
      {
        q: "What happens when the customer submits?",
        a: "Their answers arrive in the conversation as their next message. With “Reply when it comes back” on, the agent answers straight away.",
      },
      {
        q: "Can I use a different Magic Forms workspace?",
        a: "Yes — replace the key with one made in the other workspace. Links already sent keep working.",
      },
    ],
  },

  magic_reward: {
    features: [
      {
        icon: GiftIcon,
        title: "Running offers only",
        body: "Agents can only send offers that are live in Magic Reward — never one they made up.",
      },
      {
        icon: UserCircleCheckIcon,
        title: "One tap to play",
        body: "The customer's name and number are filled in, so they go straight to the game.",
      },
      {
        icon: TrophyIcon,
        title: "The prize comes back",
        body: "What they won lands in the same chat, and the agent follows it up.",
      },
    ],
    permissions: {
      can: [
        "Read your running offers and their prizes",
        "Make a personal link to an offer for one customer",
        "Receive the result of every play through a link an agent sent",
      ],
      never: [
        "Change your offers, prizes or odds",
        "Give anyone a second play — each customer plays each offer once",
      ],
    },
    steps: [
      "In Magic Reward, open your company → Settings → API keys and create a key",
      "Paste the key above and press Connect",
      "Switch send_offer on for an agent under Knowledge & tools",
    ],
    note: "Agents are told these are the only offers that exist, so they never promise a prize you did not set up.",
    faq: [
      {
        q: "Which offers can an agent send?",
        a: "Only the ones switched on in Magic Reward. Pause an offer there and agents stop sending it.",
      },
      {
        q: "What if the customer already played?",
        a: "The agent is told, and tells the customer what they got instead of sending the link again.",
      },
      {
        q: "Does the customer have to type anything?",
        a: "Only what the offer asks beyond their name and number — those are filled in.",
      },
    ],
  },

  // ------------------------------------------------------------------- Google
  google_sheets: {
    features: [
      {
        icon: TableIcon,
        title: "A row per enquiry",
        body: "Agents log each completed enquiry as it happens — name, contact, what they want.",
      },
      {
        icon: LightningIcon,
        title: "Nothing to export",
        body: "The sheet is the export. Filter it, share it, pivot it.",
      },
      {
        icon: ShieldCheckIcon,
        title: "Your own Drive",
        body: "We create one spreadsheet and only ever write to that one.",
      },
    ],
    permissions: {
      can: [
        "Create the enquiry spreadsheet in your Drive",
        "Append rows to that spreadsheet",
      ],
      never: ["Open, read or change any other spreadsheet"],
    },
    steps: [
      "Click “Connect with Google” above",
      "Choose your Google account and allow access",
      "Switch log_enquiry_to_sheet on for an agent under Knowledge & tools",
    ],
    note: "The spreadsheet is created for you, headers already in row 1.",
    faq: [
      {
        q: "Where is the spreadsheet?",
        a: "In the Drive of the account you connect, named after your workspace. The Open link appears here once connected.",
      },
      {
        q: "Can I rename or move it?",
        a: "Yes. It is found by its id, not its name or folder.",
      },
    ],
  },

  google_calendar: {
    features: [
      {
        icon: ClockIcon,
        title: "Real free time",
        body: "Agents read your actual availability before offering a slot.",
      },
      {
        icon: CalendarCheckIcon,
        title: "Booked and invited",
        body: "The meeting goes into your diary with the customer invited.",
      },
      {
        icon: ShieldCheckIcon,
        title: "No double bookings",
        body: "A slot taken between the offer and the booking is caught.",
      },
    ],
    permissions: {
      can: [
        "Read events on your main calendar to find free time",
        "Create events and invite the customer",
      ],
      never: ["Change your calendar's settings or anyone else's calendar"],
    },
    steps: [
      "Click “Connect with Google” above",
      "Choose your Google account and allow access",
      "Switch check_availability and book_meeting on for an agent",
    ],
    note: "Slots are offered between 9:00 and 18:00 in your workspace's timezone.",
    faq: [
      {
        q: "Which calendar is used?",
        a: "The main calendar of the account you connect.",
      },
      {
        q: "How long is a meeting?",
        a: "Thirty minutes unless the agent agrees another length with the customer.",
      },
    ],
  },

  google_drive: {
    features: [
      {
        icon: MagnifyingGlassIcon,
        title: "Find & share files",
        body: "Agents search for the right document and share it in chat.",
      },
      {
        icon: FolderIcon,
        title: "Price lists & brochures",
        body: "Keep your latest files in one folder and agents send them instantly.",
      },
      {
        icon: ShieldCheckIcon,
        title: "Secure access",
        body: "Only the folder we create is searched. You can revoke access anytime.",
      },
    ],
    permissions: {
      can: [
        "Create one shared folder in your Drive",
        "Search file names inside that folder and its subfolders",
      ],
      never: [
        "Read the contents of any file — agents send links",
        "See anything outside the folder",
      ],
    },
    steps: [
      "Click “Connect with Google” above",
      "Choose your Google account and allow access",
      "Put the files agents may send in the folder we create",
    ],
    note: "Only the selected folder will be searched. Subfolders are included automatically.",
    faq: [
      {
        q: "How do I add a new price list?",
        a: "Drop it in the folder. It can be sent at once — no reconnecting.",
      },
      {
        q: "Who can open the links?",
        a: "Whoever the file is shared with in Drive. Share the folder by link if customers should open everything in it.",
      },
    ],
  },

  // -------------------------------------------------------------- Other tools
  slack: {
    features: [
      {
        icon: ChatCircleTextIcon,
        title: "Post to a channel",
        body: "An agent posts a message to your team channel when something needs a look.",
      },
      {
        icon: LinkIcon,
        title: "One webhook URL",
        body: "A Slack incoming webhook is all it takes — no app to install here.",
      },
      {
        icon: ShieldCheckIcon,
        title: "Post only",
        body: "The webhook can post to one channel and read nothing.",
      },
    ],
    permissions: {
      can: ["Post messages to the one channel the webhook was made for"],
      never: ["Read messages, members or other channels"],
    },
    steps: [
      "In Slack, create an Incoming Webhook for the channel",
      "In Custom tools, add a POST tool to that URL with the body {\"text\": \"{{message}}\"}",
      "Switch it on for an agent and say when to use it",
    ],
    note: "Custom tools run from Magic Agent's servers, so the webhook URL never reaches the browser of a customer.",
    faq: [
      {
        q: "Can the team be told about every order instead?",
        a: "Yes — use Notifications, or point the workspace webhook in Settings at a Zapier or Make scenario that posts to Slack.",
      },
    ],
  },

  zapier: {
    features: [
      {
        icon: LightningIcon,
        title: "6,000+ apps",
        body: "Send every order, record and escalation into Zapier and on to anything it connects.",
      },
      {
        icon: TreeStructureIcon,
        title: "Or call a Zap",
        body: "An agent can trigger a Zap mid-conversation as a custom tool.",
      },
      {
        icon: ShieldCheckIcon,
        title: "Signed events",
        body: "Every event carries a signature so your Zap can tell it is really us.",
      },
    ],
    permissions: {
      can: ["Receive the events you choose to send it"],
      never: ["Reach into Magic Agent — Zapier only gets what is sent to it"],
    },
    steps: [
      "In Zapier, start a Zap with “Webhooks by Zapier → Catch Hook” and copy its URL",
      "Paste it as the workspace webhook in Settings → Webhook, or as a custom tool",
      "Send a test event and finish the Zap",
    ],
    note: "The same works for Make, n8n and anything else that takes a webhook.",
    faq: [
      {
        q: "Which events are sent?",
        a: "Orders, filed and updated records, stage changes, escalations and Magic app results.",
      },
    ],
  },

  webhooks: {
    features: [
      {
        icon: LightningIcon,
        title: "Every event, as it happens",
        body: "Orders, records, escalations and form results are posted to your URL.",
      },
      {
        icon: KeyIcon,
        title: "Signed",
        body: "An HMAC signature on every delivery, with a secret you can rotate.",
      },
      {
        icon: TreeStructureIcon,
        title: "In as well as out",
        body: "Alerts give other systems a URL to post to, which sends a WhatsApp or email.",
      },
    ],
    permissions: {
      can: ["Post the workspace's events to the URL you set"],
      never: ["Accept anything back from that URL"],
    },
    steps: [
      "Open Settings → Webhook",
      "Paste your endpoint's URL and save",
      "Send a test event and check the delivery log",
    ],
    note: "Each record book can also have webhooks of its own, under Record books.",
    faq: [
      {
        q: "How do I check a delivery really came from us?",
        a: "Compute an HMAC-SHA256 of the body with your secret and compare it with the X-Magic-Signature header.",
      },
    ],
  },

  notion: {
    features: [
      {
        icon: FileTextIcon,
        title: "Write pages",
        body: "An agent adds a page to a Notion database — a lead, a request, a note.",
      },
      {
        icon: MagnifyingGlassIcon,
        title: "Read what you share",
        body: "Only pages you share with your Notion integration can be reached.",
      },
      {
        icon: ShieldCheckIcon,
        title: "Your token, server-side",
        body: "The integration secret stays on Magic Agent's servers.",
      },
    ],
    permissions: {
      can: ["Whatever you share with the Notion integration you create"],
      never: ["Reach pages you have not shared with it"],
    },
    steps: [
      "In Notion, create an internal integration and share a database with it",
      "In Custom tools, add a POST tool to https://api.notion.com/v1/pages with your secret as the Authorization header",
      "Switch it on for an agent and say when to use it",
    ],
    note: "Notion's API needs a Notion-Version header too — add it beside Authorization.",
    faq: [
      {
        q: "Is there a one-click Notion connection?",
        a: "Not yet. A custom tool does the same job today.",
      },
    ],
  },

  mcp: {
    features: [
      {
        icon: RobotIcon,
        title: "Run it from Claude or ChatGPT",
        body: "Set up agents, catalogue and knowledge by asking an assistant.",
      },
      {
        icon: ShieldCheckIcon,
        title: "Your workspace only",
        body: "The connector acts for this workspace and nothing else.",
      },
      {
        icon: KeyIcon,
        title: "Revocable",
        body: "Rotate or delete the connector URL whenever you like.",
      },
    ],
    permissions: {
      can: ["Everything you can do on this dashboard, for this workspace"],
      never: ["Reach any other workspace"],
    },
    steps: [
      "Open Settings → Assistant and create a connector URL",
      "In Claude or ChatGPT, add it as a custom connector",
      "Ask it to show you your agents",
    ],
    note: "Treat the connector URL like a password — it is the whole credential.",
    faq: [
      {
        q: "What can the assistant do?",
        a: "Draft and update agents, manage the catalogue, knowledge base, record books, channels and alerts, and read conversations.",
      },
    ],
  },
};
