# Open Finance — Developer Overview

> How the app works, how the code is organized, and how to build, test, and extend it.
> For the product pitch and quickstart, see the [README](../README.md).

---

## 1. Product at a glance

A self-hosted, open-source personal finance app:

- **Runs anywhere, independently** — three deployment shapes from one codebase:
  **desktop solo** (local server + browser/PWA), **hub** (desktop as server your phone syncs to),
  **phone solo** (Android app with a fully on-device backend).
- **Bring your own Plaid keys — or none.** Real bank connections use the user's own free Plaid
  Sandbox/Trial keys; a first-class manual-entry path means the app is fully usable with no Plaid at all.
- **Bring your own agent (BYOA).** Any MCP-capable agent (Hermes, OpenClaw, Claude Desktop, Cursor)
  can connect with tiered, least-privilege permissions — read-only by default, every scope grantable,
  and the app asks the user before an agent looks anywhere it isn't allowed.
- **Planning.** Bills, debts, savings & investment goals, and a transparent 12-month projection.
- **Identity done right.** Username + separate display name, session-duration picker
  (including "Forever (not recommended)"), per-session revocation, biometric/PIN unlock on mobile.

---

## 2. Architecture

```
                        ONE CORE (shared, 100% reused)
┌────────────────────────────────────────────────────────────────────┐
│  UI  (React 19, shadcn/ui, design tokens)                          │
│  API (Next.js Route Handlers, REST + zod, error envelopes)         │
│  DOMAIN (pure TS: ingest, categories, budgets, reports, planning,  │
│          projection, financial summary, manual-entry)              │
│  DATA (ONE SQLite schema; async SQL module: same SQL everywhere)   │
│  AUTH (session-cookie impl | device-lock impl — same abstraction)  │
│  PLAID (adapter → server SDK | native plugin+LinkKit | hub REST)   │
│  BYOA (MCP, tiered authz + permission requests, agent detection,   │
│        events, OpenAPI, AGENTS.md)                                 │
│  CONNECT (hub detect: LAN IP + Tailscale; QR pairing; diagnostics) │
└────────────────────────────────────────────────────────────────────┘

SHAPE 1 · DESKTOP-SOLO          SHAPE 2 · HUB (desktop-as-server)
Next.js server on localhost     Same app; Connection Assistant sets
SQLite file ~/.open-finance/    bind + URL (LAN IP or Tailscale name)
Launcher → browser/PWA window   Phone APKs connect via QR pairing
BYOA: local MCP (localhost)     BYOA: MCP on hub (localhost/LAN/Tailscale/TLS)
SHAPE 3 · PHONE-SOLO
Capacitor APK, no server
Native Plaid proxy + LinkKit plugin (Kotlin) + Keystore keys
cap-sqlite local DB · device_lock (PIN/biometric) · manual entry works
BYOA-lite: "Share to agent" JSON
```

### Design rules (non-negotiable)

1. **Plaid calls only from a secret-holding process** — the Node server (shapes 1–2) or the native
   Android plugin (shape 3). The browser/webview never sees a Plaid secret.
2. **Secrets encrypted at rest** with AES-256-GCM, even inside the local SQLite file.
3. **Zero external services required** — no cloud, no email provider, no Redis.
   `docker compose up` = one container; phone-solo = zero containers.
4. **BYOA least privilege** — read-only default; every scope grantable; all agent calls audited.
5. **Every shape works fully standalone.** Hub mode exists only for multi-device same-data.
6. **SQLite everywhere, one schema, one SQL module.** The same SQL strings run on the server
   (`better-sqlite3`) and on Android (`cap-sqlite`) behind one async adapter interface
   (`{ all, get, run, transaction }`). This is why there is no ORM: an ORM would be a second
   implementation to keep in sync with the SQL the phone executes.

---

