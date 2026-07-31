# Open Finance — Agent Guide

Connect any MCP-capable agent (Hermes, OpenClaw, Claude Desktop, Cursor) or a
custom script. **Read-only by default. You control what it can read and write —
and you can change that anytime.**

## Quickstart (2 min)

1. App → Settings → Agents → "Connect your AI agent" (name, preset, expiry).
2. If the app detects your agent on this machine, use the tailored one-liner
   (or "Configure for me").
3. "Test it" to see the exact JSON your agent receives.
4. Ask: "summarize my finances" / "flag anything unusual" / "build a weekly report".

## Permissions

Read-only by default (summary + banking + budgets; investments are **not** in the
default but **can** be granted — in presets, chips, or when the agent asks).
Custom tokens add any read/write scopes, account allowlists, and `dev:ui`.
`GET /api/agent/capabilities` shows exactly what a token can do — and what's missing.

## Missing permissions

If a tool needs a scope the token lacks, the app returns:

```json
403 { "error": { "code": "insufficient_scope", "missing": ["read:investments"],
       "message": "This token (trading-bot) lacks read:investments. Ask the user to grant it in Settings → Agents." } }
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
`get_net_worth` · `get_budgets` · `get_budget_progress` · `get_planning_items` · `trigger_sync`

Opt-in: `set_transaction_category` · `create/update/delete_budget` ·
`upsert_planning_item` · `create/update/delete_category` · `update_settings` ·
`list/create/update/delete_custom_view`

## Example prompts

- "Summarize my finances this month and flag anything unusual."
- "Warn me if a transaction over $500 posts."
- "What does my 12-month projection look like? Any negative months?"
- "Add a widget to my dashboard showing spending by category this month."

## Security

- Read-only default; every call is logged (scope, tool, status) under Settings → Agents.
- Your agent can see your finances — treat its context and output accordingly.
- Revoke anytime; tokens expire on schedule.
