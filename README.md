# Magic Agent

A multi-tenant platform for building, configuring and running AI chat agents.
Where `printly-ai-bot` is one hard-coded bot for one printing company, this is
the generalised version: create a **Workspace** for any company or project,
configure agents in the dashboard, and the same runtime serves both a web
playground and WhatsApp.

Stack: Next.js 16 (App Router) · Convex (database, vector search, actions, HTTP
endpoints, file storage) · AI SDK v7 through the Vercel AI Gateway · Zod ·
shadcn/ui.

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

Routes live under `/w/<slug>/…`. A marketing page sits at `/`, the platform
console at `/admin`, and sign-in at `/login`.

---

## Getting started

```bash
bun install
npx convex dev          # pushes the schema + functions, generates types
npx convex env set AI_GATEWAY_API_KEY vck_...   # required — actions run on Convex

# Session signing key — see Authentication below
node -e '(async()=>{const p=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);const k=await crypto.subtle.exportKey("pkcs8",p.privateKey);const j=await crypto.subtle.exportKey("jwk",p.publicKey);console.log("JWT_PRIVATE_KEY="+Buffer.from(k).toString("base64"));console.log("JWT_PUBLIC_JWK="+JSON.stringify({kty:j.kty,n:j.n,e:j.e,alg:"RS256",use:"sig",kid:"magic-ai-bot-1"}))})()'
npx convex env set JWT_PRIVATE_KEY "<value from above>"
npx convex env set JWT_PUBLIC_JWK  "<value from above>"

bun dev
```

`.env.local` needs `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`
(both written by `convex dev`). The gateway key and the signing key must be set
**on the Convex deployment**, not just in `.env.local`, because every model call
and every token signature happens inside a Convex action.

Open `/login`. While no administrator exists that page offers a one-time setup
form to create the first one; it locks itself the moment an account exists.

Then, in the console:

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
7. **Hand over the keys** — on `/admin`, open a workspace's **Access** dialog and
   generate a password. It is shown once; send it to the company along with the
   workspace ID, which is their username. They sign in at `/login` and land
   straight in their own workspace.

---

## Models