## 3. Tech stack (pinned — exact versions, no `@latest`)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 22 LTS | `engines.node = ">=22 <23"`; Docker `node:22-bookworm-slim` |
| Web | Next.js 15.5 (App Router, `src/`) · React 19 · TypeScript strict | `output: 'standalone'`, `serverExternalPackages: ['better-sqlite3']` |
| Styling | Tailwind CSS v4 + shadcn/ui | tokens in `src/app/globals.css` (see `docs/DESIGN.md`) |
| Data | better-sqlite3 12.x (server) / cap-sqlite (Android) | raw SQL + `PRAGMA user_version` migrations |
| API | REST + zod | error envelope `{ error: { code, message } }` |
| Auth | hand-rolled sessions (bcryptjs cost 12) | session tokens hashed at rest |
| Mobile | Capacitor 7.7 (Android) + native Kotlin Plaid proxy + Plaid LinkKit | CI-built APK |
| Agent | `@modelcontextprotocol/sdk` 1.10.x (stdio + Streamable HTTP) | MCP + REST + SSE + OpenAPI |
| Charts/PWA | Recharts v2 · Serwist 9 (desktop-local) | |
| Testing | Vitest + Testing Library · Playwright | gates in CI |
| CI/CD | GitHub Actions · Docker · gitleaks · Dependabot | |

**Pinning rule:** exact versions in `package.json` (`.npmrc` sets `save-exact=true`),
lockfile committed, `packageManager` + corepack configured. Floating versions = drift.

---

## 4. Repo layout

```
open-finance/
├── migrations/                # numbered .sql + up.js runner (PRAGMA user_version)
├── scripts/                   # seed.js, start.sh, start.bat, screenshots, og-crop
├── docs/                      # DESIGN.md · AGENTS.md · build-references/*
├── site/                      # static HTML+CSS microsite (no build step)
├── src/
│   ├── app/                   # pages + API route handlers
│   │   ├── globals.css        # ★ design tokens
│   │   ├── (app)/dashboard|accounts|transactions|budgets|plan|reports|settings|agents/
│   │   └── api/               # REST routes
│   ├── components/            # ui/ (shadcn) + feature components + custom-views/
│   ├── hooks/                 # queries, preferences, theme, pairing, session, detection
│   ├── lib/                   # env, crypto, rate-limit, api, copy, money, sessions
│   ├── server/
│   │   ├── db/                # adapter.ts, schema.sql
│   │   ├── domain/            # ingest, categories, budgets, reports, planning, projection, summary, manual-entry
│   │   ├── plaid/             # adapter.ts + server-impl.ts (+ native-impl in android/)
│   │   ├── authz/             # agent-auth.ts, route-registry.ts, permission-requests.ts
│   │   ├── detect/            # hub-detect.ts, agents-detect.ts
│   │   └── mcp/               # index.ts, tools.ts, prompts.ts, resources.ts, mcp-cli.mjs
│   └── auth/                  # AuthProvider abstraction (session-cookie | device-lock)
├── android/                   # Capacitor + PlaidProxyPlugin.kt + cap-sqlite adapter
├── docs/build-references/     # working snippets for high-drift areas (copy, don't invent)
└── agent-manifest.json        # machine-readable BYOA self-description
```

---

## 5. How it works end-to-end

### 5.1 Data & storage

- **One SQLite schema** across desktop, hub, and phone. Money is stored as **integer cents**.
  Timestamps are ISO-8601 UTC. APR is basis points (6.5% → 650).
- Core tables: `users`, `sessions`, `device_lock` · `plaid_credentials`, `plaid_items`,
  `accounts`, `balance_history`, `transactions` · `categories`, `budgets`, `budget_categories`,
  `user_settings` · `bills`, `debts`, `goals` · `agent_tokens`, `agent_access_log`,
  `agent_permission_requests`, `custom_views` · `pairing_codes`.
- **Ingest rules** (the correctness contract):
  - Upsert on `plaid_transaction_id` — when a pending transaction posts, Plaid returns the same
    id, so the row is updated, never duplicated.
  - Amounts normalized to cents, positive = money in (sign flipped per account type at ingest).
  - Every sync upserts one `balance_history` row per account (net-worth over time).
  - Category matching: exact Plaid personal-finance category → longest `category_path` prefix →
    user override → "Uncategorized".
  - Budget math counts posted, non-excluded transactions in the period.
  - **Manual rows** (`source='manual'`, `plaid_transaction_id NULL`) are validated, default to
    "Uncategorized", and are never touched by sync.
