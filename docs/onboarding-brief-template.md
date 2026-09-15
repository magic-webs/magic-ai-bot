# Magic Agent — Onboarding Brief

**Fill this in and send it back to us. Everything we need to build your
workspace, your agents and their knowledge base is in this one document.**

You do not have to answer every question. Anything you leave blank we will
either ask about later or fill with a sensible default — but every blank is a
question your agent cannot answer for a customer, so it is worth the time.

Write in the voice you want the agent to use with your customers. We copy a lot
of this text almost word for word into what the agent knows.

---

## How this document is used

| Section | Becomes |
| --- | --- |
| 1. Company profile | The **workspace** — the facts every agent of yours is told |
| 2. Company facts | Lines injected into **every** agent's instructions |
| 3. Agents | One **agent** per block — persona, job, rules |
| 4. Knowledge base | Searchable **sources** the agents quote from |
| 5. Catalogue | The **products/services** agents are allowed to discuss |
| 6. Enquiry stages | Your **lead pipeline** and follow-up behaviour |
| 7. Channels | WhatsApp number / website widget |
| 8. Systems & handover | Webhooks, custom tools, who gets escalations |

Two rules that shape all of it:

- **An agent will not discuss a product that is not in section 5**, and will
  never quote a price you have not given us. If it is sellable, list it.
- **An agent answers from sections 2 and 4 only.** If the answer to a common
  customer question is not written down here, the agent will say it does not
  know and pass the question to your team.

---

## 1. Company profile

| Field | Your answer | Notes |
| --- | --- | --- |
| Company name | | As customers know it |
| Owner / main contact name | | How you want to be addressed |
| Tagline | | One line |
| What the company does | | 3–5 sentences, **in the words an agent should use to a customer** |
| Industry | | e.g. commercial printing, interior fit-out, dental clinic |
| Website | | |
| Support email | | Where escalations land |
| Support phone | | What an agent may give out |
| Address | | Given when customers ask where you are |
| Language & region | | e.g. `en-IN`, `en-GB` |
| Timezone | | e.g. `Asia/Kolkata` |
| Currency | | e.g. `INR`, `GBP` |

### Trading identity

- Legal / registered name (if different from above):
- Years in business:
- Service area — cities, states, countries you serve:
- Anywhere you explicitly do **not** serve:

---

## 2. Company facts

Short, factual statements any agent may repeat to any customer. These go into
every agent's instructions verbatim, so keep each one to a single sentence and
make sure each one is true today.

| Fact | Value |
| --- | --- |
| Opening hours | |
| Working days | |
| Delivery / service areas | |
| Typical turnaround | |
| Minimum order | |
| Payment methods | |
| Payment terms | |
| Delivery charge rule | |
| Returns / cancellation window | |
| Warranty or guarantee | |
| GST / VAT / tax registration | |
| Certifications, licences, awards | |
| | |
| | |

> Add as many rows as you like. Anything a customer asks ten times a week
> belongs here rather than in section 4 — facts sit permanently in front of the
> agent, knowledge has to be searched for.

---

## 3. Agents

You get one **front desk** automatically. It greets every customer, works out
what they want and hands the conversation to the right specialist. You do not
configure it — you configure the specialists it hands to.

Copy the block below once per agent. Two to four agents is normal to start.

### Agent 1

| Field | Your answer |
| --- | --- |
| Internal name (what you see in the dashboard) | |
| Name customers see | |
| Reads as male / female (picks the avatar) | |
| Role title | |
| **Hand over to this agent when…** | |
| What success looks like for this agent | |
| Greeting (first line to a new customer) | |

**Hand over to this agent when…** is the single most important line in this
document. It is the only thing the front desk reads when deciding who deals
with a customer. Write a *condition*, not a job title:

- Good: "the customer asks about price, quantity or specifications, or wants to
  place a new order for printed material"
- Useless: "handles sales enquiries professionally"

**How this agent works, step by step** — how it opens, what it must collect, in
what order, and how it closes:

1.
2.
3.
4.

**Always** (hard rules — each one a complete instruction):

-
-
-

**Never** (hard limits):

-
-
-

**When should it stop and fetch a human?**

**Tone**

| Setting | Your answer |
| --- | --- |
| Personality in three words | |
| Words / phrases it must avoid | |
| Formality — casual / neutral / formal | |
| Emoji — none / sparing / expressive | |
| Reply length — short / medium / detailed | |
| Languages it may reply in | |
| Reply in whatever language the customer writes in? | yes / no |
| Should it read as a colleague typing, not a bot? | yes / no |

**What it is allowed to do** — tick what applies:

- [ ] Search your knowledge base
- [ ] Search your catalogue
- [ ] Ask the spec questions for a product
- [ ] Record an order / enquiry
- [ ] Look up a customer's existing orders
- [ ] Remember customer details (name, email, company)
- [ ] Hand the conversation to a human
- [ ] Send buttons, option lists, images, location pins, contact cards
- [ ] Transfer to another agent

### Agent 2

*(copy the block above)*

---

## 4. Knowledge base

**This is the part that decides whether the agent is any good.** Everything
here is chunked, indexed and searched every time a customer asks something the
facts in section 2 do not answer.

### 4a. What to send us

Tick what you have and attach it. Send what exists today — we would rather have
a messy real document than a tidy imaginary one.