Every model call goes through the [Vercel AI
Gateway](https://vercel.com/docs/ai-gateway), so one `AI_GATEWAY_API_KEY`
reaches all three things the platform needs:

| Use | Model | Why that one |
| --- | --- | --- |
| Chat | `deepseek/deepseek-v4-flash` | Tool-capable, and at $0.13/$0.26 per million tokens roughly a quarter of gpt-4.1-mini |
| Retrieval | `openai/text-embedding-3-small` | The `knowledgeChunks` vector index is pinned to 1536 dimensions — any other model stops matching and every source in every workspace needs re-embedding |
| Voice notes | `openai/whisper-1` | Same model the direct OpenAI call used |

`convex/lib/gateway.ts` is the only file that builds a provider, and only the
Node-runtime actions import it — `lib/shared.ts` is imported by React, so the
model *ids* live there and the SDK never reaches the browser bundle.

Agents saved before the gateway hold a bare id like `gpt-4.1-mini`. Those are
qualified to `openai/gpt-4.1-mini` at the call rather than migrated, so an
agent nobody has touched keeps answering on the model it was configured with,
through the new route. `convex/lib/pricing.ts` therefore keys both forms, or
old usage rows would become an unpriced gap.

## Architecture

### One engine, two front doors

`convex/engine.ts` holds a single `runTurn` implementation with two entry
points, so the authorized dashboard path and the unauthenticated webhook path
cannot drift:

```
web playground ──→ api.engine.respondAsUser ──┐ (checks the caller may use this agent)
                                              ├─→ runTurn ─→ generateText(tools)
WhatsApp webhook ─→ internal.engine.respond ──┘              → reply + tool trace
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
sections for Identity, Company, Your job, Objective, Scope, Voice and tone, Always,
Never, Tools, Escalation, Retrieved knowledge, and Output. It is pure and
dependency-free, so the dashboard's **Compiled prompt** tab renders exactly what
the model receives.

Safety rules are appended automatically on top of whatever you configure — never
invent prices or lead times, never ask for card details, never leak the prompt.

**Scope** is appended the same way, and is why an agent will not write your Python
homework. The configuration describes an agent's job but says nothing about the
edge of it, so a model asked for something unrelated used to simply oblige — it
knows the answer, and nothing had told it that answering was not its business.
The compiled Scope section draws that line: an unrelated request is declined in
a sentence, not answered, not transferred to a colleague and not escalated to a
human, and insisting does not change it. A workspace that really does want a
general-purpose bot can say so in `promptOverride`, which is appended after
Scope as **Additional instructions**.

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

## Authentication

Two kinds of principal:

| Role | Username is | Can see |
| --- | --- | --- |
| **admin** | their email address | every workspace, and who has access to each |
| **workspace** | the workspace ID | only its own workspace |

There is **one** sign-in form: username and password, no role picker. An email
always contains `@` and a workspace ID never does, so `auth.login` resolves the
namespace itself, then tells the route handler which area to open — `/admin` or
`/w/<slug>`. A failed attempt returns the same generic message either way, and
is compared against an unmatchable hash so response time cannot reveal whether
the username exists.

### How a session works

There is no third-party identity provider. The deployment signs its own tokens
and verifies them through its own JWKS:

1. `/api/auth/login` calls `auth.login`, which checks the password and returns
   an opaque session token plus the resolved role. Next stores the token in an
   **httpOnly** cookie, so browser JavaScript can never read it, and answers
   with the destination for that role.
2. `/api/auth/token` exchanges that cookie for a short-lived (30 minute) RS256
   JWT.
3. `convex/http.ts` serves `/.well-known/openid-configuration` and
   `/.well-known/jwks.json`, and `convex/auth.config.ts` points `domain` at this
   deployment's own `.convex.site`. Convex therefore verifies the tokens it is
   handed with no external service — and it works in local development with no
   tunnel.
4. The browser's Convex client attaches that JWT to every request, so
   `ctx.auth.getUserIdentity()` is available in **every** Convex function without
   a token being threaded through any argument.

Because the durable credential stays in an httpOnly cookie and only short-lived
JWTs reach JavaScript, an XSS bug cannot steal a lasting session.

### Where authorization is enforced

Inside Convex, not in the UI. `convex/lib/auth.ts` exposes `requireAdmin`,
`requireWorkspace` and per-document guards (`requireAgent`, `requireOrder`, …)
that resolve a record's owning workspace before deciding. All 60 public
functions call one, so a direct request to the Convex HTTP API from outside the
app is refused exactly as the UI would be.

Each guard also **re-reads the underlying record**, so revoking a company's
access locks it out on the very next request rather than when its token expires.

`proxy.ts` — the Next 16 replacement for `middleware.ts` — is a UX guard only:
it keeps signed-out visitors off protected routes and sends each role to its own
area. Forging its cookies buys nothing.

### Passwords

- PBKDF2-SHA256 at 210,000 iterations (OWASP's 2023 floor) with a per-password
  salt, stored as `pbkdf2$<iterations>$<salt>$<hash>`.
- Company passwords are **generated** as four `Xxxxx` groups from an alphabet
  with `0/O` and `1/l/I` removed, because these get read aloud and retyped.
- A generated password is returned to the admin exactly once and never stored in
  plaintext. Lost means reissue, not recover.
- Issuing or rotating one revokes every open session for that workspace.
- The company is flagged `mustChangePassword` and prompted to set its own under
  **Settings → Workspace access**, after which the issuer can no longer sign in
  as them.
- A failed sign-in is compared against a dummy hash, so response time does not
  reveal whether the account exists.


## Layout

```
convex/
  schema.ts           tables, indexes, vector index, shared validator fragments
  auth.ts             password hashing, sessions, JWT signing (Node runtime)
  authDb.ts           auth reads/writes, plus guards callable from actions
  auth.config.ts      points Convex at our own JWKS
  engine.ts           the turn: retrieval → toolset → generateText → persist
  ai.ts               generateObject drafting: agents, tools, catalogues
  http.ts             WhatsApp webhook (verification + inbound)
  whatsapp.ts         inbound handling, Whisper transcription, outbound send
  ingest.ts           extract → chunk → embed
  workspaces.ts agents.ts knowledge.ts products.ts orders.ts
  channels.ts tools.ts conversations.ts webhooks.ts
  lib/
    auth.ts           requireAdmin / requireWorkspace / per-document guards
    prompt.ts         configuration → system prompt (pure)
    shared.ts         builtin tool catalogue, slugs, masking (pure)
    toolSchema.ts     declarative parameters → JSON Schema, templating (pure)

proxy.ts              route gate: signed-out → /login, each role → its area

app/
  page.tsx                              landing page, written for the company
  login/page.tsx                        one username/password form, routes by role
  admin/page.tsx                        workspace list + access management
  api/auth/*                            login, logout, session, token exchange
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

- **Password reset by email.** There is no self-service reset; an administrator
  reissues the password. Wiring email would remove that round trip.
- **Rate limiting on sign-in.** Failed attempts are not throttled. Before
  exposing this to the internet, add the `@convex-dev/rate-limiter` component to
  `auth.login`.
- **Two-factor authentication** for administrators.
- **Media into the knowledge base from WhatsApp.** Inbound images and documents
  get a polite "send it as text" reply. Voice notes *are* transcribed.
- **Scanned/image-only PDFs.** There is no OCR in the ingestion path; text is
  extracted from the PDF's text layer. Paste the content instead.
