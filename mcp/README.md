# Magic AI Bot — MCP server

Lets an assistant build and configure a workspace: agents, the front desk that
routes between them, the product catalogue, the knowledge base, channels and
custom tools — and then talk to an agent to check the configuration actually
works.

## How it authenticates

It signs in the same way the dashboard does — `auth.login` for a session token,
`auth.mintAccessToken` for a short-lived JWT, then that JWT on every call. So:

- It has **exactly** the permissions of the account it signs in as. Every
  `requireWorkspace` / `requireAdmin` guard in `convex/` applies unchanged.
- There is no admin key and no bypass. This server is an operator, not a new
  security boundary.
- It talks to Convex directly, so **the Next app does not need to be running**
  (only `list_channels` uses the app URL, and only to print an embed snippet).

Sign in as a **workspace** (slug + password) to scope it to one company, or as
an **admin** (email + password) to reach every workspace and unlock the
platform-administration tools — creating tenants, issuing their logins,
suspending and deleting them.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `MAGIC_AI_BOT_CONVEX_URL` | yes | The deployment, e.g. `https://xxx.convex.cloud`. Falls back to `NEXT_PUBLIC_CONVEX_URL`. |
| `MAGIC_AI_BOT_USERNAME` | yes | An admin email, or a workspace slug. Falls back to `ADMIN_EMAIL`. |
| `MAGIC_AI_BOT_PASSWORD` | yes | That account's password. Falls back to `ADMIN_PASSWORD`. |
| `MAGIC_AI_BOT_WORKSPACE` | no | Default workspace slug, so tools can omit `workspace`. |
| `MAGIC_AI_BOT_APP_URL` | no | Only used to build widget embed snippets. Default `http://localhost:3000`. |

In a local checkout the fallbacks are read from `.env.local`, so it works with
no configuration at all — **as platform admin**, with access to every
workspace. For anything shared, set `MAGIC_AI_BOT_USERNAME` and
`MAGIC_AI_BOT_PASSWORD` to a workspace account instead.

## Three ways to serve it

| Where | How | Used by |
| --- | --- | --- |
| Child process | `bun run mcp` (stdio) | Claude Code, Claude Desktop |
| **The deployed app** | `app/api/mcp/[token]/route.ts` | **claude.ai** — nothing extra to run |
| Standalone HTTP | `bun run mcp:http` | claude.ai, when the app is not deployed |

All three register the same tools from `mcp/server.mjs`; only the transport
differs. The two local modes exit immediately with a readable message if they
cannot sign in, so a bad config shows up when the client connects rather than on
the first tool call.

## Claude Code

`.mcp.json` in the repo root already registers it for this project — no secrets
in it, because the server reads `.env.local` itself. Run `claude mcp list` to
confirm it connected.

## Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

```json
{
  "mcpServers": {
    "magic-ai-bot": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\development\\magic-ai-bot\\mcp\\server.mjs"]
    }
  }
}
```

Absolute paths for both, including the Node binary: Claude Desktop launches the
command with a minimal PATH, so a bare `node` often fails even when it works in
a terminal. Restart the app afterwards.

## claude.ai — from the deployed app (recommended)

claude.ai does not launch local processes. Its custom connectors are *remote*
MCP servers: Anthropic's servers make the request, so the URL has to be
reachable over the public internet — a `localhost` address will not work, and
nor will anything behind a VPN or firewall.

If the app is already deployed, that is the public HTTPS URL. The route at
`app/api/mcp/[token]/route.ts` serves MCP from it, so there is no second process
to host and no tunnel to keep alive, and the URL never changes.

### 1. Generate a token

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 2. Set the environment variables on the host

| Variable | Value |
| --- | --- |
| `MAGIC_AI_BOT_MCP_TOKEN` | the token from step 1 |
| `MAGIC_AI_BOT_USERNAME` | an **admin email** for the whole platform, or a **workspace slug** for one company |
| `MAGIC_AI_BOT_PASSWORD` | that account's password |
| `MAGIC_AI_BOT_WORKSPACE` | optional: a default slug, so tools can omit `workspace` |
| `MAGIC_AI_BOT_CONVEX_URL` | only if it differs from `NEXT_PUBLIC_CONVEX_URL` |

On Vercel: Project → Settings → Environment Variables, then **redeploy** —
environment changes do not reach a running deployment.

