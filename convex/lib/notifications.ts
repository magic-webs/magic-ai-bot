// Notifications — alerts sent on WhatsApp and email when something happens.
//
// The vocabulary, once. A *rule* says: when this event happens (a record is
// filed, an order comes in, an external system calls our URL), send this
// template to these people. A rule's parameters and recipients are text with
// `{{path}}` placeholders, filled from the event's own payload — the same JSON
// the workspace webhook receives — so "the customer's phone" is
// `{{record.person.phone}}` and nothing about a record book has to be known
// here in advance.
//
// WhatsApp only delivers *approved templates* to someone outside the 24-hour
// window, which is where nearly every alert lands, so the WhatsApp side sends
// nothing but templates synced from the panel. Email goes out through the
// platform's own mail account with templates the workspace writes itself.
//
// No Convex imports, so the queries can hand the app the same slots, previews
// and variable lists the sender uses.

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type NotificationEvent =
  | "record_filed"
  | "record_updated"
  | "record_stage_changed"
  | "order_created"
  | "escalation"
  | "inbound";

export type NotificationChannel = "whatsapp" | "email";

export type EventVariable = { path: string; label: string };

export type EventInfo = {
  value: NotificationEvent;
  label: string;
  hint: string;
  /** Record events can be narrowed to one book, and to one stage. */
  source: "record" | "platform" | "inbound";
  variables: EventVariable[];
  /** What "the customer" means for this event, as a recipient. */
  customerPhone?: string;
  customerEmail?: string;
};

const COMMON: EventVariable[] = [
  { path: "workspace.name", label: "Business name" },
  { path: "now", label: "Date and time" },
];

const CONTACT: EventVariable[] = [
  { path: "contact.name", label: "Contact name" },
  { path: "contact.whatsapp", label: "Contact WhatsApp" },
  { path: "contact.email", label: "Contact email" },
];

const RECORD: EventVariable[] = [
  { path: "record.reference", label: "Reference" },
  { path: "record.serialNumber", label: "Serial number" },
  { path: "record.stage", label: "Stage" },
  { path: "record.person.name", label: "Name" },
  { path: "record.person.phone", label: "Phone" },
  { path: "record.person.email", label: "Email" },
  { path: "record.person.company", label: "Company" },
  { path: "record.notes", label: "Notes" },
  { path: "record.filedBy", label: "Filed by" },
  { path: "book.name", label: "Book" },
];

const RECORD_PHONE = "{{record.person.phone | contact.whatsapp | contact.phone}}";
const RECORD_EMAIL = "{{record.person.email | contact.email}}";

export const NOTIFICATION_EVENTS: EventInfo[] = [
  {
    value: "record_filed",
    label: "Record filed",
    hint: "A new record was saved in a record book.",
    source: "record",
    variables: [...RECORD, ...CONTACT, ...COMMON],
    customerPhone: RECORD_PHONE,
    customerEmail: RECORD_EMAIL,
  },
  {
    value: "record_updated",
    label: "Record updated",
    hint: "Details on an existing record changed.",
    source: "record",
    variables: [...RECORD, ...CONTACT, ...COMMON],
    customerPhone: RECORD_PHONE,
    customerEmail: RECORD_EMAIL,
  },
  {
    value: "record_stage_changed",
    label: "Stage changed",
    hint: "A record moved to a different stage.",
    source: "record",
    variables: [
      ...RECORD,
      { path: "previousStage", label: "Previous stage" },
      ...CONTACT,
      ...COMMON,
    ],
    customerPhone: RECORD_PHONE,
    customerEmail: RECORD_EMAIL,
  },
  {
    value: "order_created",
    label: "New order",
    hint: "An agent took an order from the catalogue.",
    source: "platform",
    variables: [
      { path: "orderNumber", label: "Order number" },
      { path: "customer.name", label: "Customer name" },
      { path: "customer.phone", label: "Customer phone" },
      { path: "customer.email", label: "Customer email" },
      { path: "customer.company", label: "Company" },
      { path: "itemsSummary", label: "Items" },
      { path: "total", label: "Total" },
      { path: "currency", label: "Currency" },
      { path: "status", label: "Status" },
      { path: "notes", label: "Notes" },
      { path: "delivery.address", label: "Delivery address" },
      { path: "delivery.requiredDate", label: "Needed by" },
      ...CONTACT,
      ...COMMON,
    ],
    customerPhone: "{{customer.phone | contact.whatsapp}}",
    customerEmail: "{{customer.email | contact.email}}",
  },
  {
    value: "escalation",
    label: "Escalation",
    hint: "An agent handed a conversation to a person.",
    source: "platform",
    variables: [
      { path: "reason", label: "Reason" },
      { path: "department", label: "Department" },
      { path: "summary", label: "Summary" },
      { path: "agent", label: "Agent" },
      ...CONTACT,
      ...COMMON,
    ],
    customerPhone: "{{contact.whatsapp | contact.phone}}",
    customerEmail: "{{contact.email}}",
  },
  {
    value: "inbound",
    label: "Incoming webhook",
    hint: "Another system posts to this alert's own URL.",
    source: "inbound",
    variables: [...COMMON],
  },
];

