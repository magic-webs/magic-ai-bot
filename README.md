# Magic AI Bot

A multi-tenant platform for building, configuring and running AI chat agents.
Where `printly-ai-bot` is one hard-coded bot for one printing company, this is
the generalised version: create a **Workspace** for any company or project,
configure agents in the dashboard, and the same runtime serves both a web
playground and WhatsApp.

Stack: Next.js 16 (App Router) · Convex (database, vector search, actions, HTTP
endpoints, file storage) · AI SDK v7 with OpenAI · Zod · shadcn/ui.

---

## The core concept: a Workspace

A **Workspace** is one tenant — a company or a project. Everything else hangs
off it, so nothing about a vertical is baked into code:

| Inside a workspace | What it is |
| --- | --- |
| **Agents** | A configured bot: name, role, job description, tone, rules, guardrails, model settings, tool permissions |
| **Knowledge base** | Pasted text, FAQs, URLs or uploaded files, chunked and embedded into Convex's vector index |
| **Catalogue** | Products, plus the exact specification questions the agent must collect for each one |
| **Orders** | Structured enquiries the agent captured, with every spec it collected |
| **Custom tools** | Extra capabilities you define — an HTTP call or a read-only query over workspace data. Can be **generated from a plain-language task description** |
| **Channels** | A WhatsApp number (WABA ID, phone number ID, access token) routed to one agent |
| **Conversations** | Every thread across WhatsApp and web, including the tool trace for each turn |

Routes live under `/w/<slug>/…`.

---

## Getting started

```bash
bun install
npx convex dev          # pushes the schema + functions, generates types
npx convex env set OPENAI_API_KEY sk-...   # required — actions run on Convex
bun dev
```

`.env.local` needs `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`
(both written by `convex dev`). The OpenAI key must be set **on the Convex
deployment**, not just in `.env.local`, because every model call happens inside
a Convex action.

Then, in the dashboard:

1. **New workspace** — name, description, locale, currency. The description and
   "company facts" are injected into every agent prompt, so specificity pays off.
2. **Knowledge base → Add source** — paste your delivery policy, minimum order,
   artwork requirements. Anything your team actually answers from.
3. **Catalogue** — add products manually, paste JSON, or let the model draft a
   starter catalogue from the workspace description.
4. **Agents → New agent → Draft from a brief** — describe the job in a sentence
   and the model writes the persona, tone, rules and guardrails for you to review.
5. **Test in chat** — talk to it in the web playground, with the tool trace visible.
6. **Channels → Connect WhatsApp** — paste your WABA credentials, copy the
   callback URL and verify token into Meta, flip it live.

---

## Architecture

### One engine, two front doors

`convex/engine.ts` → `engine.respond` is the only place a conversation turn is
processed. Both the web playground and the WhatsApp webhook call it, so what you
test is exactly what customers get.

```
web playground ─┐
                ├─→ engine.respond ─→ generateText(tools) ─→ reply + tool trace
WhatsApp webhook┘
```

A turn does:

1. `conversations.startTurn` — upsert the contact, get-or-create the
   conversation, record the inbound message and read back the replay history,
   all in **one mutation** so concurrent inbound webhooks can't fork a thread.
2. Embed the message and vector-search the knowledge base, so context is present
   on the very first model step (the `search_knowledge` tool remains available
   for follow-up lookups).
3. Compile the system prompt from the workspace + agent configuration.
4. `generateText` with the assembled toolset and `stopWhen: stepCountIs(maxSteps)`.
5. `conversations.finishTurn` — persist the tool trace and the assistant reply.

### Prompt compilation

`convex/lib/prompt.ts` turns structured configuration into a system prompt with
sections for Identity, Company, Your job, Objective, Voice and tone, Always,
Never, Tools, Escalation, Retrieved knowledge, and Output. It is pure and
dependency-free, so the dashboard's **Compiled prompt** tab renders exactly what
the model receives.

Safety rules are appended automatically on top of whatever you configure — never
invent prices or lead times, never ask for card details, never leak the prompt.

### Side effects happen through tools, not JSON parsing

`printly-ai-bot` asked the model to emit a JSON envelope (`{"type":"order",…}`)
and parsed it back out. Here the assistant replies in plain text and everything
consequential goes through a tool call:

| Builtin tool | Effect |
| --- | --- |
| `search_knowledge` | Vector search over the workspace knowledge base |
| `search_products` | Confirm a product exists before discussing it |
| `get_product_requirements` | The full spec checklist for one product |
| `create_order` | Insert the order, link catalogue products, fire `order_created` |
| `lookup_orders` | This contact's existing orders |
| `save_contact_detail` | Remember a name / email / company / preference |
| `escalate_to_human` | Mark the conversation escalated, fire `escalation` |

