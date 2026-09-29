// Magic apps — the sibling products an agent can hand a customer to.
//
// No Convex imports here, so the dashboard renders the same catalogue the
// engine builds its tools from, and the webhook route reads results with the
// same code the tests would.
//
// How the round trip works, because it is spread over three systems:
//
// 1. The workspace connects an app by pasting an API key from it. Connecting
//    reads the account, copies its forms or offers into `appConnections.items`,
//    and registers a signed webhook back to `/apps/<inboundKey>` here.
// 2. An agent with the app switched on gets one tool — `send_form` or
//    `send_offer`. It asks the app for a link carrying a `ref` minted here,
//    files that ref against the conversation in `appLinks`, and sends the link
//    as a button.
// 3. The customer submits the form or plays the offer. The app posts the
//    result with the ref, the route matches it to the conversation, and the
//    result arrives in the thread as the customer's own turn — which is what it
//    is — so the agent can answer it and the follow-up desk can read it.
//
// Nothing is polled. An app that cannot reach this deployment simply never
// reports back, and the link it sent still works for the customer.

export type AppId = "magic_forms" | "magic_reward";

export type AppToolName = "send_form" | "send_offer";

export type AppPrefillField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  multiple: boolean;
  options?: Array<{ label: string; value: string }>;
};

/**
 * One form or offer, as copied from the app. `key` is what the tool's enum
 * carries: a form's slug, which reads well to the model, or an offer's id,
 * because two offers may share a title.
 */
export type AppItem = {
  id: string;
  key: string;
  title: string;
  description?: string;
  url?: string;
  /** A form's group, or an offer's game type ("Spin the Wheel"). */
  kind?: string;
  prefill?: AppPrefillField[];
  prizes?: Array<{ label: string; isWin: boolean }>;
};

export type AppSpec = {
  id: AppId;
  name: string;
  blurb: string;
  gives: string[];
  /** Every key the app mints starts with this, so a pasted key can be checked. */
  keyPrefix: string;
  /** Where in the app the key is made, in the operator's words. */
  keyHelp: string;
  /** Where the app's API answers in production. */
  defaultBaseUrl: string;
  /**
   * A Convex env var that overrides it — for pointing a development
   * deployment at the app's own development deployment.
   */
  envVar: string;
  toolName: AppToolName;
  toolLabel: string;
  /** Shown beside the per-agent switch. */
  toolSummary: string;
  /** "form" or "offer", for copy that counts them. */
  noun: string;
  /** Webhook events the connection subscribes to. */
  events: string[];
  /** The platform event fired when a result comes back. */
  resultEvent: string;
};

export const APPS: AppSpec[] = [
  {
    id: "magic_forms",
    name: "Magic Forms",
    blurb:
      "Agents send the customer the right form, and the answers come back into the chat.",
    gives: [
      "Every published form is available — the agent picks the one that fits",
      "The customer's name and number are filled in for them",
      "Submissions land in the conversation, so the agent can reply to them",
    ],
    keyPrefix: "mf_live_",
    keyHelp: "In Magic Forms, open your workspace → API → Keys, and create a key.",
    // The web app proxies /api/v1 to its Convex HTTP actions.
    defaultBaseUrl: "https://forms.magicwebs.ai",
    envVar: "MAGIC_FORMS_API_URL",
    toolName: "send_form",
    toolLabel: "Send a form",
    toolSummary:
      "Send the customer one of your Magic Forms as a button. Their answers come back into the chat.",
    noun: "form",
    // Not form.updated: the builder saves as it goes, and a refresh per
    // keystroke buys nothing the stale-copy refresh does not.
    events: [
      "submission.created",
      "form.published",
      "form.unpublished",
      "form.deleted",
    ],
    resultEvent: "form_submitted",
  },
  {
    id: "magic_reward",
    name: "Magic Reward",
    blurb:
      "Agents send the customer a running offer to play, and the prize comes back into the chat.",
    gives: [
      "Only offers that are live in Magic Reward can be sent",
      "The customer's name and number are filled in for them",
      "The result lands in the conversation, so the agent can follow it up",
    ],
    keyPrefix: "mr_live_",
    keyHelp: "In Magic Reward, open your company → Settings → API keys, and create a key.",
    defaultBaseUrl: "https://reward.magicwebs.ai",
    envVar: "MAGIC_REWARD_API_URL",
    toolName: "send_offer",
    toolLabel: "Send an offer",
    toolSummary:
      "Send the customer one of your running Magic Reward offers to play. The prize comes back into the chat.",
    noun: "offer",
    events: ["spin.completed"],
    resultEvent: "offer_played",
  },
];

