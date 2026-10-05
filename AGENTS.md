<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# Comments

Don't write unwanted comments. Add one only when the code cannot say it
itself — a non-obvious constraint or a workaround — and keep it to a line.
No section banners, no restating what the code does, no history of how it
got this way.

# WhatsApp channel API

The WhatsApp provider is 1Automations. Its API docs are at
https://documenter.getpostman.com/view/14215086/2sA3e2hAeY — read them before
changing anything that talks to WhatsApp.

- Messages are sent with `POST <apiBaseUrl>/<apiVersion>/<phone_number_id>/messages`
  in the Cloud API shape, using `Authorization: Bearer <accessToken>`. The
  channel's `apiBaseUrl` already carries the provider's `/api/meta` prefix.
- 1Automations queues every send. The response is
  `{ messaging_channel, message: { queue_id, message_status: "queued" } }`,
  with no `wamid`. A second webhook,
  `{ messaging_channel, message: { queue_id, message_status }, response }`,
  carries Meta's response, and the `wamid` is in `response.messages[0].id`.
  `providerMessageId` keeps whichever id a send returned, and
  `deliveries.resolveQueued` links the `queue_id` to the `wamid` when that
  webhook arrives. Every send path must keep the id: it is how a delivery
  receipt finds its row in `messages`, through `whatsappMessageIds`.
- Delivery receipts arrive on the same `/whatsapp/<channelKey>` webhook as
  inbound messages, as `entry[].changes[].value.statuses[]` with
  `sent | delivered | read | failed`. `convex/http.ts` hands them to
  `deliveries.applyStatuses`. A status only moves forward (see
  `convex/lib/delivery.ts`), because receipts arrive out of order. A receipt
  can also arrive before the queue webhook, so one that matches nothing is
  retried a few times before it is dropped.
- The provider sends receipts only for the events its webhook subscribes to.
  Subscribe through `POST /v2/webhook`, with `sent`, `delivered`, `read` and
  `failed` among the `events`. Without them, every tick stays at "sent".
