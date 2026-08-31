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
an **admin** (email + password) to reach every workspace.

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

## Running it

```bash
bun run mcp          # or: node mcp/server.mjs
```

It exits immediately with a readable message if it cannot sign in, so a bad
config shows up when the client connects rather than on the first tool call.

### Claude Code

`.mcp.json` in the repo root already registers it for this project — no
secrets in it, because the server reads `.env.local` itself. Run
`claude mcp list` to confirm it connected.

### Claude Desktop / other clients

```json
{
  "mcpServers": {
    "magic-ai-bot": {
      "command": "node",
      "args": ["C:/development/magic-ai-bot/mcp/server.mjs"],
      "env": {
        "MAGIC_AI_BOT_CONVEX_URL": "https://your-deployment.convex.cloud",
        "MAGIC_AI_BOT_USERNAME": "your-workspace-slug",
        "MAGIC_AI_BOT_PASSWORD": "…"
      }
    }
  }
}
```

Use an absolute path — clients do not run from the repo directory.

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
