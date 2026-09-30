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

### Deploying

`vercel.json` builds with `convex deploy --cmd 'bun run build'`, so the backend
and the frontend ship in one step. They have to: the two halves are one program,
and a frontend that knows about a Convex function the backend has not got yet
does not fail at build — it fails in the browser, as a blank page, on whichever
route calls it first.

That build command needs **`CONVEX_DEPLOY_KEY`** in the Vercel project's
environment variables — a production deploy key from the Convex dashboard
(Settings → Deploy keys). Without it the build stops before Next runs.

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
| Chat | `deepseek/deepseek-v4.1-flash` | Tool-capable, reads images, 1M context, and at $0.30/$1.20 per million tokens still under gpt-4.1-mini |
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
| `save_contact_detail` | Remember a name / email / company / preference |
| `escalate_to_human` | Mark the conversation escalated, fire `escalation` |

Each is toggled per agent.

Orders are not a builtin: every workspace has an **Orders record book**
(`convex/lib/ordersBook.ts`), so an agent switched on for it takes orders with
`file_order` and looks them up with `find_order`, and the team edits the
book's fields and stages like any other. An order filed there fires
`record_filed` with the book in the payload. `orders:listByWorkspace` still
answers in the old order shape for the mobile app and MCP. Workspaces from
before the move are brought over once with
`npx convex run migrations:ordersToRecords`, which copies their orders into the
book, moves agents off `create_order` / `lookup_orders`, and turns "New order"
alerts into "Record filed" alerts on the book. Every call is wrapped so a thrown error becomes a
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

### Google integrations

Sheets, Calendar and Drive are **recipes for the custom-tool machinery above**,
not a second runtime: connecting one writes `tools` rows tagged with its id and
the same HTTP executor runs them.

There is nothing to configure. Connecting is one button — Google's consent
screen, then back to the console with the spreadsheet or the Drive folder
already created in the operator's own account and the tools already written.
`convex/lib/integrations.ts` is the catalogue, and the dashboard renders the
same descriptions the model reads.

Both halves of OAuth live on the Convex deployment rather than the Next app, so
the client secret and the refresh token never leave Convex and the callback URL
is stable per deployment:

```
https://<deployment>.convex.site/integrations/google/callback
https://<deployment>.convex.site/integrations/google/<action>?token=<call token>
```

`integrations.startGoogleConnect` is an action, not a mutation, because the
`state` parameter needs real randomness — mutations run on a deterministic
seed. It writes an `integrationOAuthStates` row, which the callback consumes;
that row is the only thing tying Google's redirect back to the workspace that
started it, since the callback lands on a domain with no session cookie.

The endpoints are public, so the call token in the query string is the whole
credential. It is per connection, which is what makes disconnecting a real
revocation, and a token for Drive cannot reach the Calendar endpoints.

**Tools are opt-in per agent.** Connecting writes the tools workspace-wide and
enabled, but an agent only receives one if its name is in
`agents.integrationTools` — the switches under an agent's Knowledge & tools
tab. Connecting Google Calendar should not silently hand the diary to every
live agent. `tools.resolveForAgent` is where that gate is applied, and only for
integrations the catalogue still knows about, so tools left behind by the
earlier Slack and Zapier cards keep working as ordinary HTTP tools.

Scopes are the narrowest that do the job: `spreadsheets`, `calendar.events`,
and `drive.file` + `drive.metadata.readonly` — metadata only, because the agent
sends links and never needs to read a file.

Setup, once per deployment:

```bash
# Google Cloud console → APIs & Services → Credentials → OAuth client ID
#   Type: Web application
#   Authorised redirect URI: https://<deployment>.convex.site/integrations/google/callback
# Enable the Sheets, Calendar and Drive APIs on the same project.
npx convex env set GOOGLE_CLIENT_ID     <id>.apps.googleusercontent.com
npx convex env set GOOGLE_CLIENT_SECRET <secret>
```

Until those are set the Integrations page says so and the connect buttons are
disabled. `drive.metadata.readonly` is a sensitive scope, so a production
deployment needs the consent screen verified before it can be used outside the
test users list.

### Magic apps — Magic Forms and Magic Reward

Our own two products, connected by an API key made in each app rather than by
OAuth (`convex/apps.ts`, catalogue in `convex/lib/apps.ts`). Connecting reads
the account, copies its published forms or live offers into
`appConnections.items`, and registers a signed webhook back to this deployment:

```
https://<deployment>.convex.site/apps/<inboundKey>
```

An agent with the app switched on under Knowledge & tools gets one tool —
`send_form` or `send_offer` — built by the engine rather than stored as a
`tools` row, because it needs the conversation: it mints a ref, files it in
`appLinks` against this thread, asks the app for a link carrying it (name and
number prefilled), and sends the link as a button. When the customer submits
the form or plays the offer, the app posts the result with the ref, the route
checks the signature and matches the ref, and the result arrives in the thread
as the customer's next turn — `[Form submitted …]` / `[Played the offer …]` —
which the agent answers (switchable per app) and push and the workspace webhook
report as `form_submitted` / `offer_played`. A result with no ref, such as a
form filled from a link on a website, is acknowledged and dropped.