export const findApp = (id: string): AppSpec | undefined =>
  APPS.find((app) => app.id === id);

export const appForToolName = (name: string): AppSpec | undefined =>
  APPS.find((app) => app.toolName === name);

/** Every tool name an app can put on an agent, for validating a per-agent list. */
export const APP_TOOL_NAMES: string[] = APPS.map((app) => app.toolName);

/** Kept small: the whole list is written into the tool's description. */
export const MAX_APP_ITEMS = 60;
const MAX_PREFILL_FIELDS = 30;
const MAX_PRIZES = 20;

/** WhatsApp caps a button label at twenty characters. */
export const BUTTON_TEXT_MAX = 20;

// ---------------------------------------------------------------------------
// Reading an app's catalogue
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** The account a key belongs to, from `GET /api/v1/me`. */
export function readAccount(
  app: AppId,
  body: unknown
): { id: string; name: string; slug: string } | null {
  const row = asObject(asObject(body)[app === "magic_forms" ? "workspace" : "company"]);
  const id = asString(row.id);
  const slug = asString(row.slug);
  if (!id || !slug) return null;
  return { id, slug, name: asString(row.name) ?? slug };
}

/** Forms from `GET /api/v1/forms`, or offers from `GET /api/v1/offers`. */
export function readItems(app: AppId, body: unknown): AppItem[] {
  const list = asArray(asObject(body)[app === "magic_forms" ? "forms" : "offers"]);
  const items: AppItem[] = [];

  for (const raw of list) {
    const row = asObject(raw);
    const id = asString(row.id);
    const title = asString(row.title);
    if (!id || !title) continue;

    if (app === "magic_forms") {
      const slug = asString(row.slug);
      if (!slug) continue;
      const prefill = asArray(row.prefill)
        .map((field): AppPrefillField | null => {
          const f = asObject(field);
          const key = asString(f.key);
          if (!key) return null;
          const options = asArray(f.options)
            .map((option) => {
              const o = asObject(option);
              const value = asString(o.value);
              return value ? { value, label: asString(o.label) ?? value } : null;
            })
            .filter((o): o is { label: string; value: string } => o !== null);
          return {
            key,
            label: asString(f.label) ?? key,
            type: asString(f.type) ?? "text",
            required: f.required === true,
            multiple: f.multiple === true,
            ...(options.length > 0 ? { options } : {}),
          };
        })
        .filter((f): f is AppPrefillField => f !== null)
        .slice(0, MAX_PREFILL_FIELDS);

      items.push({
        id,
        key: slug,
        title,
        description: asString(row.description),
        url: asString(row.url),
        kind: asString(asObject(row.group).name),
        prefill,
      });
    } else {
      const prizes = asArray(row.prizes)
        .map((prize) => {
          const p = asObject(prize);
          const label = asString(p.label);
          return label ? { label, isWin: p.isWin === true } : null;
        })
        .filter((p): p is { label: string; isWin: boolean } => p !== null)
        .slice(0, MAX_PRIZES);

      items.push({
        id,
        key: id,
        title,
        url: asString(row.url),
        kind: asString(row.typeLabel) ?? asString(row.type),
        prizes,
      });
    }

    if (items.length >= MAX_APP_ITEMS) break;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Prefilling a form
// ---------------------------------------------------------------------------

export type KnownContact = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
};

/**
 * The answers to send with a form link.
 *
 * What the model passes wins, then what the contact record already knows —
 * name, number, email, company — for any field that obviously asks for it. A
 * choice field only takes a value that is one of its options, matched on the
 * value or the label, since the app refuses the whole link over a single bad
 * option and the customer would get nothing.
 */
export function buildPrefill(
  fields: AppPrefillField[],
  fromModel: Record<string, unknown>,
  contact: KnownContact
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};

  const guess = (field: AppPrefillField): string | undefined => {
    const words = `${field.key} ${field.label}`.toLowerCase();
    if (field.type === "phone" || /\b(phone|mobile|whatsapp)\b/.test(words)) {
      return contact.phone;
    }
    if (field.type === "email" || /\be-?mail\b/.test(words)) {
      return contact.email;
    }
    if (field.type !== "text") return undefined;
    if (/\b(company|business|organi[sz]ation)\b/.test(words)) {
      return contact.company;
    }
    if (/\bname\b|full_?name|your_?name/.test(words)) return contact.name;
    return undefined;
  };

  for (const field of fields) {
    const given = fromModel[field.key];
    const raw =
      given === undefined || given === null || String(given).trim() === ""
        ? guess(field)
        : Array.isArray(given)
          ? given.map(String)
          : String(given);
    if (raw === undefined) continue;

    if (!field.options?.length) {
      const value = Array.isArray(raw) ? raw.join(", ") : raw.trim();
      if (value) out[field.key] = value;
      continue;
    }

    const pick = (candidate: string): string | undefined => {
      const needle = candidate.trim().toLowerCase();
      return field.options?.find(
        (option) =>
          option.value.toLowerCase() === needle ||
          option.label.toLowerCase() === needle
      )?.value;
    };
    const candidates = Array.isArray(raw)
      ? raw
      : field.multiple
        ? raw.split(",")
        : [raw];
    const values = candidates
      .map(pick)
      .filter((value): value is string => Boolean(value));
    if (values.length === 0) continue;
    out[field.key] = field.multiple ? values : values[0];
  }

  return out;
}