- Migrations are numbered SQL files applied by `migrations/up.js` via `PRAGMA user_version`.

### 5.2 Identity & sessions

- `username` is the login id (unique, case-insensitive); `display_name` is separate and freely
  changeable; email is optional.
- Sessions are a DB table; session tokens (`of_sess_…`) are stored as SHA-256 hashes only.
  Per-login durations: 1h / 1d / 7d / 30d / **forever** (no expiry + 90-day idle auto-revoke;
  labeled "not recommended"). Cookies: HttpOnly, SameSite=Lax, `Secure` only over https.
- CSRF: SameSite=Lax + a custom `x-of-request: 1` header on mutations.
- Rate limits keyed by IP+username (NAT-safe) on login/register/password/sessions.
- **Solo mode** has no server: display name only, password optional, plus a **recovery code**
  (hashed at rest) so a forgotten password/PIN never locks the data.
- **Mobile unlock** (`device_lock`): PIN verified with PBKDF2-SHA256 (100k iterations) locally,
  biometric via the system prompt, 5-fail lockout with doubling timeouts, re-lock policy.

### 5.3 API

REST + zod, same surface on hub and localhost. Route groups: auth · health · hub (detect/apply/
diagnostics) · pairing · plaid · accounts · transactions · categories · budgets · planning ·
reports · data (export/backup) · settings · BYOA (summary, events, capabilities, requests,
agents-detect, custom-views, MCP) · webhook. Full OpenAPI is generated from the zod schemas at
`/api/openapi.json`.

### 5.4 Sync & Plaid

- Plaid calls go through an adapter interface with two implementations: the server SDK (shapes
  1–2) and the native Kotlin plugin + LinkKit (phone-solo). The webview never talks to Plaid.
- Sync is cursor-based and incremental; a 12h node-cron job plus a manual "Refresh" button.
  An optional signature-verified webhook endpoint exists for self-hosters with public URLs.

### 5.5 BYOA (Bring Your Own Agent)

- **MCP server** with stdio (`node dist/mcp-cli.mjs --url … --token …`) and Streamable HTTP
  (`/mcp`), plus REST (`/api/agent/summary`), SSE events, and the OpenAPI doc.
- **Scopes** (`domain:action`): read per domain (summary/banking/investments/budgets/planning/
  reports) × account allowlists; write per domain (transactions/budgets/planning/categories/
  settings/sync); `dev:ui` (custom dashboard widgets for chosen tabs). **Read-only by default —
  the user controls every read & write scope, including investments, anytime.**
- **Presets:** read-only (default) · read-all · read-write · custom. Scopes are enforced in
  REST middleware (route registry) and filtered in the MCP tool list; `withAllowlist` filters
  inside every domain query so allowlists apply to summaries, reports, and net-worth too.
- **Permission requests:** when an agent calls something outside its scopes it receives
  `403 { error: { code: "insufficient_scope", missing: [...] } }` and the app asks the user to
  Grant or Deny (deduped per token+scope, capped, audited).
- **Agent detection:** `GET /api/agents/detect` probes for common agents on the hub machine
  (read-only: `which` + config-file existence; never executes binaries, never reads secrets)
  and offers tailored one-liners or a consent-gated "Configure for me" with backup + remove.
- **Custom views (`dev:ui`):** agents can add declarative JSON widgets (stat/table/chart/
  progress/text) to the dashboard, budgets, and reports tabs. Widgets render under the user's
  own session against an endpoint allowlist — no JS/HTML execution, no new data path.

### 5.6 Planning & projection

- `bills` (rent/utilities/one-time; frequencies; variable bills remember last paid amount),
  `debts` (APR, min payment, amortization), `goals` (savings/investment × general/specific,
  with or without a target date, auto monthly contribution).
- `GET /api/reports/projection` projects 12 months: current balance + average income
  (last 3 full months) − scheduled bills (period-aware) − debt minimum payments − goal
  contributions; flags months below zero (danger) or below one month of expenses (warning),
  and shows an emergency-fund insight. Always labeled an estimate — "all things constant".

### 5.7 Connectivity (Connection Assistant)