export function eventInfo(event: NotificationEvent): EventInfo {
  return (
    NOTIFICATION_EVENTS.find((info) => info.value === event) ??
    NOTIFICATION_EVENTS[0]
  );
}

/** The event names `webhooks.deliver` sends that a rule can listen for. */
export function isNotificationEvent(event: string): event is NotificationEvent {
  return NOTIFICATION_EVENTS.some((info) => info.value === event);
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

type Json = Record<string, unknown>;

function lookup(context: unknown, path: string): unknown {
  let node: unknown = context;
  for (const part of path.split(".")) {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) {
      const index = Number(part);
      node = Number.isInteger(index) ? node[index] : undefined;
      continue;
    }
    if (typeof node !== "object") return undefined;
    node = (node as Json)[part];
  }
  return node;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(asText).filter(Boolean).join(", ");
  }
  // An object in a message is a mapping mistake, and "[object Object]" reads
  // worse than nothing — the log shows the empty value and why.
  return "";
}

/**
 * One placeholder's value: the first alternative that is not empty.
 *
 * `{{record.person.phone | contact.whatsapp}}` falls back from what the agent
 * collected to the number the customer wrote from, and `{{name | "there"}}`
 * falls back to a literal — which is what lets one rule serve a record where
 * the agent took a phone number and one where it did not.
 */
function resolve(expression: string, context: unknown): string {
  for (const raw of expression.split("|")) {
    const option = raw.trim();
    if (!option) continue;
    const quoted = /^"(.*)"$|^'(.*)'$/.exec(option);
    if (quoted) return quoted[1] ?? quoted[2] ?? "";
    const value = asText(lookup(context, option));
    if (value) return value;
  }
  return "";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Fills every `{{path}}` in `text` from `context`.
 *
 * `html` escapes the inserted values and never the template: the template is
 * the workspace's own markup, and the values are whatever a customer typed.
 */
export function renderText(
  text: string,
  context: unknown,
  options: { html?: boolean } = {}
): string {
  return text.replace(PLACEHOLDER, (_, expression: string) => {
    const value = resolve(expression, context);
    return options.html ? escapeHtml(value) : value;
  });
}

/** The paths a text refers to, first alternative of each, in order. */
export function placeholderPaths(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    for (const raw of match[1].split("|")) {
      const option = raw.trim();
      if (!option || /^["']/.test(option)) continue;
      if (!out.includes(option)) out.push(option);
    }
  }
  return out;
}

/**
 * Every leaf path in a payload, for the rule editor's variable list.
 *
 * Used on the last body an incoming webhook received, so mapping a field is
 * picking it from what the other system actually sent rather than guessing
 * at its shape.
 */
export function leafPaths(value: unknown, limit = 60): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (out.length >= limit || depth > 6) return;
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      // The first element stands for the rest — a list of line items is
      // mapped once, not per row.
      if (node.length > 0) walk(node[0], prefix ? `${prefix}.0` : "0", depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node as Json)) {
        walk(child, prefix ? `${prefix}.${key}` : key, depth + 1);
        if (out.length >= limit) return;
      }
      return;
    }
    if (prefix) out.push(prefix);
  };
  walk(value, "", 0);
  return out;
}