Signing in as an admin is what turns on `create_workspace`,
`issue_workspace_password`, `delete_workspace` and the rest. It also means the
connector URL reaches every tenant — see
[Security](#security-whenever-it-is-reachable-over-http) for what that implies
and how to keep it narrow.

`MAGIC_AI_BOT_APP_URL` is not needed on Vercel: the deployment's own hostname is
used for the widget embed snippets that `list_channels` prints.

Note that the credentials must be valid on **the deployment's own Convex
database**, which is a different database from local development, with its own
workspaces and passwords. Its functions also need to be up to date
(`npx convex deploy`), or the newer tools will fail.

### 3. Add the connector

In claude.ai: **Customize → Connectors → "+" → Add custom connector**, and paste

```
https://<your-domain>/api/mcp/<the token>
```

Then **Add**. Leave the OAuth fields under Advanced settings empty — the token
in the path is what authenticates. On Team and Enterprise plans an Owner adds it
under **Organization settings → Connectors** first, and members then enable it
individually.

### 4. Check it

Open a new chat, confirm the connector is enabled in the tools menu, and ask
something that needs it — "list my agents", or "what's in the catalogue?".

With `MAGIC_AI_BOT_MCP_TOKEN` unset the route answers `404`, so a deployment
that has not opted in has no MCP surface at all.

## claude.ai — standalone, without deploying

Only worth it when the app is not deployed anywhere public.

### 1. Generate a token

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 2. Start the HTTP server

```bash
MAGIC_AI_BOT_MCP_TOKEN=<the token> \
MAGIC_AI_BOT_USERNAME=<workspace slug> \
MAGIC_AI_BOT_PASSWORD=<that workspace's password> \
bun run mcp:http
```

PowerShell:

```powershell
$env:MAGIC_AI_BOT_MCP_TOKEN="<the token>"
$env:MAGIC_AI_BOT_USERNAME="<workspace slug>"
$env:MAGIC_AI_BOT_PASSWORD="<that workspace's password>"
bun run mcp:http
```

It binds to `127.0.0.1:8787` by default. Check it:

```bash
curl http://127.0.0.1:8787/health     # {"ok":true,"server":"magic-ai-bot"}
```

### 3. Put it on a public HTTPS URL

For a quick trial, a tunnel is enough:

```bash
cloudflared tunnel --url http://localhost:8787
# → https://something-random.trycloudflare.com
```

For anything lasting, host it properly behind HTTPS on a domain you control and
set `MAGIC_AI_BOT_MCP_HOST=0.0.0.0` so it listens beyond loopback. A free tunnel
URL changes every restart, and you would have to re-paste it into claude.ai each
time.

### 4. Add the connector

In claude.ai: **Customize → Connectors → "+" → Add custom connector**, and paste

```
https://<your-public-host>/mcp/<the token>
```

Then **Add**. Leave the OAuth fields under Advanced settings empty — the token
in the path is what authenticates. On Team and Enterprise plans an Owner adds it
under **Organization settings → Connectors** first, and members then enable it
individually.

### 5. Check it

Open a new chat, confirm the connector is enabled in the tools menu, and ask
something that needs it — "list my agents", or "what's in the catalogue?".

## Security, whenever it is reachable over HTTP

**The URL is the credential.** claude.ai's connector form has a URL field and
OAuth fields, and nowhere to put a custom header, so the shared secret lives in
the path. Anyone holding that URL has whatever the account in
`MAGIC_AI_BOT_USERNAME` has.

Consequences worth acting on:

- **Decide deliberately between admin and workspace.** A workspace account
  reaches one company's data. An admin account reaches every tenant and can
  create, suspend and delete them — which is what the administration tools are
  for, and also what a leaked URL would expose. Either is a legitimate choice;
  what matters is that it is a choice, so set `MAGIC_AI_BOT_USERNAME`
  explicitly rather than letting it fall back to `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  by accident.
- **If you run it as admin**, the mitigations that actually help are: a long
  token, rotating it if the URL is ever pasted anywhere shared, and remembering
  that `delete_workspace` needs the exact workspace name — so a confused caller
  cannot delete a tenant on a single wrong argument.
- **No token, no endpoint.** Both HTTP paths refuse a token under 24 characters,
  and answer an identical `404` for a wrong token and for MCP being switched
  off, so neither the URL shape nor the feature's existence can be probed.
- **The standalone server binds to loopback unless told otherwise**, so exposing
  that one is always a deliberate act.
- **Rotate** by changing the token and re-pasting the URL into claude.ai. On a
  hosted deployment that means a redeploy.
- OAuth is the better answer for anything shared with a team, and is what the
  connector's Advanced settings are for. It is not implemented here — the token
  guard is deliberately the smaller thing, and it swaps out without touching any
  tool.

Additional environment variables for this mode:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAGIC_AI_BOT_MCP_TOKEN` | — | Required. The shared secret in the URL path. |
| `MAGIC_AI_BOT_MCP_PORT` | `8787` | |
| `MAGIC_AI_BOT_MCP_HOST` | `127.0.0.1` | Set `0.0.0.0` to listen beyond loopback. |
| `MAGIC_AI_BOT_MCP_HTTP` | — | `1` to serve HTTP without passing `--http`. |

## Tools

Every tool takes an optional `workspace` slug. Anything that names a thing
(`agent`, `product`, `channel`, `source`, `tool`) accepts a name, a
customer-facing name, a SKU/slug, or an id — so you can say "the Sales agent"
without looking anything up. An ambiguous name comes back as an error listing
the candidates.

**Context** — `whoami`, `list_workspaces`, `get_workspace`, `update_workspace`

**Agents** — `list_agents`, `get_agent`, `create_agent`, `update_agent`,
`delete_agent`, `draft_agent`, `ensure_front_desk`, `chat_with_agent`

**Catalogue** — `list_products`, `create_product`, `update_product`,
`delete_product`, `import_products`, `draft_catalogue`

**Knowledge** — `list_knowledge`, `add_knowledge`, `delete_knowledge`

**Channels** — `list_channels`, `create_channel`, `update_channel`,
`delete_channel`

**Custom tools** — `list_custom_tools`, `create_custom_tool`,
`update_custom_tool`, `delete_custom_tool`

**Operations** — `list_conversations`, `read_conversation`, `list_contacts`,
`list_orders`, `usage_summary`

**Platform administration** (admin sign-in only) — `create_workspace`,
`issue_workspace_password`, `set_workspace_access`, `set_workspace_status`,
`delete_workspace`, `workspace_access_report`, `platform_usage`

Signed in as a workspace, the administration tools are still listed but fail
with "Administrator access required" from the Convex guard — the same answer the
dashboard gives.

### Notes on a few of them

- **`chat_with_agent`** is the one that makes the rest usable. It runs the real
  engine, so retrieval, catalogue lookups, custom tools and routing all happen,
  and it reports `handoffPath` — point it at the front desk to see whether
  routing works. It costs model tokens against the workspace.
- **`get_agent`** returns the compiled system prompt. When an agent behaves
  oddly, read that before changing anything: it is what the model actually got.
- **`update_agent`** takes a *partial* `tone` and merges it with the stored one.
  Arrays (`rules`, `guardrails`, `builtinTools`) replace the whole list.
- **`add_knowledge`** embeds in the background. Poll `list_knowledge` until
  status is `ready` before expecting an agent to find it.
- **Images** are addresses here (`imageUrls`). Uploading a file is the
  dashboard's job — an MCP tool cannot carry bytes usefully.
- **`draft_agent`** / **`draft_catalogue`** spend model tokens on the
  workspace's own account.
- **`issue_workspace_password`** returns the password once and keeps only the
  hash. There is no way to read it back, only to issue a new one — which also
  drops that company's live sessions.
- **The tenant-level tools will not guess a workspace.** `set_workspace_status`,
  `set_workspace_access`, `issue_workspace_password` and `delete_workspace`
  require an explicit slug and ignore `MAGIC_AI_BOT_WORKSPACE`, because
  inheriting a default there would mean archiving the wrong company.
  `delete_workspace` additionally wants the workspace's exact name in
  `confirmName`.
- **Prefer `set_workspace_status: "archived"` to `delete_workspace`.** Archiving
  blocks sign-in and keeps every record; deleting cascades through agents,
  catalogue, knowledge and its embeddings, uploaded files, channels, tools,
  contacts, conversations and orders, with no undo and no export.

## A first-run sequence that works

```
whoami
get_workspace
update_workspace   → description, industry, currency, facts
create_agent       → name, botName, role, routingDescription   (front desk is provisioned automatically)
update_agent       → status: "active"
create_product     → with requirementFields, so an enquiry comes out complete
add_knowledge      → the policies the agent must not invent
create_channel     → type "web", pointed at the front desk
chat_with_agent    → agent: "Front desk", and read handoffPath
list_channels      → copy the embed snippet into the site
```

## Adding a tool

Tools are thin wrappers over the Convex functions in `convex/`. To add one,
register it next to its siblings in `mcp/server.mjs` and call through the
`call.query` / `call.mutation` / `call.action` helpers so it picks up
authentication and token refresh. Keep the description written for a model
deciding whether to call it — that text is the whole interface.

One duplication to know about: `BUILTIN_TOOL_KEYS` in `server.mjs` mirrors
`BUILTIN_TOOLS` in `convex/lib/shared.ts`, because a `.mjs` file cannot import
the TypeScript source. Add a builtin tool in both places.