Hub setup is an in-app wizard, not config editing: one question — *Same Wi-Fi / Anywhere
(Tailscale) / I have a domain* — then auto-detect LAN IP or Tailscale MagicDNS, generate the
QR, and provide a "Can't connect?" diagnostics card. Pairing codes are 10-minute, single-use,
hashed. Phone connected mode is **read-only offline** (writes show "Connect to hub to edit").
PWA install works on localhost only (service workers require a secure context); hub/web uses
app-level offline caching instead.

---

## 6. Security model

- AES-256-GCM envelope encryption for all secrets (`ENCRYPTION_KEY` env, AAD = userId:recordId).
- Sessions: hashed tokens, revocable per session or all, "forever" has an idle timeout.
- BYOA: least privilege, allowlists, audit log per call (scope used, tool, status), token
  hashes at rest, `of_`/`of_sess_` patterns in gitleaks.
- Web: security headers + CSP, zod at every boundary, parameterized SQL only, no raw HTML.
- Docker: non-root, read-only rootfs where practical, healthcheck, env-only secrets.
- See [`SECURITY.md`](../SECURITY.md) for the disclosure policy.

---

## 7. Build, test, run

Prerequisites: Node 22 LTS, pnpm 11 (corepack), Docker (optional), GitHub `gh` CLI.

```bash
pnpm install                       # exact-pinned deps (--frozen-lockfile in CI)
node migrations/up.js              # create/migrate SQLite
node scripts/seed.js --seed-date 2026-01-01   # demo data (pinned for stable screenshots)
pnpm dev                           # dev server on http://localhost:3000

pnpm lint && pnpm typecheck        # static checks
pnpm test                          # vitest unit + integration
pnpm build                         # production build (standalone output)
pnpm e2e                           # Playwright (needs CI_PLAID_CLIENT_ID/SECRET for sandbox flow)
pnpm screenshots                   # screenshot suite (light/dark, desktop/mobile)

pnpm audit --prod                  # dependency audit
npx gitleaks git --redact          # secret scan
npx @google/design.md lint docs/DESIGN.md   # token/contrast validation

# Docker
docker compose up -d               # app + SQLite volume (one container)
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d  # + Caddy TLS

# Android APK — built in CI (release.yml); local builds optional via Android Studio
```

**"Green" gate** (every phase and every PR): `pnpm lint && pnpm typecheck && pnpm test &&
pnpm build && pnpm e2e` all pass + screenshots captured. No phase advances on red.

Environment variables: see [`.env.example`](../.env.example) (required: `ENCRYPTION_KEY`,
`AUTH_SECRET`; optional: `DATABASE_PATH`, `BIND_ADDRESS`, `PUBLIC_URL`, `DEMO_MODE`,
`SEED_DATE`, `WEBHOOK_SECRET`, `CAP_SERVER_URL`, `DEFAULT_AGENT_SCOPE`).

---

## 8. Development milestones

The build is executed in gated phases; each must pass the §7 gate before the next starts.
The current milestone is **P0 — scaffold & foundation** (repo skeleton exists; app code starts here).

| Phase | Deliverable |
|---|---|
| P0 | Scaffold, build-references, SQL module, design tokens, Docker/CI |
| P1 | Identity & sessions (durations, revocation, recovery, device lock) |
| P2 | Plaid integration + onboarding walkthrough |
| P3 | Sync engine + transactions + categories + manual entry |
| P4 | Budgets + reports + dashboard |
| P5 | Planning module (bills/debts/goals/projection) |
| P6 | Polish-readiness: demo, empty states, PWA, Connection Assistant, backup/restore, release infra |
| P7 | BYOA (authz, MCP, permission requests, agent detection, Agents UI) |
| P8 | Mobile: connected mode (QR pairing, device lock) then solo mode (native proxy, LinkKit) |
| P9 | Visual polish pass (design tokens + component refinement) |
| P10 | Verification, security checklist, SEO pass, release |

Contributing guidance, commit conventions, and review expectations live in
[`CONTRIBUTING.md`](../CONTRIBUTING.md). Design rules live in [`DESIGN.md`](DESIGN.md);
the BYOA agent manual lives in [`AGENTS.md`](AGENTS.md).
