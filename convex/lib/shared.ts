// Pure helpers shared between Convex functions and the dashboard UI.
// No Convex imports here so this module is safe to import from React.

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// URL-safe random id used for public channel webhook paths and verify tokens.
export function randomKey(length = 24): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

export function buildSearchBlob(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function maskSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  if (secret.length <= 4) return "••••";
  return `••••••••${secret.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Builtin tool catalogue. The agent row stores the enabled keys; the runtime
// materialises the implementations. Kept here so the dashboard can render the
// same list of labels and descriptions the model sees.
// ---------------------------------------------------------------------------

export type BuiltinToolKey =
  | "search_knowledge"
  | "search_products"
  | "get_product_requirements"
  | "create_order"
  | "lookup_orders"
  | "save_contact_detail"
  | "escalate_to_human"
  | "transfer_to_agent"
  | "rich_messages";

export const BUILTIN_TOOLS: Array<{
  key: BuiltinToolKey;
  label: string;
  summary: string;
  // Model-facing description
  description: string;
  needs?: "knowledge" | "products";
}> = [
  {
    key: "search_knowledge",
    label: "Search knowledge base",
    summary: "Semantic search over the workspace knowledge base.",
    description:
      "Search the company knowledge base for policies, guidelines, specifications and FAQs. Call this whenever the customer asks something that company documentation would answer, instead of guessing.",
    needs: "knowledge",
  },
  {
    key: "search_products",
    label: "Search catalogue",
    summary: "Find products in the workspace catalogue by name or keyword.",
    description:
      "Search the product catalogue by name, category or keyword. Use it to confirm a product actually exists before discussing it, and to find the closest match to what the customer described.",
    needs: "products",
  },
  {
    key: "get_product_requirements",
    label: "Get product requirements",
    summary: "Return the exact spec questions to ask for one product.",
    description:
      "Get the full specification checklist for one product: every field you must collect before an order can be created, with examples. Call this as soon as you know which product the customer wants.",
    needs: "products",
  },
  {
    key: "create_order",
    label: "Create order",
    summary: "Persist a completed order/enquiry and fire the order webhook.",
    description:
      "Create the order once you have collected every required detail and the customer has confirmed. This records the order and notifies the team. Never call it with placeholder or invented values.",
  },
  {
    key: "lookup_orders",
    label: "Look up orders",
    summary: "Fetch this contact's existing orders.",
    description:
      "Look up the orders already placed by the person you are talking to, optionally by order number. Use it for 'where is my order' style questions.",
  },
  {
    key: "save_contact_detail",
    label: "Save contact detail",
    summary: "Remember a fact about the contact (name, email, company…).",
    description:
      "Save a detail you learned about the customer, such as their name, email address, company or a stated preference, so it is remembered in future conversations.",
  },
  {
    key: "escalate_to_human",
    label: "Escalate to human",
    summary: "Hand the conversation to a human team and fire the webhook.",
    description:
      "Hand the conversation to a human when the customer asks for a person, makes a complaint, or needs something you cannot do. This notifies the team and marks the conversation as escalated.",
  },
  {
    key: "rich_messages",
    label: "Rich messages",
    summary:
      "Quick-reply buttons, option lists, media, pins and contact cards, on WhatsApp and web chat.",
    description:
      "Send a message that is more than text: up to three tappable quick-reply buttons, a scrollable list of options, an image, video or document with a caption, a link button, a location pin, a request for the customer's location or delivery address, or a saveable contact card. Prefer buttons or a list over asking the customer to type one of a short set of choices. Works the same on WhatsApp and in the website chat.",
  },
  {
    key: "transfer_to_agent",
    label: "Transfer to another agent",
    summary: "Hand the conversation to a colleague agent in this workspace.",
    description:
      "Hand this conversation to another AI colleague who is better suited to it. The customer never sees the transfer — the colleague answers the current message directly. Only ever transfer to one of the agents named in your team roster.",
  },
];

/**
 * What the single `rich_messages` toggle actually hands the model.
 *
 * One switch rather than eight, because a workspace decides whether its bot may
 * send rich WhatsApp messages at all, not which seven of them. Named here so
 * the Compiled prompt tab can show the real tool list instead of the toggle's
 * own key — that tab's whole claim is that it is what the model receives.
 */
export const RICH_TOOL_NAMES = [
  "send_buttons",
  "send_list",
  "send_media",
  "send_link_button",
  "request_location",
  "request_address",
  "send_location",
  "send_contact_card",
] as const;

export const DEFAULT_BUILTIN_TOOLS: BuiltinToolKey[] = [
  "search_knowledge",
  "search_products",
  "get_product_requirements",
  "create_order",
  "save_contact_detail",
  "escalate_to_human",
  "transfer_to_agent",
];

// ---------------------------------------------------------------------------
// The default bot. Every workspace gets exactly one router agent: it owns the
// front of every conversation, works out what the customer actually wants, and
// hands the turn to the specialist that should answer it. Specialists can hand
// off to each other the same way, so the routing decision is never final.
// ---------------------------------------------------------------------------

export const ROUTER_TOOLS: BuiltinToolKey[] = [
  "transfer_to_agent",
  "search_knowledge",
  "save_contact_detail",
  "escalate_to_human",
];

// How many times one inbound message may be handed on before the engine stops
// and makes whoever is holding it answer.
//
// One, deliberately. A second hop in the same message is nearly always a
// specialist second-guessing a correct routing decision rather than fixing a
// wrong one, and it doubles the latency and the token cost of a single reply.
// An agent that really has the wrong conversation hands it on when the customer
// writes again, which is the case that matters.
export const MAX_HANDOFFS_PER_TURN = 1;

export const ROUTER_DEFAULTS = {
  name: "Front desk",
  role: "Front desk assistant",
  objective:
    "Work out what the customer needs in as few questions as possible, then hand the conversation to the colleague who can actually deal with it.",
  jobDescription: [
    "You are the first bot every new conversation reaches.",
    "Greet the customer once, briefly, and find out what they are here for.",
    "As soon as you can tell which colleague on your team should deal with it, transfer the conversation to them — do not try to answer specialist questions yourself.",
    "If the request is a simple factual one that the knowledge base answers outright, answer it yourself rather than transferring.",
    "If nobody on the team fits, keep helping as best you can and escalate to a human if the customer needs one.",
  ].join(" "),
  rules: [
    "Ask at most one short question before deciding where the conversation belongs.",
    "Transfer as soon as the right colleague is obvious — a fast handover beats a thorough interrogation.",
  ],
  guardrails: [
    "Never quote prices, lead times or stock — that is a specialist's job.",
    "Never tell the customer they are being transferred, put on hold, or passed around. The handover is silent and instant.",
  ],
  escalationPolicy:
    "Escalate to a human if the customer asks for a person, is complaining, or no colleague on the team covers what they need.",
} as const;

/** The model a new agent and every front desk is created with. */
export const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4-flash";

/**
 * What the model picker offers. Ids are the Vercel AI Gateway's
 * `creator/model` form, which is what convex/lib/gateway.ts sends.
 *
 * An agent saved before the gateway holds a bare id like `gpt-4.1-mini`; that
 * still runs, qualified to `openai/…` at the call, so this list does not have
 * to carry history.
 */
export const CHAT_MODELS = [
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash — fast, tool-capable, cheapest",
  },
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro — stronger reasoning, dearer",
  },
  {
    id: "openai/gpt-4.1-mini",
    label: "gpt-4.1-mini — the previous default",
  },
  {
    id: "openai/gpt-4.1",
    label: "gpt-4.1 — strongest instruction following",
  },
] as const;

// The most an anonymous website visitor may send in one message. Generous for a
// chat box, small enough that nobody can bill a workspace for an essay.
export const MAX_WIDGET_MESSAGE_CHARS = 2000;

// ---------------------------------------------------------------------------
// The lead pipeline.
//
// Every workspace starts with these and can rename, reorder, extend or delete
// them. The descriptions are model-facing: the follow-up desk files a
// conversation by matching it against them, so they are written as tests a
// reader could apply, not as labels.
//
// Deliberately generic. The same seven have to make sense to a printer, a
// property developer, an influencer marketplace and a clothing store, so they
// describe how far a conversation has got rather than what was discussed.
// ---------------------------------------------------------------------------

export type LeadStageSeed = {
  name: string;
  description: string;
  outcome: "open" | "won" | "lost";
};

export const DEFAULT_LEAD_STAGES: LeadStageSeed[] = [
  {
    name: "New enquiry",
    description:
      "They have made contact but not said enough to work with yet — a greeting, a one-line question, or a request you have not been able to pin down.",
    outcome: "open",
  },
  {
    name: "Qualified",
    description:
      "You know what they want and that it is something this company offers. Quantities, sizes, dates or scope may still be open, but the need is clear.",
    outcome: "open",
  },
  {
    name: "Details collected",
    description:
      "Everything needed to price or fulfil the request has been collected, and the only thing left is the price, a proposal, or a decision.",
    outcome: "open",
  },
  {
    name: "Quoted",
    description:
      "A price, an estimate or a proposal has been given to them, or the team has been asked to send one, and you are waiting on their answer.",
    outcome: "open",
  },
  {
    name: "Negotiating",
    description:
      "They have engaged with the price or the terms — asking for a discount, comparing options, or pushing on timing — and are not yet committed.",
    outcome: "open",
  },
  {
    name: "Won",
    description:
      "They committed: an order was recorded, a booking made, or they said plainly that they are going ahead.",
    outcome: "won",
  },
  {
    name: "Lost",
    description:
      "They said no, bought elsewhere, or wanted something this company does not do. Also where a lead lands once it has gone quiet and stopped answering follow-ups.",
    outcome: "lost",
  },
];

// ---------------------------------------------------------------------------
// The follow-up desk. One per workspace, alongside the front desk.
//
// It never takes a live turn. It reads conversations that have gone quiet,
// files them at a stage, and writes the nudge when one is worth sending — so
// its configuration is about judgement and voice, not about routing or tools.
// ---------------------------------------------------------------------------

/** How long a conversation must be silent before the desk reads it. */
export const DORMANT_AFTER_MINUTES = 60;

/**
 * Nudges per conversation, ever. Two is the whole budget: the first catches
 * someone who got distracted, the second catches someone who meant to reply.
 * A third is not a follow-up, it is pestering, and it is how a number gets
 * blocked.
 */
export const MAX_FOLLOW_UPS = 2;

/**
 * WhatsApp only allows a free-form message within 24 hours of the customer's
 * last one; after that it has to be an approved template. The desk therefore
 * will not write to a WhatsApp thread older than this, and says so in the
 * review rather than sending something the provider would reject.
 */
export const WHATSAPP_FREE_FORM_WINDOW_HOURS = 24;

export const FOLLOW_UP_DEFAULTS = {
  name: "Follow-up desk",
  role: "Follow-up desk",
  objective:
    "Read conversations that have gone quiet, file each one at the stage it has actually reached, and win back the ones worth winning back with a single well-judged message.",
  jobDescription: [
    "You are not part of the conversation. You read it after it has stopped and decide two things.",
    "First, which stage it belongs at, judged against the stage descriptions you are given and nothing else.",
    "Second, whether a follow-up message is worth sending, and if so what it should say.",
    "A follow-up is worth sending when the customer was mid-way through something and simply stopped — a question you asked went unanswered, details were half collected, a quote was sent and never acknowledged.",
    "It is not worth sending when they got what they came for, when they said no, when they are waiting on the team rather than the other way round, or when you have nothing new to offer them.",
  ].join(" "),
  rules: [
    "Pick the furthest stage the conversation actually reached, not the one you hope it reaches.",
    "Write a follow-up as one short message that moves things forward by naming the specific thing that was left open.",
    "Reference what they actually said, so it reads as a continuation and not a broadcast.",
  ],
  guardrails: [
    "Never send a second message in the same breath as the first — one message, and then wait.",
    "Never invent a discount, an offer, a deadline or a stock position to create urgency.",
    "Never imply the customer was rude or slow for not replying.",
    "Never follow up a conversation that ended with a complaint or an escalation; those belong to a person.",
  ],
} as const;
