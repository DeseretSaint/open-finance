# Open Finance — Developer Guide

Architecture, data model, and build/test workflow for Open Finance: a
self-hosted, open-source personal finance app. MIT licensed.

## Architecture

One Next.js codebase runs everywhere:

- **Desktop / hub** — the full app on your machine (Node + SQLite via
  better-sqlite3). Acts as the hub for paired phones.
- **Phone (solo)** — a Capacitor APK/PWA that runs the entire app
  on-device against a local SQLite database (cap-sqlite). No hub required.
- **Phone (paired)** — the same APK pointed at a hub URL over the LAN or
  Tailscale, with a device PIN lock.

The app is **generic**: no hardcoded URLs, no hosted backend. You bring
your own Plaid keys (or none — manual entry is first-class) and your own
AI agent (or none).

## Key modules

| Path | Responsibility |
|---|---|
| `src/server/db/` | `Db` interface + two implementations: `adapter.ts` (better-sqlite3, server) and `cap-sqlite.ts` (phone). Identical SQL runs on both. |
| `src/server/domain/` | Business logic: accounts, categories, transactions, budgets, summary, reports, planning, projection, notifications, device lock, agent prefs. |
| `src/lib/solo-router.ts` | In-process API router for the standalone phone build — serves the same `/api/*` routes the server does, backed by cap-sqlite. |
| `src/server/authz/` | Agent tokens, scopes, permission requests, audit log. |
| `src/server/mcp/` | MCP server exposing finance tools to your agent (read-only by default). |
| `src/server/plaid/` | Plaid client adapters: `real.ts` (server REST), `native.ts` (phone proxy plugin). |
| `src/app/(app)/` | The app UI: dashboard, accounts, transactions, budgets, settings. |
| `src/components/` | Shared UI, onboarding wizard, device-lock gate. |
| `migrations/` | Versioned SQL migrations (001+, applied on both runtimes). |

## Data model

- `users`, `user_settings` — identity + preferences (including agent access tiers).
- `accounts` — bank/cash/investment accounts (Plaid-linked or manual).
- `transactions` — Plaid-synced or manual rows. Sign convention: income is
  **positive** (money in), expenses are **negative** (money out).
- `categories`, `budget_categories` — user categories and budget membership.
- `budgets` — per-period spending limits.
- `plaid_items`, `plaid_credentials` — encrypted Plaid state (server).
- `agent_tokens`, `permission_requests`, `audit_log` — agent authz.
- `sessions`, `device_lock` — auth + phone PIN/biometric unlock.
- `balance_history`, `notifications`, `push_subscriptions` — history and alerts.

All secrets (Plaid keys, access tokens) are AES-256-GCM encrypted at rest
with a user-supplied `ENCRYPTION_KEY`.

## Money convention

Income = positive/green, expenses = negative/red — matching bank apps.
Plaid amounts are negated at ingest (Plaid sends debits as positive).
Migrations `005`/`006` flipped historical data accordingly; new code must
follow: income `> 0`, expense `< 0`.

## Agent access model

- **Read-only by default.** A token's effective scopes = token scopes ∩ the
  user's access caps (per-tab read selection + global toggle), enforced on
  every request in `agent-auth.ts`.
- **Per-tab read toggles** — Home, Accounts, Activity, Budgets.
- **Smart categorization** — a separate toggle; without it the agent cannot
  auto-categorize expenses, even with write access (enforced in the MCP tool).
- **Global access** — one switch for read **and** write everywhere; each
  write still asks for approval.
- Permission walls create Grant/Deny requests in the inbox; everything is
  audited.

## Build & test

```bash
pnpm install
pnpm typecheck   # project-wide TS (the truth for @/ alias resolution)
pnpm lint        # eslint
pnpm test        # vitest suite (server + domain + migrations)
pnpm build       # production build
node scripts/build-mobile.mjs  # static export for the phone bundle
```

Tests use relative dates (month-start helpers) so the suite never flakes at
month boundaries. Migration files are bundled for the phone via
`scripts/gen-migrations-bundle.mjs`; a test asserts the bundle matches the
migrations directory byte-for-byte.

## Release

- CI (`android.yml`) builds the standalone APK on every push to `main`.
- Releasing is a tagged GitHub release with the APK attached; the app's
  Settings page shows the version from `NEXT_PUBLIC_APP_VERSION`, which
  always matches `package.json`.