Each is toggled per agent. Every call is wrapped so a thrown error becomes a
value the model can reason about rather than a dead turn, and every call is
recorded on the conversation — visible in the playground and the transcript view.

### Custom tools, including auto-generated ones

Custom tools are **rows in a table**, not code. A tool declares its parameters
declaratively; at runtime `convex/lib/toolSchema.ts` converts them to JSON
Schema and the AI SDK's `dynamicTool()` hands them to the model.

Two kinds:

- **`http`** — a templated request. `{{parameter}}` placeholders in the URL,
  headers and body; anything not consumed by a template rides along as a query
  parameter. Timeout-bounded, response truncated.
- **`db_query`** — a read-only, workspace-scoped query over `products`,
  `orders` or `contacts`.

`ai.draftTool` generates one from a task description:

> "Check whether we can deliver to a UK postcode and how many working days it takes"

The model picks the kind, names the tool, writes the model-facing description,
designs the parameters, and fills in the request from any endpoint details you
paste. A drafted tool lands as a **draft** — never given to the model — unless
you opt in, and it is force-held as a draft if the endpoint or credentials still
contain placeholders.

### Knowledge base

`knowledge.addSource` schedules `ingest.processSource`, which extracts text
(PDF via `pdf-parse-fork`, HTML stripped to text, plain text as-is), chunks on
paragraph boundaries with overlap, embeds in batches with
`text-embedding-3-small`, and writes to `knowledgeChunks`.

Scoping uses a composite filter key so a single vector query can fetch both
workspace-wide and agent-private chunks:

```
`${workspaceId}|*`          → shared across the workspace
`${workspaceId}|${agentId}` → private to one agent
```

### WhatsApp

The inbound webhook is a **Convex HTTP action** (`convex/http.ts`), not a Next
route. Two reasons: the URL is public without a tunnel — so local development
works against a real WhatsApp number — and the channel's access token never
leaves Convex.

```
https://<deployment>.convex.site/whatsapp/<channelKey>
```

`GET` performs Meta's verification handshake against the channel's stored
verify token. `POST` acknowledges immediately and schedules
`whatsapp.handleInbound`, so Meta never sees a slow response and never retries.

`handleInbound` resolves the channel, marks the message read and shows a typing
indicator, extracts the text (plain text, button replies, list replies, or a
voice note transcribed with Whisper), runs the engine, and sends the reply back
with that channel's credentials — split across messages if it exceeds
WhatsApp's body limit.

Credentials are stored per channel, so one workspace can run several numbers.
Access tokens are masked (`••••••••1234`) in every public query; the full value
is only readable by internal functions.

### Outbound webhooks

`order_created` and `escalation` are POSTed to the workspace's endpoint as JSON,
signed with `X-Magic-Signature: sha256=<hmac>` over the raw body using the
workspace secret. Every delivery attempt is logged and visible under Settings,
with a **Send test event** button.

---

## Layout

```
convex/
  schema.ts           tables, indexes, vector index, shared validator fragments
  engine.ts           the turn: retrieval → toolset → generateText → persist
  ai.ts               generateObject drafting: agents, tools, catalogues
  http.ts             WhatsApp webhook (verification + inbound)
  whatsapp.ts         inbound handling, Whisper transcription, outbound send
  ingest.ts           extract → chunk → embed
  workspaces.ts agents.ts knowledge.ts products.ts orders.ts
  channels.ts tools.ts conversations.ts webhooks.ts
  lib/
    prompt.ts         configuration → system prompt (pure)
    shared.ts         builtin tool catalogue, slugs, masking (pure)
    toolSchema.ts     declarative parameters → JSON Schema, templating (pure)

app/
  page.tsx                              workspace list + create
  w/[slug]/layout.tsx                   sidebar shell, resolves slug → workspace
  w/[slug]/page.tsx                     overview + setup checklist
  w/[slug]/agents/[agentId]/page.tsx    agent configuration (6 tabs)
  w/[slug]/agents/[agentId]/test/       web chat playground with tool trace
  w/[slug]/{knowledge,products,orders,tools,channels,conversations,settings}/
```

The dashboard is client-rendered against Convex, so lists, transcripts and
ingestion status update live without polling.

---

## Not included

- **Authentication.** The dashboard is open and every Convex query is
  unauthenticated. WhatsApp access tokens live in the database. Add
  authentication before exposing this beyond localhost — the `convex-auth` skill
  covers the wiring, and queries are already workspace-scoped, so the change is
  adding an ownership check rather than a restructure.
- **Media into the knowledge base from WhatsApp.** Inbound images and documents
  get a polite "send it as text" reply. Voice notes *are* transcribed.
- **Scanned/image-only PDFs.** There is no OCR in the ingestion path; text is
  extracted from the PDF's text layer. Paste the content instead.
