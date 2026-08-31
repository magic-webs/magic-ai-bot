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
  | "transfer_to_agent";

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
    key: "transfer_to_agent",
    label: "Transfer to another agent",
    summary: "Hand the conversation to a colleague agent in this workspace.",
    description:
      "Hand this conversation to another AI colleague who is better suited to it. The customer never sees the transfer — the colleague answers the current message directly. Only ever transfer to one of the agents named in your team roster.",
  },
];

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

export const CHAT_MODELS = [
  { id: "gpt-4.1-mini", label: "gpt-4.1-mini — fast, cheap, tool-capable" },
  { id: "gpt-4.1", label: "gpt-4.1 — strongest instruction following" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini — legacy cheap default" },
  { id: "gpt-4o", label: "gpt-4o — legacy flagship" },
] as const;

// Must stay in step with the `dimensions` on the knowledgeChunks vector index.
export const EMBEDDING_MODEL = "text-embedding-3-small";

// The most an anonymous website visitor may send in one message. Generous for a
// chat box, small enough that nobody can bill a workspace for an essay.
export const MAX_WIDGET_MESSAGE_CHARS = 2000;