/**
 * A body cut down to what mapping needs, for one too large to keep whole:
 * every list to its first item, which is all `leafPaths` reads, and every long
 * text to its start. The shape — and so every path — survives.
 */
export function trimSample(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (Array.isArray(value)) return value.length > 0 ? [trimSample(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json).map(([key, child]) => [key, trimSample(child, depth + 1)])
    );
  }
  return value;
}

/** Writes `value` at a dotted path, for building a context from pairs. */
export function setPath(target: Json, path: string, value: string): void {
  const parts = path.split(".").filter(Boolean);
  let node: Json = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      node[part] = value;
      return;
    }
    const next = node[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      node[part] = {};
    }
    node = node[part] as Json;
  });
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/**
 * A number the way the Cloud API wants it: digits only, country code first.
 *
 * People type numbers every way there is — "+91 98765 43210", "098765 43210",
 * "9876543210". A number short enough to be missing its country code gets the
 * workspace's default one, since guessing the country from ten digits is not
 * possible and sending to the wrong one is worse than not sending.
 */
export function normalisePhone(
  raw: string,
  defaultCountryCode?: string
): string | null {
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1).replace(/\D/g, "");
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else {
    digits = digits.replace(/\D/g, "");
    const code = defaultCountryCode?.replace(/\D/g, "");
    // "098765 43210" is a local number with its trunk prefix, not an
    // eleven-digit international one.
    const local = digits.replace(/^0+/, "");
    if (code && local.length <= 10) digits = `${code}${local}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

/**
 * The addresses one rule sends to for one event: each entry rendered, split on
 * commas (a field can hold several), normalised and de-duplicated. What could
 * not be read as an address is returned too, so the log can say why a
 * recipient was skipped instead of silently sending to fewer people.
 */
export function resolveRecipients(
  entries: string[],
  channel: NotificationChannel,
  context: unknown,
  defaultCountryCode?: string
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const rendered = renderText(entry, context);
    for (const piece of rendered.split(/[,;\n]/)) {
      const candidate = piece.trim();
      if (!candidate) continue;
      const address =
        channel === "whatsapp"
          ? normalisePhone(candidate, defaultCountryCode)
          : normaliseEmail(candidate);
      if (!address) invalid.push(candidate);
      else if (!valid.includes(address)) valid.push(address);
    }
  }
  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// WhatsApp templates
// ---------------------------------------------------------------------------

/** One blank a template send has to fill. */
export type TemplateSlot = {
  /** "header:1", "header:media", "body:1", "body:first_name", "button:0". */
  key: string;
  label: string;
  /** What Meta was shown when the template was approved. */
  example?: string;
};

export type ParsedButton = {
  index: number;
  type: string;
  text: string;
  /** URL buttons with a `{{1}}` suffix, copy-code and one-time-code buttons. */
  takesValue: boolean;
  url?: string;
};

export type ParsedTemplate = {
  header?: {
    format: string;
    text?: string;
    variables: string[];
  };
  body?: { text: string; variables: string[] };
  footer?: string;
  buttons: ParsedButton[];
  slots: TemplateSlot[];
  /** Why this cannot be sent from an alert, when it cannot. */
  unsupported?: string;
};

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function variablesIn(text: string | undefined): string[] {
  const out: string[] = [];
  for (const match of (text ?? "").matchAll(VARIABLE)) {
    if (!out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

function exampleFor(
  component: Json,
  kind: "header" | "body",
  variable: string,
  position: number
): string | undefined {
  const example = component.example as Json | undefined;
  if (!example) return undefined;
  if (kind === "header") {
    const named = example.header_text_named_params as
      | Array<{ param_name?: string; example?: string }>
      | undefined;
    const hit = named?.find((item) => item.param_name === variable)?.example;
    if (hit) return hit;
    const list = example.header_text as string[] | undefined;
    return list?.[position];
  }
  const named = example.body_text_named_params as
    | Array<{ param_name?: string; example?: string }>
    | undefined;
  const hit = named?.find((item) => item.param_name === variable)?.example;
  if (hit) return hit;
  const rows = example.body_text as string[][] | undefined;
  return rows?.[0]?.[position];
}

const UNSUPPORTED: Record<string, string> = {
  CAROUSEL: "Carousel templates need an image per card.",
  LIMITED_TIME_OFFER: "Limited-time offers need an expiry per send.",
};

/**
 * Reads a template's components, as the panel returns them, into what a send
 * has to fill in.
 *
 * Numbered (`{{1}}`) and named (`{{first_name}}`) variables are both read,
 * since Meta approves both and a workspace will have a mix.
 */
export function parseTemplate(components: unknown): ParsedTemplate {
  const parsed: ParsedTemplate = { buttons: [], slots: [] };
  const list = Array.isArray(components) ? (components as Json[]) : [];

  for (const component of list) {
    const type = String(component.type ?? "").toUpperCase();

    if (type === "HEADER") {
      const format = String(component.format ?? "TEXT").toUpperCase();
      const text = typeof component.text === "string" ? component.text : undefined;
      const variables = format === "TEXT" ? variablesIn(text) : [];
      parsed.header = { format, text, variables };
      if (format === "TEXT") {
        variables.forEach((variable, position) =>
          parsed.slots.push({
            key: `header:${variable}`,
            label: `Header {{${variable}}}`,
            example: exampleFor(component, "header", variable, position),
          })
        );
      } else if (format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT") {
        const handle = (component.example as Json | undefined)?.header_handle as
          | string[]
          | undefined;
        parsed.slots.push({
          key: "header:media",
          label: `${format[0]}${format.slice(1).toLowerCase()} link`,
          example: handle?.[0],
        });
      } else if (format === "LOCATION") {
        parsed.unsupported = "Location headers need coordinates per send.";
      }
      continue;
    }

    if (type === "BODY") {
      const text = String(component.text ?? "");
      const variables = variablesIn(text);
      parsed.body = { text, variables };
      variables.forEach((variable, position) =>
        parsed.slots.push({
          key: `body:${variable}`,
          label: `{{${variable}}}`,
          example: exampleFor(component, "body", variable, position),
        })
      );
      continue;
    }

    if (type === "FOOTER") {
      parsed.footer = String(component.text ?? "");
      continue;
    }

    if (type === "BUTTONS") {
      const buttons = Array.isArray(component.buttons)
        ? (component.buttons as Json[])
        : [];
      buttons.forEach((button, index) => {
        const kind = String(button.type ?? "").toUpperCase();
        const url = typeof button.url === "string" ? button.url : undefined;
        const takesValue =
          (kind === "URL" && variablesIn(url).length > 0) ||
          kind === "COPY_CODE" ||
          kind === "OTP";
        const text = String(button.text ?? (kind === "COPY_CODE" ? "Copy code" : kind));
        parsed.buttons.push({ index, type: kind, text, takesValue, url });
        if (takesValue) {
          const example = Array.isArray(button.example)
            ? String(button.example[0] ?? "")
            : typeof button.example === "string"
              ? button.example
              : undefined;
          parsed.slots.push({
            key: `button:${index}`,
            label:
              kind === "URL"
                ? `Link ending (${text})`
                : kind === "OTP"
                  ? "One-time code"
                  : `Code (${text})`,
            example: example || undefined,
          });
        }
        if (kind === "CATALOG" || kind === "MPM") {
          parsed.unsupported = "Catalogue buttons need products per send.";
        }
      });
      continue;
    }

    if (UNSUPPORTED[type]) parsed.unsupported = UNSUPPORTED[type];
  }

  return parsed;
}

/**
 * Meta rejects a text parameter holding a newline, a tab or a run of spaces,
 * and rejects an empty one — either way the whole send fails.
 */
function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim() || "-";
}

const isNamed = (variable: string) => !/^\d+$/.test(variable);

/**
 * The `components` of a template send, from the parsed template and one value
 * per slot. The shapes are the collection's "Interactive Template" requests.
 */
export function templateComponents(
  parsed: ParsedTemplate,
  values: Record<string, string>
): Json[] {
  const components: Json[] = [];
  const text = (variable: string, value: string) => ({
    type: "text",
    text: clean(value),
    ...(isNamed(variable) ? { parameter_name: variable } : {}),
  });

  if (parsed.header?.format === "TEXT" && parsed.header.variables.length) {
    components.push({
      type: "header",
      parameters: parsed.header.variables.map((variable) =>
        text(variable, values[`header:${variable}`] ?? "")
      ),
    });
  } else if (parsed.header && ["IMAGE", "VIDEO", "DOCUMENT"].includes(parsed.header.format)) {
    const media = parsed.header.format.toLowerCase();
    const link = (values["header:media"] ?? "").trim();
    if (link) {
      components.push({
        type: "header",
        parameters: [
          {
            type: media,
            [media]:
              media === "document" ? { link, filename: "Document" } : { link },
          },
        ],
      });
    }
  }

  if (parsed.body?.variables.length) {
    components.push({
      type: "body",
      parameters: parsed.body.variables.map((variable) =>
        text(variable, values[`body:${variable}`] ?? "")
      ),
    });
  }

  for (const button of parsed.buttons) {
    if (!button.takesValue) continue;
    const value = (values[`button:${button.index}`] ?? "").trim() || "-";
    if (button.type === "COPY_CODE") {
      components.push({
        type: "button",
        sub_type: "copy_code",
        index: button.index,
        parameters: [{ type: "coupon_code", coupon_code: value }],
      });
    } else {
      // URL suffixes and one-time codes both travel as a url button's text.
      components.push({
        type: "button",
        sub_type: "url",
        index: button.index,
        parameters: [{ type: "text", text: value }],
      });
    }
  }

  return components;
}

/** What the recipient reads, for the log and the conversation thread. */
export function templatePreview(
  parsed: ParsedTemplate,
  values: Record<string, string>
): string {
  // Cleaned the way the send cleans it, so the preview is what arrived.
  const fill = (source: string | undefined, prefix: "header" | "body") =>
    (source ?? "").replace(VARIABLE, (_, variable: string) =>
      clean(values[`${prefix}:${variable}`] ?? "")
    );
  return [
    parsed.header?.format === "TEXT" ? fill(parsed.header.text, "header") : "",
    fill(parsed.body?.text, "body"),
    parsed.footer ?? "",
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** A template request body, envelope and all. */
export function templateMessage(
  to: string,
  template: { name: string; language: string },
  components: Json[]
): Json {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { policy: "deterministic", code: template.language },
      components,
    },
  };
}

/** Meta's category, as the billing ledger spells it. */
export function billingCategory(
  category: string | undefined
): "marketing" | "utility" | "authentication" {
  const value = (category ?? "").toLowerCase();
  if (value === "marketing" || value === "authentication") return value;
  return "utility";
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export const PLATFORM_EMAIL_DEFAULTS = {
  url: "https://cpaas.zoho.in/v1.1/email",
  fromEmail: "notifications@magicwebs.ai",
  fromName: "Magic Agent",
} as const;

export type PlatformEmail = {
  token: string;
  url: string;
  fromEmail: string;
  fromName: string;
};

export function platformFrom(): Pick<PlatformEmail, "fromEmail" | "fromName"> {
  return {
    fromEmail:
      process.env.ZEPTOMAIL_FROM_EMAIL?.trim() || PLATFORM_EMAIL_DEFAULTS.fromEmail,
    fromName:
      process.env.ZEPTOMAIL_FROM_NAME?.trim() || PLATFORM_EMAIL_DEFAULTS.fromName,
  };
}

export function platformEmail(): PlatformEmail | null {
  const token = process.env.ZEPTOMAIL_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    url: process.env.ZEPTOMAIL_URL?.trim() || PLATFORM_EMAIL_DEFAULTS.url,
    ...platformFrom(),
  };
}

export function senderName(
  workspaceName: string | undefined,
  savedName: string | undefined,
  platformName: string
): string {
  const name = savedName?.trim() || workspaceName?.trim();
  return name ? `${name} via ${platformName}` : platformName;
}

/**
 * The header ZeptoMail wants. People paste the token both with and without
 * the scheme the console shows it under, so either is accepted.
 */
export function zeptoAuthorization(token: string): string {
  const trimmed = token.trim();
  return /^zoho-enczapikey\s/i.test(trimmed)
    ? trimmed
    : `Zoho-enczapikey ${trimmed}`;
}

/** Plain text read as HTML, for a text template sent to a mail client. */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

/** The body as text, for the log preview. Crude, and only ever read by people. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/h\d|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

type BookShape = {
  name: string;
  pluralName: string;
  handle: string;
  referencePrefix: string;
  stages: string[];
  fields: Array<{ key: string; label: string; example?: string }>;
};

/**
 * A payload shaped like the real one, for "Send a test". Built from the book's
 * own fields, so a test of a membership alert reads like a membership.
 */
export function sampleData(
  event: NotificationEvent,
  book: BookShape | null,
  lastInbound: unknown
): Json {
  const person = {
    name: "Test Person",
    phone: "+910000000000",
    email: "test@example.com",
    company: "Example Ltd",
  };
  const contact = { name: "Test Person", whatsapp: "910000000000", email: "test@example.com" };

  if (event === "inbound") {
    return lastInbound && typeof lastInbound === "object"
      ? (lastInbound as Json)
      : { name: "Test Person", phone: "+910000000000", message: "Test" };
  }

  if (event === "order_created") {
    return {
      orderNumber: "ORD-TEST01",
      customer: person,
      itemsSummary: "2 × Example product",
      total: 1000,
      currency: "INR",
      status: "new",
      notes: "This is a test.",
      delivery: { address: "1 Example Street", requiredDate: "Tomorrow" },
      contact,
    };
  }

  if (event === "escalation") {
    return {
      reason: "The customer asked for a person.",
      department: "sales",
      summary: "Wants a quote for a bulk order.",
      agent: "Front desk",
      contact: { ...contact, phone: person.phone },
    };
  }

  const shape: BookShape = book ?? {
    name: "Record",
    pluralName: "Records",
    handle: "record",
    referencePrefix: "REC",
    stages: [],
    fields: [],
  };
  return {
    book: { name: shape.name, plural: shape.pluralName, handle: shape.handle },
    record: {
      id: "test",
      reference: `${shape.referencePrefix}-TEST01`,
      serialNumber: 1,
      stage: shape.stages[1] ?? shape.stages[0] ?? null,
      person,
      details: Object.fromEntries(
        shape.fields.map((field) => [
          field.key,
          field.example || `Example ${field.label.toLowerCase()}`,
        ])
      ),
      notes: "This is a test.",
      source: "manual",
      filedBy: "Front desk",
    },
    ...(event === "record_stage_changed"
      ? { previousStage: shape.stages[0] ?? "Enquired" }
      : {}),
    contact,
  };
}