Nothing to set up: the apps are reached at `https://forms.magicwebs.ai` and
`https://reward.magicwebs.ai`. A development deployment can point elsewhere —
at the apps' own development deployments — with:

```bash
npx convex env set MAGIC_FORMS_API_URL  https://<forms-deployment>.convex.site
npx convex env set MAGIC_REWARD_API_URL http://localhost:3001
```

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

### Billing

A company pays for two things, kept apart because they are priced apart:

| | What it is | How it is paid |
| --- | --- | --- |
| **Platform fee** | A monthly plan, plus any extra agents bought on top | Razorpay Subscriptions — card, UPI Autopay or e-mandate |
| **Wallet** | Prepaid credit every WhatsApp message is drawn from | Top-ups through Razorpay Checkout, and auto-recharge from a saved mandate |

Everything is in INR, with GST added on top at the rate the administrator
sets (18% by default).

#### Plans

Administrators edit the catalogue on **/admin/plans**. Switching billing on
seeds three plans — Starter at ₹4,999 a month, Growth and Scale — and every
one of them includes the front desk, the follow-up desk and the marketing
desk. What differs is how many **custom agents** (live specialists) and
**human agents** (people with a login of their own) a plan includes.

An **extra agent** is one more of either, from a single pool: an account on
Starter with two extras can run three custom agents and one person, or one
custom agent and three people. Its list price (₹2,499) is shown struck through
beside its price (₹999); both are the administrator's to change, and so is a
per-account discount off the plan and a per-account extra-agent price, set on
**/admin/subscriptions**.

Limits are enforced where a seat is taken: making an agent live
(`agents.update` to `active`) and issuing a human agent's login
(`authDb.upsertMemberCredential`). A draft or paused agent holds no seat.
Administrators are let through, and an account they take over its limit
shows as over on its Billing page.

#### Subscriptions

A Razorpay plan has a fixed amount, and prices here are not fixed — a
discount, a number of extras — so `razorpay.startSubscription` makes a
Razorpay plan per distinct price and remembers it (`razorpayPlans`). The
subscription starts charging where the account is already paid up to: the end
of its trial, or of the month it is leaving. Razorpay authorises a future
start with ₹5 and refunds it.

Razorpay can only edit a subscription authorised with a card, so a plan
change is a new subscription rather than an edit: when it is authorised it
becomes the account's, its limits apply at once, and the one it replaced is
cancelled — its month was already paid, and the new one charges from where
that month ends. Cancelling runs to the end of a paid month; a subscription
that has not charged yet (one authorised during a trial) ends at once.

The dashboard is open while a plan is active, during a trial, and through a
grace period (3 days by default) after a failed renewal. Past that it
**locks**: every page but Billing shows a renewal screen. Only the dashboard —
agents keep answering customers. `convex/lib/plans.ts` holds the rule
(`accessOf`), and React imports it so the banner and the lock agree with the
server. Until an administrator switches billing on nothing is enforced at
all, and switching it on starts every existing workspace's trial from that
moment rather than from when the workspace was made.

An administrator can also bill an account **by arrangement** — invoiced
offline, or given away — which bypasses Razorpay, optionally up to a date.

#### The wallet

Every sent WhatsApp message is charged to its workspace at a per-message rate
for its **conversation type** — Meta's four categories:

| Category | What is billed as it |
| --- | --- |
| Service | Free-form replies inside the 24-hour window: agent replies and rich messages, manual replies from the inbox, follow-up nudges |
| Utility | Templates approved as utility |
| Marketing | Templates approved as marketing — festival and birthday greetings. Templates saved before categories existed count as marketing |
| Authentication | Templates approved as authentication |

Rates are set by an administrator on **/admin/billing**: one platform default,
plus an optional rate card per account. Each sent message writes one
`billingEvents` row with its amount fixed at send time and takes the same
amount off the wallet in the same transaction (`convex/lib/charge.ts`), so
the balance and the ledger cannot disagree. Amounts are integer millionths
of the currency, for the reason usage rows are nano-USD. Only a rate card in
the wallet's currency (INR) is taken off the wallet; the billing pages warn
when an account's rates are in anything else.

A **service** reply always goes out, even if it takes the balance below zero
— a customer who wrote in is never left unanswered for want of credit.
**Templates** are what the business starts, so a campaign or an alert whose
template the balance cannot cover is held back, and its log says why
(`templateBlock` in `convex/lib/wallet.ts`).