- [ ] Company / about-us page or profile deck
- [ ] Service or product brochures, spec sheets, size charts, material guides
- [ ] Price list or rate card *(also fill in section 5)*
- [ ] Standard quotation template or sample quotes
- [ ] The FAQ your team actually gets asked — **the highest-value item here**
- [ ] Delivery, shipping and installation policy
- [ ] Returns, refunds, cancellation and reprint policy
- [ ] Warranty / guarantee terms
- [ ] Payment terms, advance policy, credit terms
- [ ] Terms & conditions, privacy policy
- [ ] Onboarding or order-process explainer ("how we work")
- [ ] Artwork / file / measurement requirements customers must meet
- [ ] Lead times and production schedule
- [ ] Troubleshooting or after-sales guide
- [ ] Case studies, past projects, clients you are happy to name
- [ ] Competitor comparison — how you want to be positioned
- [ ] Objection handling — what your best salesperson says to "too expensive"
- [ ] Brand vocabulary: words you always use, words you never use

Accepted file types: **PDF, TXT, MD, CSV, JSON, HTML**. Plain text pasted into
this document and public URLs also work. Scans and photos of documents do not —
we need real text, not an image of it.

### 4b. Source list

One row per document, page or block of text.

| # | Title (may be shown as a citation) | Type | Which agents can use it | Tags | Where it is |
| --- | --- | --- | --- | --- | --- |
| 1 | | file / text / FAQ / URL | all / *name one agent* | | attached / link |
| 2 | | | | | |
| 3 | | | | | |

### 4c. FAQ

Write these as plain question-and-answer pairs. Thirty real ones beat three
hundred invented ones. Use the customer's words in the question, not yours.

**Q:**
**A:**

**Q:**
**A:**

**Q:**
**A:**

### 4d. Things the agent must never say

Claims you cannot stand behind, topics that must go to a human, promises about
dates or discounts, anything under NDA:

-
-

### 4e. Do not send us

Passwords, card numbers, customer personal data, staff salary information, or
anything you would not be comfortable with a customer reading back to you — the
agent can quote anything in its knowledge base.

---

## 5. Catalogue

Every product or service an agent may discuss. Leave **price blank** for
anything you want quoted by hand — the agent will then collect the details and
pass the enquiry to your team instead of naming a number.

| Field | Meaning |
| --- | --- |
| Name | What the customer calls it |
| Code / SKU | Optional, your internal reference |
| Category | Groups it in the catalogue |
| Description | What it is, in customer language |
| Price | Blank = the agent never quotes for this |
| Unit | What the price is per — "per 1000", "per sq ft", "per hour" |
| Spec questions | See below — this is what turns a chat into a usable enquiry |
| Extra facts | Lead time, minimum order, available finishes |
| Images | Links, or attach the files |
| Internal notes | Never shown to a customer |

### Product 1

| Field | Your answer |
| --- | --- |
| Name | |
| Code / SKU | |
| Category | |
| Description | |
| Price | |
| Unit | |
| Extra facts | |
| Images | |
| Internal notes | |

**Spec questions** — everything your team needs before it can price or produce
this. The agent will not record an enquiry until it has collected every
required one.

| Question the agent asks | Answer type | Required? | Allowed options (for a choice) | Example answer |
| --- | --- | --- | --- | --- |
| | text / number / choice / yes-no / date | yes / no | | |
| | | | | |
| | | | | |

### Product 2

*(copy the block above)*

---

## 6. Enquiry stages

How an enquiry moves from first message to won or lost. We file every
conversation at one of these, and use them to decide when a quiet customer is
worth nudging. Rename, reorder, delete or add — these are only our defaults.

| Order | Stage | What belongs at this stage | Ends the chase? |
| --- | --- | --- | --- |
| 1 | New enquiry | Made contact, not said enough to work with yet | no |
| 2 | Qualified | You know what they want and you do it | no |
| 3 | Details collected | Everything needed to price it has been collected | no |
| 4 | Quoted | A price or proposal has gone to them | no |
| 5 | Negotiating | Pushing on price, terms or timing | no |
| 6 | Won | They committed | yes — won |
| 7 | Lost | Said no, went elsewhere, or went quiet for good | yes — lost |

**Follow-up**

- How long should a conversation sit quiet before we nudge? _____
- How many times may we nudge before we let it go? _____
- Any stage we must **never** chase from? _____

---

## 7. Channels

### Website widget

- Put it on which site / pages:
- Which agent answers there (default: the front desk):

### WhatsApp

We need a WhatsApp Business (Cloud API) number. If you do not have one yet,
tell us and we will walk you through getting one.

| Field | Your answer |
| --- | --- |
| Display number | |
| Phone number ID | |
| WhatsApp Business Account (WABA) ID | |
| Meta Business ID | |
| Permanent access token | *send separately, not in this document* |
| Which agent answers there | |

The number goes live once the callback URL we give you is saved in Meta.

### Hours

- Should the agents answer 24/7, or only in working hours?
- Outside hours, what should they say?

---

## 8. Systems & handover

### Where should new enquiries go?

- [ ] Email to: _____
- [ ] WhatsApp / SMS to: _____
- [ ] Posted to our system at this URL: _____
- [ ] We will just read them in the dashboard

### Do the agents need to read or write anything in your systems?

For example: check live stock, look up an order in your ERP, book a slot in a
calendar, raise a ticket. For each one:

- What it should do:
- Which system / URL:
- Who at your end can give us access:

### Escalation

- Who takes over when an agent hands a conversation to a human:
- How fast they respond, in working hours:
- What must **always** go to a human, never be answered by an agent:

---

## 9. Sign-off

| | |
| --- | --- |
| Completed by | |
| Role | |
| Date | |
| Best contact for follow-up questions | |

**What happens next:** we build the workspace, load the knowledge, configure
the agents and send you a login. You test them by chatting exactly as a
customer would and tell us what reads wrong. Nothing goes on a live WhatsApp
number or your website until you say so.