/**
 * A number the apps' phone validation accepts. WhatsApp hands us bare digits
 * with the country code; a leading + makes that unambiguous.
 */
export function formatPhone(phone: string | undefined): string | undefined {
  const trimmed = phone?.trim();
  if (!trimmed) return undefined;
  return /^\d{8,15}$/.test(trimmed) ? `+${trimmed}` : trimmed;
}

// ---------------------------------------------------------------------------
// Reading a result
// ---------------------------------------------------------------------------

export type AppEvent =
  | { kind: "ignore" }
  /** The app's forms changed, so the copy in `items` is stale. */
  | { kind: "catalogue" }
  | {
      kind: "result";
      ref: string | null;
      /** The customer's turn, as the agent and the transcript will read it. */
      text: string;
      /** Carried onto the platform event, for push and the workspace webhook. */
      data: Record<string, unknown>;
    };

/** Where a result's text stops, so a huge form cannot flood the history. */
const MAX_RESULT_CHARS = 3000;

/**
 * What one webhook delivery means here.
 *
 * The text is written as a bracketed notice rather than dressed up as prose,
 * because the model has to be able to tell it apart from something the
 * customer typed: it is their action, reported, not their words.
 */
export function interpretEvent(
  app: AppId,
  event: string,
  payload: unknown
): AppEvent {
  const envelope = asObject(payload);

  if (app === "magic_forms") {
    if (
      event === "form.published" ||
      event === "form.unpublished" ||
      event === "form.deleted"
    ) {
      return { kind: "catalogue" };
    }
    if (event !== "submission.created") return { kind: "ignore" };

    const data = asObject(envelope.data);
    const title = asString(data.formTitle) ?? "a form";
    const answers = asArray(data.answers)
      .map((answer) => {
        const a = asObject(answer);
        const label = asString(a.label) ?? asString(a.key);
        const value = asString(a.value);
        return label && value ? { label, value } : null;
      })
      .filter((a): a is { label: string; value: string } => a !== null);

    const text = [
      `[Form submitted on the page we sent: ${title}]`,
      ...answers.map((a) => `${a.label}: ${a.value}`),
    ]
      .join("\n")
      .slice(0, MAX_RESULT_CHARS);

    return {
      kind: "result",
      ref: asString(data.externalRef) ?? null,
      text,
      data: {
        form: { title, slug: asString(data.formSlug) ?? null },
        submissionId: asString(data.submissionId) ?? null,
        answers,
        viewUrl: asString(data.viewUrl) ?? null,
      },
    };
  }

  if (event !== "spin.completed") return { kind: "ignore" };

  const data = asObject(envelope.data);
  const registration = asObject(data.registration);
  const prize = asObject(data.prize);
  const offer = asObject(envelope.offer);
  const title = asString(offer.title) ?? "an offer";
  const label = asString(prize.label);
  const won = prize.isWin === true;

  const outcome = label
    ? won
      ? `won "${label}"`
      : `did not win this time ("${label}")`
    : "played it";

  return {
    kind: "result",
    ref: asString(registration.externalRef) ?? null,
    text: `[Played the offer we sent: ${title} — ${outcome}]`,
    data: {
      offer: { id: asString(offer.id) ?? null, title },
      prize: label ? { label, isWin: won } : null,
      won,
      registrationId: asString(registration.id) ?? null,
    },
  };
}