A top-up is its amount plus GST; the amount is what is credited. Below the
account's low-balance line the dashboard warns, a push goes to the app once
per dip, and — when auto-recharge is on — the saved mandate is charged
(`razorpay.chargeMandate`). Setting that up is a ₹1 authorisation with UPI
Autopay or a card, credited to the wallet, which leaves an "as presented"
mandate capped at ₹15,000 a debit (above that every debit needs the
customer's approval). **Auto-recharge is not instant**: the bank sends a
pre-debit notice and takes the money 25–36 hours later, so the line should
cover at least two days of spend.

Each workspace reads all of this at **/w/&lt;slug&gt;/billing**: its plan and
seats, its wallet and top-ups, and the per-message ledger. This is separate
from `usageEvents` and the **Tokens & cost** page, which are what the
platform pays the model provider.

#### Razorpay setup

```bash
npx convex env set RAZORPAY_KEY_ID      rzp_live_...   # or rzp_test_... to try it out
npx convex env set RAZORPAY_KEY_SECRET  <secret>
npx convex env set RAZORPAY_WEBHOOK_SECRET <a secret you choose>
```

Then in the Razorpay dashboard, **Settings → Webhooks → Add**:

```
https://<deployment>.convex.site/razorpay/webhook
```

with the same secret, and these events: every `subscription.*`,
`payment.captured`, `payment.failed`, `order.paid`, `token.confirmed`,
`token.rejected`, `token.cancelled`, `token.paused`. Checkout's own callback
settles a payment the moment it succeeds; renewals, failed retries and a UPI
mandate the bank confirms later only ever arrive by webhook, so billing does
not work without it. Subscriptions and recurring payments must be enabled on
the Razorpay account.

### Outbound webhooks

`order_created` and `escalation` are POSTed to the workspace's endpoint as JSON,
signed with `X-Magic-Signature: sha256=<hmac>` over the raw body using the
workspace secret. Every delivery attempt is logged and visible under Settings,
with a **Send test event** button.

---

## Authentication

Three kinds of principal:

| Role | Username is | Can see |
| --- | --- | --- |
| **admin** | their email address | every workspace, and who has access to each |
| **workspace** | the workspace ID | only its own workspace |
| **member** | `<workspace-id>.<name>` | its workspace's whole dashboard — but not its password, other people's logins, MCP tokens or the subscription |

A **member** is a human agent the company gave a login from its Team page.
Each one takes a human-agent seat on the plan. What only the company itself
may do is behind `requireOwner` rather than `requireWorkspace`.

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

### One session per login

Every login — admin, company or human agent — can be open in **one place at a
time**, across the web and the mobile app together. When the password is right
but the login is already open elsewhere, `auth.login` answers `sessionActive`
with the device and when it was last used, and signs nobody in. The person then
chooses to sign that device out (`auth.continueLogin` with `replace: true`),
which ends the old session and opens the new one in a single transaction.

The session that was replaced is marked `endedReason: "replaced"` rather than
deleted, and web and app tokens carry its id, so it stops working on the very
next request. Both clients subscribe to `authDb.mySession` and swap the page for
"signed in on another device" the moment it ends.

MCP sessions — connector URLs, and the MCP server's own sign-in (`client:
"mcp"`) — are exempt: every MCP request signs in afresh, and would otherwise sign
the person out of their browser. An app build from before this change still
installed on someone's phone is refused with a sentence telling it to update,
since it cannot show the extra step.

### Two-factor authentication

Any login can add an authenticator app (TOTP, RFC 6238 — six digits, 30
seconds, HMAC-SHA1, which every authenticator defaults to) from **Settings →
Access** in its workspace, or from **Access** in the admin console. With it on,
`auth.login` answers `twoFactor` instead of signing in, and `auth.continueLogin`
takes the code. Setting it up issues ten one-time recovery codes, stored hashed.

- Secrets live in their own `twoFactor` table, keyed `role|id`, and never reach
  a browser.
- A code is spent once used, and codes are counted *before* they are checked,
  so parallel guesses share one limit: every fifth wrong code in a row locks the
  login, for 15 minutes and doubling each time up to a day.
- Whoever can reset a login's password can also clear its authenticator, and
  does by resetting it: the admin for a company, the company for a human agent,
  and `npm run provision:admin` for an administrator. That is the way back in
  for somebody who loses their phone and their recovery codes.

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
  plans.ts            the plan catalogue and billing terms (admin)
  subscriptions.ts    an account's plan, seats and standing
  wallet.ts           balance, top-ups, auto-recharge preferences
  razorpay.ts         every call to Razorpay
  razorpayEvents.ts   what Razorpay reports, applied (webhook + Checkout)
  lib/
    auth.ts           requireAdmin / requireWorkspace / requireOwner / per-document guards
    plans.ts          pricing, GST, seats, dashboard access (pure)
    charge.ts         one sent message → ledger row + wallet debit
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
- **Media into the knowledge base from WhatsApp.** Inbound images and documents
  get a polite "send it as text" reply. Voice notes *are* transcribed.
- **Scanned/image-only PDFs.** There is no OCR in the ingestion path; text is
  extracted from the PDF's text layer. Paste the content instead.
