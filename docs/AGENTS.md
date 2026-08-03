# Open Finance — Agent Guide

Connect any MCP-capable agent (Hermes, OpenClaw, Claude Desktop, Cursor) or a
custom script. **Read-only by default. You control exactly what it can read and
write — and you can change that anytime.**

## Quickstart (2 min)

1. App → Settings → Agents → "Connect your AI agent" (name, preset, expiry).
2. If the app detects your agent on this machine, use the tailored one-liner
   (or "Configure for me").
3. "Test it" to see the exact JSON your agent receives.
4. Ask: "summarize my finances" / "flag anything unusual" / "build a weekly report".

## Access model

Your agent's access is capped by your settings (Settings → AI agent connection),
enforced on every request:

- **Tabs the agent can read** — Home, Accounts (includes investments),
  Activity, Budgets. Pick exactly the ones it may see; the rest are
  unreachable.
- **Smart categorization** — a separate toggle. Without it, the agent cannot
  auto-categorize expenses even if it has write access. When on, you also pick
  how far back it may categorize (1 month recommended, up to 1 year).
- **Global access** — one switch for read **and** write across the whole app.
  Each write still asks for your approval.
- **Permission requests** — anything out of scope creates a Grant/Deny request
  in your inbox, and every call lands in the audit log.

`GET /api/agent/capabilities` shows exactly what a token can do — including the
current access tiers — and what's missing.

## Missing permissions

If a tool needs a scope the token lacks, the app returns:

```json
403 { "error": { "code": "insufficient_scope", "missing": ["read:budgets"],
       "message": "This token (trading-bot) lacks read:budgets. Ask the user to grant it in Settings → Agents." } }
```

…and the app asks the user to grant it (Settings → Agents → permission requests).
You cannot grant yourself permissions — tell the user which scope you need.

## Endpoints

- MCP: stdio `node /abs/path/dist/mcp-cli.mjs --url <URL> --token <TOKEN>` or HTTP `<URL>/mcp`
- REST: `GET /api/agent/summary` (Bearer token) — full OpenAPI at `/api/openapi.json`
- Events: SSE `GET /api/agent/events` (includes `permission_requested`)

## Tools (annotated per token)

`get_financial_summary` · `get_capabilities` · `list_accounts` · `list_transactions` ·
`search_transactions` · `get_transaction` · `get_spending_by_category` · `get_cashflow` ·
`get_net_worth` · `get_budgets` · `get_budget_progress` · `get_planning_items` · `trigger_sync` ·
`list_uncategorized_transactions`

Opt-in: `set_transaction_category` · `create_budget`/`update_budget`/`delete_budget` ·
`upsert_planning_item` · `list_categories`/`create_category`/`update_category`/`delete_category` ·
`update_settings`

## Smart categorization

When the user enables **smart categorization**, use
`list_uncategorized_transactions` to find expenses with no category (or with a
generic name like "POS DEBIT"), then `set_transaction_category` for the ones you
are confident about. **Leave the gray-area ones alone** — the user categorizes
those manually. Only transactions within the user's chosen backlog window
(default 1 month) are returned, and the tool reports the window back to you.

## Managing budgets & categories (opt-in: budgets:write / categories:write)

A connected agent can build and maintain your budgets end-to-end. Typical flow:

1. `list_categories` → see `id`/`name` of categories available.
2. `create_budget { name, amountCents, categoryIds }` (cents, e.g. $400 = `40000`).
3. `get_budget_progress` → check spent / remaining / `overBudget` anytime.
4. `update_budget { budgetId, amountCents, ... }` when limits change, or
   `delete_budget { budgetId }` to remove one.

Example asks that work with a budget-enabled token (grant `budgets:write` +
`categories:write` + a read scope like `read:summary` in Settings → Agents):

- "Create a $400/month Groceries budget on the Groceries category."
- "I keep overspending on dining — raise my Food budget to $600."
- "Which of my budgets am I over this month, and by how much?"
- "Move my 'Coffee Shops' category under a new 'Coffee' budget."
- "Show me my top spending categories and propose three budgets that would help me save $200/month."

## Security

- Read-only default; every call is logged (scope, tool, status) under Settings → Agents.
- Your agent can see your finances — treat its context and output accordingly.
- Revoke anytime; tokens expire on schedule.

## The agent handbook — `GET /api/agent/guide`

Fetch it once at connect time (Bearer token, always available). It returns the
app map (every tab, its data, the endpoints + scopes), the money conventions,
per-task how-tos (summarize, budget, categorize, planning), the widget recipe,
the guardrail list, and when to refuse. `get_capabilities` points at it.

## Guardrails

You run under user-controlled rails (Settings → AI agent → guardrails):

| Rail | Default | You should know |
|---|---|---|
| Read-only by default | on | Writes are opt-in per tab. |
| Permission requests | ask | Out-of-scope calls create a Grant/Deny request. |
| Auto-approve reads within caps | off | When on, read requests the user already allows skip the inbox. |
| Confirm before destructive writes | on | Deletes may need the user's explicit OK first. |
| Audit log | on | Every call is recorded with tool, scope, status. |
| No account deletion | always | No scope exists — not removable. |
| No money movement | always | The app has no payment rails — never claim to move money. |

## Widgets (dev:ui)

With the `dev:ui` scope you can add native-looking cards to the user's
dashboard, budgets, and reports tabs. JSON only — no HTML/JS — the app renders
it with its own design tokens. Tools: `list_custom_views`,
`create_custom_view`, `update_custom_view`, `delete_custom_view`.

Kinds: `stat` (a figure + label) · `progress` (spent/limit bar) · `list`
(label/value rows) · `line` (a trend) · `donut` (a category breakdown). Fetch
the numbers with the read tools first — a widget only displays real data.
Names are unique per tab (update, don't recreate), and the user can remove
any widget inline — never re-add one they removed.

Example — a "spending this month" donut on the dashboard:

```json
{
  "tab": "dashboard",
  "name": "spending-this-month",
  "widget": {
    "kind": "donut",
    "title": "Spending by category — this month",
    "slices": [
      { "label": "Groceries", "valueCents": 41205 },
      { "label": "Dining", "valueCents": 18840 }
    ]
  }
}
```

UI changes happen as widgets only — never attempt to edit the app's code
through MCP. If the user wants a whole new feature, say so and offer a widget
meanwhile.
