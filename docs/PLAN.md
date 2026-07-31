# Open Finance — Master Build Plan (v5)

> **Goal:** Ship a free, open-source, self-sovereign personal finance app that **runs anywhere** — solo on a desktop, solo on a phone, or as a desktop "hub" your phone securely syncs to — with Plaid (bring your own keys) **or without Plaid at all** (manual entry). Headline features: **Bring Your Own Agent (BYOA)** with tiered permissions you fully control — *read-only by default; you decide what it can read and write, including investments, anytime* — plus an **in-app Connection Assistant** (one question, three cards: same Wi-Fi / anywhere via Tailscale / public domain), agent **auto-detection** on your machine, a **Plan module** (bills/debts/goals/projection), and identity done right (username + display name, session picker incl. "Forever (not recommended)", biometric/PIN). Repo: `github.com/DeseretSaint/open-finance`. Built one-shot by a two-model AI pipeline: **DeepSeek builds the fundamentals, Kimi K3 does only the beauty pass.**
>
> **The "Go" moment:** this plan (v5) is the audited, wired, final contract. Say go → Appendix A briefs run in order (DeepSeek P0→P8b, then Kimi K3, then verification) → release. Nothing left to invent mid-build.

---

## 1. Product Principles

- **You own your data.** SQLite file on *your* machine or *your* hub. We run nothing.
- **You own the pipe.** Paste your own free Plaid keys — or skip Plaid entirely; manual entry is first-class.
- **You own your agent.** Read-only by default; you control every read and write permission, including investments; your agent asks before it looks anywhere.
- **You own your plan.** Bills, debts, goals, and an honest projection of your standing.
- **Runs anywhere, independently.** Every shape works alone. Hub mode exists only for multi-device same-data — paired by QR, on your Wi-Fi today, on Tailscale from anywhere.
- **Zero-friction onboarding.** Demo in 10s, real banks in <5 min (or none at all), your agent in 2 min, your plan in 5 min.
- **Beautiful, gently customizable.** Calm premium fintech; accent and more changeable in Settings; design contract fixed so the build never improvises.
- **Discoverable.** SEO README + microsite so "open source personal finance app / self-hosted budgeting / bring your own Plaid keys / finance MCP agent" surfaces in searches.

---

## 2. What Changed v4.1 → v5 (audit-driven)

| # | Change | Source |
|---|---|---|
| 1 | **BYOA copy reframed**: "read-only by default — you control read & write limits and permissions" everywhere; investments are *grantable, not excluded* | User feedback |
| 2 | **Agent auto-detection**: `GET /api/agents/detect` scans the machine for Hermes/OpenClaw/Claude Code/codex/cursor/opencode + config markers; tailored one-liners; optional consent-gated "Configure for me" (backup + remove) | User feedback |
| 3 | **Connection Assistant** replaces .env editing: Settings → Hub → one question (Same Wi-Fi / Anywhere-Tailscale / domain) → auto-detect LAN IP + Tailscale MagicDNS → QR → "Can't connect?" diagnostics. Solo↔hub switching is a Settings action, not a reinstall | Product audit P0-1 + user Tailscale ask |
| 4 | **No-Plaid path**: minimal manual account + transaction entry (tables existed; schema now allows manual rows). Demo branch already first-class | Product audit P0-3 |
| 5 | **Offline honesty**: connected mode = read-only offline, writes blocked with "Connect to hub to edit" toast; copy in pairing flow | Product audit P0-2 |
| 6 | **Marketing demo fixed**: microsite = interactive mock + screenshots (+ optional 60s video); full seeded demo only in-app post-install | Product audit P0-4 |
| 7 | **Solo profile friction removed**: display name only; password optional until hub/remote enabled; **recovery code** printed at setup (stored in data dir) so a forgotten password/PIN never locks data | Product audit P1-5/P1-6 |
| 8 | **dev:local deferred to v1.1** (agent code edits + branch review UI); **dev:ui custom views ship in v1** (that's the "rewrite specific tabs" capability, safely) | Product audit P1-7 (risk cut; flagged in §21 for veto) |
| 9 | **Version pins everywhere** (Next 15.5, Capacitor 7.7, serwist 9, MCP SDK 1.10, better-sqlite3 12.x for Node 22, packageManager/corepack) — no `@latest` anywhere | Build audit P0-1 |
| 10 | **`docs/build-references/` committed before build** (working snippets: MCP streamable-HTTP, Kotlin plugin skeleton, cap-sqlite adapter, serwist config, next.config `serverExternalPackages`, QR pairing) — "copy from reference, don't invent" | Build audit P0-2 (biggest de-risk) |
| 11 | **P8 split into P8a (connected mobile: QR+webview+device-lock) then P8b (solo native)** with hard token budget + kill criteria → connected-only v1.0; **native Plaid LinkKit in the Kotlin plugin** (react-plaid-link in a webview is unsupported); CI-only Android verification (setup-java 21 + emulator runner; host has no Android SDK) | Build audit P0-5 |
| 12 | **MCP one-liner fixed**: v1 = `node /abs/path/dist/mcp-cli.mjs` (npm publish deferred to v1.1) | Build audit P0-4 |
| 13 | **Branch protection applied at P10**, not before (keeps the one-shot push flow unblocked) | Build audit P0-3 |
| 14 | **Wiring Matrix (Appendix J)**: table→consumers, endpoint→scope route registry, MCP tool registry, phase→deliverable→gate + a **registry-completeness test** in CI (no orphans/dead ends, mechanically) | User wiring audit + §12 |
| 15 | **PWA truth**: service workers need a secure context → launcher always opens localhost; PWA = desktop-local install; hub/web = no SW; phone offline reads come from app-level cache | Build audit P1-7 |
| 16 | **P7 split into P7a (authz+MCP+registry+detection) / P7b (Agents UI)**; token budget +30–40% contingency, `tail -50` failure reporting, 5-fix-loop cap then escalate, deepseek-reasoner allowed for P7/P8 | Build audit P1-12 |
| 17 | **Ops fixes**: one-click SQLite backup download + restore · variable bills (last paid amount remembered) · NAT-safe rate limiting (IP+username) · pairing TTL 10 min single-use · microsite as static HTML (no Next export) · `SEED_DATE` pin · og:image 1200×630 crop · .npmrc/.gitleaks.toml/gradle wrapper hygiene | Build + product audits |
| 18 | **Explicit v1.1 backlog**: transaction splitting, budget rollover, dev:local, npm publish, CSV import | Product audit P1-10/P2-13 + build P0-4 |

---

## 3. Architecture — Three Deployment Shapes, One Core

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

**Non-negotiables:** Plaid calls only from a secret-holding process (Node server shapes 1–2, native plugin shape 3) · secrets AES-256-GCM at rest even in local SQLite · zero external services required · BYOA least-privilege read-only default, every scope grantable · every shape fully standalone · **no env-file editing to change modes — it's a Settings action**.

### Decision Log (v5 additions bolded)

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Sessions | Hand-rolled DB sessions table | NextAuth JWT; JWT+denylist | Per-login duration + per-session revoke + logout-all |
| Login id | username (case-insensitive) + display_name + optional email | email-as-login | Display identity decoupled from credentials |
| **Solo auth** | **display name only; password optional until hub/remote; recovery code in data dir** | mandatory password everywhere | localhost threat model is ~zero; never lock the user out |
| Mobile unlock | PIN (PBKDF2 100k) + biometric; WebAuthn v1.1 | WebAuthn v1 | Native, low-risk |
| BYOA authz | Granular scopes + account allowlists + presets | boolean read/read_write | Degrees of access |
| BYOA permission requests | structured `insufficient_scope` + in-app Grant/Deny + dedupe | silent deny; auto-grant | Agent asks → user decides |
| BYOA dev tier | **dev:ui custom views in v1; dev:local audited code edits v1.1** | both v1; free execution | dev:local = riskiest/novelty surface; defer per audit |
| **Agent detection** | **`/api/agents/detect` (read-only, no exec, no secrets) + optional consent-gated auto-config w/ backup** | blind connect instructions | "Try to auto-detect any agents/models on the machine" |
| **Connectivity** | **Connection Assistant: LAN / Tailscale / domain; detect → QR → diagnostics** | env editing; TLS-only | Hub setup must be a product, not a doc |
| **No-Plaid path** | **manual account + transaction entry (v1); CSV import v1.1** | Plaid-gate | Lowest barrier; Monarch/YNAB both allow manual |
| Planning | bills/debts/goals + linear projection | forecasting engine | Transparent, explainable |
| Data layer | SQLite everywhere, one SQL module | Prisma+Postgres | One schema across 3 shapes |
| Plaid on phone-solo | **Native proxy + LinkKit (Kotlin)** | browser Plaid Link in webview (unsupported) | Only correct server-less path |
| **PWA** | **launcher opens localhost (SW works); hub/web = no SW; app-level offline cache** | SW on LAN/Tailscale http | Service workers require secure context |
| Agent integration | MCP + REST + SSE + OpenAPI | agent-specific SDKs | Hermes, OpenClaw, Claude Desktop, Cursor, curl |
| **Versions** | **pinned exact (Next 15.5, Capacitor 7.7, Node 22, better-sqlite3 12.x…)** | @latest | Drift = one-shot failure |
| Discovery | SEO README + topics + static GH Pages microsite + og:image + launch checklist | Next-export microsite (incompatible) | Search presence, cheap |

---

## 4. Tech Stack (pinned — no `@latest` anywhere; `packageManager` + corepack set)

```
RUNTIME: Node 22 LTS (host has 22.22) — Docker node:22-bookworm-slim both stages

CLIENT (all shapes)
├── Next.js 15.5.x (App Router, src/) + React 19 + TypeScript strict
├── Tailwind CSS v4 + shadcn/ui
├── TanStack Query v5 (+ persistence → app-level offline reads in connected mode)
├── Recharts v2 · cmdk · qrcode (+ @types/qrcode) · jsqr (scan) · archiver (export zip)
├── @plaid/react-plaid-link (web/connected mode only)
├── Serwist 9.x (PWA: manifest + app-shell; desktop-local only, see §16)
├── Capacitor 7.7.x family (@capacitor/core, cli, android + preferences, biometrics,
│   local-notifications, status-bar, splash-screen, app) + @capacitor/assets
└── Android native: Plaid proxy plugin (Kotlin, OkHttp, EncryptedSharedPreferences)
    + Plaid LinkKit (native Link — phone-solo)

SERVER (shapes 1–2: Next.js Route Handlers)
├── Hand-rolled sessions auth (bcryptjs 12; session tokens hashed at rest)
├── better-sqlite3@12.x (Node 22 prebuilds) + zod
├── plaid (official Node SDK) · node-cron (12h sync)
├── @modelcontextprotocol/sdk@1.10.x (MCP, stdio + Streamable HTTP)
└── in-memory rate limiter (small helper, no dep)
   next.config.ts: output:'standalone', serverExternalPackages:['better-sqlite3']

SHARED DOMAIN (pure TS, no platform imports)
├── ingest · categories · budgets · reports · planning · projection · summary · manual-entry
├── db adapter { all/get/run/transaction } → better-sqlite3 | cap-sqlite (same SQL, async)
├── authz: token→scopes→allowlist (withAllowlist) + permission-request service
└── detect: hub-detect (tailscale/os.networkInterfaces) + agents-detect (which/config probes)

DEV TOOLS
├── Vitest + Testing Library · Playwright (retries:2; workers:1 on sandbox e2e)
├── ESLint 9 flat + Prettier · GitHub Actions (ci/release/pages; setup-java 21 + android-emulator-runner)
└── Docker multi-stage non-root · @google/design.md (lint in CI)
```

**Version pinning rule:** exact versions in `package.json` (`save-exact=true` in `.npmrc`), `engines.node = ">=22 <23"`, lockfile committed. **Build references:** `docs/build-references/` committed before P1 with working snippets (see Appendix L) — agents copy, never invent.

---

## 5. Design System — "Calm Fintech" (unchanged contract + new surfaces)

> Appendix B is the full DESIGN.md token spec (linted in CI via `@google/design.md`). DeepSeek implements the token baseline; Kimi K3 refines **values only** in a fixed file list. Nobody invents a design during the build.

**Aesthetic:** *Monarch's calm × Linear's precision. Warm paper-white (light) / near-black (dark). One accent (default emerald `#10B981`). `rounded-2xl` cards, hairline borders, Inter + tabular-nums for money, 150ms ease-out motion, number-tween balances, skeleton shimmer. Charts share the token palette.*

**Customization (Settings → Appearance):** theme light/dark/system · accent 8 presets + custom hex (charts auto-harmonize) · density · radius · reduce motion · theme JSON export/import.

**Component inventory:** app-shell (Dashboard, Accounts, Transactions, Budgets, Plan, Reports, Settings, Agents) · stat-card · account-card · transaction-row · budget-card + ring · bill-row, debt-card, goal-card, projection-chart, upcoming-bills-digest · charts · empty-state · skeleton · toast · modal · command palette · appearance panel · Agents panel (preset cards, scope chips, account picker, capability sentence, permission-request inbox, audit viewer) · **connection-assistant (hub setup wizard)** · **agent-detection cards** · **hub settings/diagnostics** · **backup/restore panel** · widget-renderer.

**Copy rules (audit P1-8):** user-facing copy says "Connect your AI agent" (expand BYOA/MCP once); permissions copy is *"Read-only by default. You control what your agent can read and write — change it anytime."* Never "cannot access investments" as a limitation; grants are one toggle away.

**A11y baseline:** AA contrast (linted), focus rings, reduced-motion, tabular-nums, semantic HTML, `aria-live` balances.

---

## 6. User Flows

### 6.1 First run — pick your shape
- **Desktop**: "Install locally" (launcher → localhost; display-name only, password optional) or "Host for my phone (hub)" → **Connection Assistant**.
- **Phone**: "Use on this phone only" (solo) or "Connect to my hub" (scan QR / enter URL).

### 6.1b Connection Assistant (hub setup — replaces all env editing)
Trigger: first-run "Host for my phone" or Settings → Hub → "Change how my phone connects".
1. **One question, three cards**: ① Same Wi-Fi only · ② Anywhere — away from home · ③ I have a domain / I'm technical (Caddy/Cloudflare docs link).
2. **Detect** (`GET /api/hub/detect`, session-auth): ② → try `tailscale status`/`tailscale ip -4` → MagicDNS name (`http://<machine>:3000`); ① → `os.networkInterfaces()` non-internal IPv4 → `http://192.168.x.x:3000`. Tailscale absent on ② → inline `tailscale up` + "Check again" + manual name fallback.
3. **Apply**: hub mode on (bind 0.0.0.0 + saved URL); "Apply & restart" once (launcher handles); switching modes is a Settings action forever after.
4. **Connect**: QR encodes `<url>/pair?code=…` (10-min TTL, single-use, hashed) + "Show URL / Copy / Type it" for QR-less phones; phone stores last URL + "Reconnect" deep link.
5. **"Can't connect?" diagnostics card**: hub IP, port, bind status, Tailscale up/down, "Copy diagnostics".

### 6.2 Onboarding — demo-first + no-Plaid branch
`LANDING → [Try the live demo (10s)] [Sign up] [Sign in]`
- Demo mode: seeded 3 months data incl. bills/goals/debts (SEED_DATE-pinned for stable screenshots).
- **"Skip Plaid for now" is first-class**: continue with manual entry; add Plaid keys anytime in Settings.
- Plaid path (4-step walkthrough w/ screenshots + **"Test connection"** live check + sandbox-first `ins_109512`, `user_good`/`pass_good`).

### 6.3 Identity & sessions
- Sign up: username (3–32, lowercased) + display name + password (10–72 bytes, bcrypt 12) + optional email.
- **Solo**: display name only; password optional until hub/remote; **recovery code** shown once + stored in data dir (resets password/PIN without data loss).
- Sign in: username + password + "Stay signed in for: 1h / 1d / 7d / 30d / Forever (not recommended)".
- Settings → Security: sessions list (revoke any / log out all), change password (revokes others), change username (password required, sessions kept), fingerprint/face + PIN on mobile.

### 6.4 Core flows
Dashboard (net worth, accounts, recent, upcoming-bills digest, budget strip, donut) · Transactions (filters, search, ⌘K, pending chip, edit category/note/exclude, **manual add**) · Accounts (**manual create**, link Plaid item) · Budgets (CRUD + rings) · Plan (bills incl. variable w/ last-paid autofill, debts amortization, goals, projection w/ flags + emergency-fund insight) · Reports · Settings (Plaid keys + test, Appearance, Hub, Agents, sync interval, **Backup & Restore**, export, delete my data).

### 6.5 BYOA flow (Settings → Agents)
1. **Agent detection runs automatically**: "We found on this machine: Hermes ✓ · Claude Code ✓" → tailored one-liners (localhost URL when same machine) · "Configure for me" (consent-gated; backup + Remove button) · none detected → generic Hermes/OpenClaw/Custom tabs.
2. Create token: name → **preset** (Read-only recommended / Read everything / Read + write / Custom) → chips (read: summary·banking·investments·budgets·planning·reports; write: transactions·budgets·planning·categories·settings·sync; dev: UI customization) → accounts picker → tabs picker (dev:ui) → expiry (30d/90d/never).
3. **Live capability sentence**: *"This agent can read your checking, savings, and credit accounts and your budgets. It can edit transaction categories. It cannot see investments or reports — you can grant these anytime."*
4. Token shown once + connect command + "Test it" (shows the exact JSON).
5. **Permission-request inbox**: agent hits a wall → 403 `insufficient_scope` + badge → Grant/Deny (optional notification). Grant appends scope (preset badge → "custom (modified)").
6. Token list: badge, scopes, last-used, revoke · audit viewer.

### 6.6 Offline behavior (connected mode — honest)
Offline = **read-only**: app-level cache serves last-known data; writes are blocked with toast "Connect to hub to edit." Queued writes deferred (v1.1). Copy stated in pairing flow.

### 6.7 Mobile BYOA-lite (solo): "Share to agent" JSON/CSV via share sheet.

---

## 7. Database Schema (ONE SQLite schema — desktop, hub, phone)

> Numbered SQL migrations + `PRAGMA user_version`. Money = INTEGER cents. Timestamps ISO-8601 UTC. APR = basis points.

```sql
-- IDENTITY & AUTH
users(id TEXT PK, username TEXT NULL UNIQUE COLLATE NOCASE,   -- NULL until hub/password set (solo)
      display_name TEXT NOT NULL, email TEXT NULL UNIQUE,
      password_hash TEXT NULL,              -- NULL = solo-only profile (audit P1-5)
      recovery_code_hash TEXT NULL,         -- solo recovery (audit P1-6)
      is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

sessions(id TEXT PK, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         token_hash TEXT NOT NULL UNIQUE, device_label TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL, expires_at TEXT NULL, idle_timeout_h INTEGER NULL,
         last_seen_at TEXT NOT NULL)
CREATE INDEX idx_sessions_user ON sessions(user_id);

device_lock(user_id TEXT PK REFERENCES users(id) ON DELETE CASCADE,
            pin_hash TEXT NULL, pin_salt TEXT NULL, biometric_enabled INTEGER NOT NULL DEFAULT 0,
            failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT NULL, updated_at TEXT NOT NULL)

-- PLAID & DATA
plaid_credentials(id TEXT PK, user_id TEXT, client_id_enc TEXT, secret_enc TEXT,
                  environment TEXT DEFAULT 'sandbox', updated_at TEXT, UNIQUE(user_id, environment))
plaid_items(id TEXT PK, user_id TEXT, plaid_item_id TEXT UNIQUE, institution_id TEXT,
            institution_name TEXT, access_token_enc TEXT, cursor TEXT, status TEXT DEFAULT 'active',
            last_sync_at TEXT, created_at TEXT)
accounts(id TEXT PK, item_id TEXT NULL,      -- NULL = manual account (audit P0-3)
         plaid_account_id TEXT NULL UNIQUE,  -- NULL = manual
         name TEXT NOT NULL, official_name TEXT, type TEXT, subtype TEXT, mask TEXT,
         current_balance_cents INTEGER, available_balance_cents INTEGER,
         currency TEXT DEFAULT 'USD', created_at TEXT)
balance_history(id TEXT PK, account_id TEXT, date TEXT, balance_cents INTEGER, UNIQUE(account_id, date))
transactions(id TEXT PK, account_id TEXT, plaid_transaction_id TEXT NULL UNIQUE,  -- NULL = manual
             amount_cents INTEGER, date TEXT, authorized_date TEXT, name TEXT, merchant_name TEXT,
             category_path TEXT, personal_finance_category TEXT, pending INTEGER DEFAULT 0,
             user_category_id TEXT NULL, user_note TEXT, exclude_from_budgets INTEGER DEFAULT 0,
             source TEXT NOT NULL DEFAULT 'manual',   -- 'plaid' | 'manual'
             created_at TEXT)
CREATE INDEX idx_txn_account_date ON transactions(account_id, date DESC);
CREATE INDEX idx_txn_date ON transactions(date DESC);
categories(id TEXT PK, user_id TEXT, name TEXT, color TEXT, plaid_paths TEXT,
           is_system INTEGER DEFAULT 0, created_at TEXT, UNIQUE(user_id, name))
budgets(id TEXT PK, user_id TEXT, name TEXT, amount_cents INTEGER, period TEXT DEFAULT 'monthly', created_at TEXT)
budget_categories(budget_id TEXT, category_id TEXT, PRIMARY KEY(budget_id, category_id))
user_settings(user_id TEXT PK, sync_interval_h INTEGER DEFAULT 12,
              hub_mode INTEGER NOT NULL DEFAULT 0, hub_url TEXT NULL, updated_at TEXT)  -- audit P0-1

-- PLAN MODULE
bills(id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'monthly',   -- weekly|biweekly|monthly|quarterly|yearly|one-time
      due_day INTEGER NULL, next_due_date TEXT NULL,
      last_paid_amount_cents INTEGER NULL,         -- variable-bill autofill (audit P2-11)
      category_id TEXT NULL, account_id TEXT NULL, active INTEGER NOT NULL DEFAULT 1,
      notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
CREATE INDEX idx_bills_next_due ON bills(user_id, next_due_date);
debts(id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other', principal_cents INTEGER NOT NULL,
      apr_bps INTEGER NOT NULL DEFAULT 0, min_payment_cents INTEGER NOT NULL DEFAULT 0,
      term_months INTEGER NULL, start_date TEXT NOT NULL, next_due_date TEXT,
      account_id TEXT NULL, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
goals(id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'savings', category TEXT NOT NULL DEFAULT 'general',
      target_cents INTEGER NOT NULL, target_date TEXT NULL, current_cents INTEGER NOT NULL DEFAULT 0,
      monthly_contribution_cents INTEGER NULL, account_id TEXT NULL, notes TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

-- BYOA
agent_tokens(id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL,
             token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
             preset TEXT NOT NULL DEFAULT 'read-only', scopes TEXT NOT NULL,
             account_ids TEXT, ui_tabs TEXT, expires_at TEXT NULL, revoked INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL, last_used_at TEXT, last_user_agent TEXT)
agent_access_log(id TEXT PK, token_id TEXT NOT NULL, scope_used TEXT NOT NULL, tool TEXT NOT NULL,
                 method TEXT, params_json TEXT, status INTEGER NOT NULL, latency_ms INTEGER, created_at TEXT NOT NULL)
CREATE INDEX idx_access_log_token ON agent_access_log(token_id, created_at DESC);
agent_permission_requests(id TEXT PK, token_id TEXT NOT NULL, scope TEXT NOT NULL,
                          status TEXT NOT NULL DEFAULT 'pending', requested_at TEXT NOT NULL, resolved_at TEXT NULL)
CREATE UNIQUE INDEX idx_perm_req_pending ON agent_permission_requests(token_id, scope) WHERE status = 'pending';
custom_views(id TEXT PK, user_id TEXT NOT NULL, token_id TEXT,
             tab TEXT NOT NULL CHECK(tab IN ('dashboard','budgets','reports')),
             name TEXT NOT NULL, widget_def TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
             enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
             UNIQUE(user_id, tab, name))
-- dev_edit_log → v1.1 with dev:local (audit P1-7)

-- PAIRING
pairing_codes(code_hash TEXT PK, user_id TEXT, expires_at TEXT, used INTEGER DEFAULT 0)  -- 10-min TTL, single-use
```

**Ingest rules:** upsert on `plaid_transaction_id` (pending→posted same row) · cents, positive = inflow, sign per account type · daily `balance_history` snapshot · category matching: exact PFC → longest `category_path` prefix → user override → "Uncategorized" · budget math = posted, non-excluded, in-period · **manual rows**: `source='manual'`, plaid id NULL, validated (amount ≠ 0, date sane, category defaults to "Uncategorized", never touched by sync).

---

## 8. API Design (REST + zod; same on hub and localhost)

```
AUTH            POST /api/auth/register|login · POST /api/auth/logout|logout-all · GET /api/auth/sessions
                DELETE /api/auth/sessions/:id · GET|PATCH /api/auth/me · PATCH /api/auth/password|username|email
                POST /api/auth/recovery (solo: reset password/PIN via recovery code) · DELETE /api/auth/me
Health          GET /api/health
Hub             GET /api/hub/detect (session) · POST /api/hub/apply {mode, url} · GET /api/hub/diagnostics
Pairing         POST /api/pairing/start (10-min TTL) · POST /api/pairing/accept
Plaid           GET|PUT /api/plaid/credentials (PUT = live test) · GET /api/plaid/link-token
                POST /api/plaid/exchange · GET /api/plaid/items · DELETE /api/plaid/items/:id
                POST /api/plaid/items/:id/refresh
Accounts        GET /api/accounts · POST /api/accounts (manual) · PATCH /api/accounts/:id (manual edit) · DELETE /api/accounts/:id (manual only)
Transactions    POST /api/transactions/sync · GET /api/transactions?filters&cursor · POST /api/transactions (manual)
                PATCH /api/transactions/:id · DELETE /api/transactions/:id (manual only)
Categories      GET|POST /api/categories · PATCH|DELETE /api/categories/:id
Budgets         GET|POST /api/budgets · PATCH|DELETE /api/budgets/:id · GET /api/budgets/:id/progress
Planning        GET|POST /api/planning/bills · PATCH|DELETE /api/planning/bills/:id · POST /api/planning/bills/:id/pay
                GET|POST /api/planning/debts · PATCH|DELETE /api/planning/debts/:id
                GET|POST /api/planning/goals · PATCH|DELETE /api/planning/goals/:id · GET /api/planning/digest?days=30
Reports         GET /api/reports/spending-by-category|cashflow|net-worth|spending-trend · GET /api/reports/projection?months=12
Data            GET /api/export?format=csv|json · GET /api/backup (SQLite download) · POST /api/backup/restore
Settings        GET|PUT /api/settings
BYOA            GET /api/agent/summary · GET /api/agent/events (SSE) · GET /api/openapi.json
                GET /api/agent/capabilities · GET /api/agent/requests · POST /api/agent/requests/:id/resolve
                GET /api/agents/detect (session; machine scan) · GET|POST|PATCH|DELETE /api/custom-views
                MCP: stdio (node dist/mcp-cli.mjs) · streamable HTTP /mcp
Webhook         POST /api/webhooks/plaid (optional, signature-verified)
```

**BYOA error contract (REST + MCP identical):**
```
403 { "error": { "code": "insufficient_scope", "missing": ["read:investments"],
       "message": "This token (trading-bot) lacks read:investments. Ask the user to grant it in Settings → Agents." } }
```
On emit: upsert pending request (deduped), log denied call, SSE `permission_requested`, in-app badge. No data in errors.

**Duration map:** `1h=3600s · 1d=86400 · 7d=604800 · 30d=2592000 · forever=expires NULL + idle_timeout_h=2160 (90d idle auto-revoke)`, cookie Max-Age 400d sliding.

**Projection algorithm:** baseline = current total balance (allowlist-aware) · income = avg of last 3 full months inflows (category "Income") · bills: monthly equivalents (weekly×4.345, biweekly×2.175, monthly×1, quarterly÷3, yearly÷12; one-time on date; inactive skipped; **variable bills use last paid amount**) · debts: min payment monthly · goals: if target+date and current<target → (target−current)÷months, capped, toggleable · project 12 months, flag danger <0 / warning <1 month avg expenses · emergency-fund insight (3× avg expenses) · `"estimate": true, "assumes": "all things constant"`.

---

## 9. BYOA — Tiered Permissions, Permission Requests, Detection

### 9.1 Scope catalog
Access = **scope ∧ account allowlist ∧ account type**.

| Scope | Semantics | v1 surface |
|---|---|---|
| `read:summary` | One-call briefing over allowlisted accounts only | `/api/agent/summary` · `get_financial_summary` |
| `read:banking` | Depository + credit accounts, transactions, search, history | `list_accounts`, `list_transactions`, `search_transactions`, `get_transaction` |
| `read:investments` | Investment accounts + txns + history. **Not in the default preset — grantable anytime** | same endpoints, investment subset |
| `read:budgets` | Budgets + progress + categories metadata | `get_budgets`, `get_budget_progress` |
| `read:planning` | Bills/debts/goals/projection | `get_planning_items` |
| `read:reports` | Aggregates — allowlist-filtered | `get_spending_by_category`, `get_cashflow`, `get_net_worth` |
| `transactions:edit` | Edit category/note/exclude on existing rows (no create/delete/bulk) | `set_transaction_category` |
| `budgets:write` | Budget CRUD | `create/update/delete_budget` |
| `planning:write` | Bills/debts/goals CRUD | `upsert_planning_item` |
| `categories:write` | Category CRUD + mapping | `create/update/delete_category` |
| `settings:write` | Sync interval, display prefs. **Plaid credentials never agent-scoped (v1)** | `update_settings` |
| `sync:run` | Trigger Plaid sync/refresh (isolated) | `trigger_sync` |
| `dev:ui` | Custom views for chosen tabs (dashboard/budgets/reports), rendered under user session | `list/create/update/delete_custom_view` |
| ~~`dev:local`~~ | **v1.1** (audited code edits; gates documented in backlog) | — |

**Account allowlist:** `account_ids` JSON; NULL = all allowed by scopes; enforced inside domain queries (`withAllowlist`) — single choke point; responses labeled `"scope": "allowed accounts"`.

### 9.2 Presets
| Preset | Scopes | Accounts | Notes |
|---|---|---|---|
| **read-only** *(default)* | summary + banking + budgets | all depository + credit | env `DEFAULT_AGENT_SCOPE` respected; investments not included **by default** |
| **read-all** | all 6 read scopes | all accounts | explicit choice |
| **read-write** | all reads + all writes | all accounts | no dev scopes |
| **custom** | any chips | per-account/grouped | dev:ui only here |

Token stores `preset` (badge) + resolved `scopes` JSON (enforcement truth). Any manual scope change → badge "custom (modified)".

### 9.3 Enforcement points
1. **REST middleware** `src/server/authz/agent-auth.ts`; route registry (Appendix J.2 — every endpoint mapped to required scopes); Bearer → SHA-256 → lookup → reject revoked/expired (timing-safe) → `requireScope` → `ctx` → queries via `withAllowlist`.
2. **MCP tool filtering** — tools listed per token with `requires:` annotations; **denied tools stay visible** (attempt → permission prompt, per product decision); handlers re-check.
3. **OpenAPI / manifest** — `x-required-scope` on every operation (zod-generated); `/api/agent/capabilities` returns `{preset, scopes, accountCount, uiTabs, expiresAt, tools, endpoints, missing}`.
4. **UI** — capability sentence; permission-request inbox; "Test it"; audit viewer.

### 9.4 Permission requests (ask-to-grant loop)
1. Denied call → **403 `insufficient_scope`** (missing scopes, no data, friendly message).
2. Upsert pending request (deduped per token+scope, 10-cap), log denied call, SSE `permission_requested`.
3. In-app badge + optional notification → "Agent 'trading-bot' requested read:investments" → **[Grant] [Deny]**.
4. Grant → append scope, preset → "custom (modified)". Deny → persists.
5. Rate-limited + dismissible; agents told: check `get_capabilities`, tell the user what to grant.

### 9.5 Agent detection & auto-config (v5 — "try to auto-detect any agents/models on the machine")
- `GET /api/agents/detect` (session-auth; disabled in phone-solo): read-only probe —
  - **Binaries** (best-effort `which`/common paths): `hermes`, `openclaw`, `claude`, `codex`, `cursor`, `opencode`.
  - **Config markers** (existence + already-configured boolean only): `~/.hermes/config.yaml`, `~/.claude.json`, `~/.config/claude`, `~/.cursor/mcp.json`, `~/.codex/`, `~/.config/openclaw/`, `~/.mcp.json`.
  - **Safety contract**: never executes agent binaries, never reads/returns secret values or file contents, returns only `{agent, present, configured}`; results cached 60s; rate-limited.
- **UI**: "We found on this machine: Hermes ✓ · Claude Code ✓" → tailored one-liner (URL = localhost when same machine, else hub URL) · **"Configure for me"** (consent-gated; writes MCP entry to the detected config with timestamped backup + one-click "Remove" in Agents UI; v1 supports Hermes + Claude Code + Cursor configs; exact syntax verified at build time per docs) · none found → generic tabs.

### 9.6 Custom views (dev:ui) — v1 mechanics
`custom_views` table; `widget_def` zod-validated JSON `{type: stat|table|chart|progress|text, title, query: {endpoint ∈ allowlist, params}, options}`; rendered by `<WidgetRenderer>` under the **user's session**; declarative only, no JS/HTML, 8-widget/tab cap, endpoint allowlist, CSP unchanged; agent can add/update/delete its own views.

### 9.7 Token lifecycle & security
`of_` + 32B random base62; shown once; SHA-256 hash + prefix stored; gitleaks `of_[A-Za-z0-9]{40,}` · 120 req/min per token+IP · audit row per call incl. `scope_used` · expiry enforced at authz · pitfalls→mitigations as §9.4 + least-privilege defaults + allowlist + cross-domain leakage tests + write verbs narrow + Bearer (no CSRF) + request dedupe.

---

## 10. Security Blueprint (verified for open-source publication)

**Threat model:** self-hosted 1–10 users; own Plaid keys (or none); BYOA tokens; LAN/Tailscale exposure; public OSS review. Risks: leaked env/secrets · XSS/CSRF · brute-force · Plaid token theft · agent token abuse · LAN sniffing · supply chain · bad OSS example.

**Crypto:** AES-256-GCM, key = `SHA-256(ENCRYPTION_KEY)`, IV 12B + tag, envelope base64, AAD `userId:recordId`, `src/lib/crypto.ts` + tamper tests. Secrets encrypted at rest even in local SQLite. Errors redacted.

**Sessions & identity:** bcryptjs 12 (10–72 bytes, top-1000 + username-equality reject) · session tokens hashed, `of_sess_` prefix · cookie HttpOnly, SameSite=Lax, `Secure` only when `PUBLIC_URL` https (LAN/Tailscale = trusted, encrypted-at-transport where applicable; documented) · Max-Age ≤ 400d sliding · CSRF SameSite=Lax + `x-of-request: 1` · **rate limits keyed by IP+username** (NAT-safe; audit P1-13): login 5/min per IP+username; register 5/hr/IP; password/username 5/min/user; sessions ops 20/min/user; pairing accept 5/min/IP; hub/agents detect 10/min/user · generic login errors · "Forever (not recommended)" = no expiry + 90d idle + revocable · password change revokes others · **recovery code** (32-hex, hashed at rest, shown once at solo setup, stored in data dir by default) resets password/PIN without data loss · demo gated by `DEMO_MODE`.

**Device lock (mobile):** PIN PBKDF2-SHA256 100k + 16B salt, timing-safe · hub session token in Android Keystore EncryptedSharedPreferences via native plugin · biometric = system prompt, no secret stored · lockout 5× → 30s doubling to 8m · solo PIN loss recoverable via recovery code (export still recommended) · re-lock Immediately/1m/5m/never.

**Backup & restore:** download = authed session only (never agent tokens); restore = password/recovery-confirmed, replaces DB after explicit confirm + pre-restore auto-backup; backups are encrypted at rest (same file, same key — document: restore requires same ENCRYPTION_KEY).

**Web hardening:** security headers (CSP self+Plaid+inline tokens, DENY framing, nosniff, no-referrer, narrow Permissions-Policy) · zod everywhere · parameterized SQL only · no `dangerouslySetInnerHTML` · secrets hygiene (.env gitignored, .env.example only, gitleaks CI incl. `of_`/`of_sess_`, lockfile + audit + Dependabot, `.gitleaks.toml`).

**BYOA hardening:** §9. **Detection hardening:** §9.5 safety contract (no exec, no secrets, no file contents). **Hub detect hardening:** `tailscale status`/`ip -4` best-effort, no root, results session-only, never exposed cross-user. **Plaid hardening:** sandbox-first, delete access token on remove, item error → reconnect, webhook signature verify, no payload logging. **Docker/ops:** non-root, read-only rootfs where practical, `HEALTHCHECK /api/health`, env-only secrets, SQLite volume backup docs, migrations on start.

**OSS release security checklist (before tagging v1.0):**
```
□ pnpm audit --prod → 0 high/critical · gitleaks repo+history → 0 (incl. of_ patterns)
□ grep -riE '(sk-|of_[A-Za-z0-9]|client_id|secret|password)' public/ docs/ src/ → no real values
□ curl -I security headers on prod container · error responses clean (auth/plaid/agent/planning/backup)
□ SECURITY.md + disclosure · Dependabot on · CI: audit + gitleaks + design.md lint
□ crypto tamper · session expiry/revoke · scope-enforcement matrix · permission-request flow
□ registry-completeness test green (Appendix J.5) · detection probe tests (no exec/no leak)
□ backup/restore auth + restore-with-wrong-key failure test
□ docs: ENCRYPTION_KEY/AUTH_SECRET unique per install; agent tokens = financial read, treat carefully;
  LAN = trust-your-network; Tailscale = encrypted mesh, hub host still trusted; recovery code = data key
```

---

## 11. Purpose Audit (v5 update)

| Feature | Job | Cost | Verdict |
|---|---|---|---|
| Demo mode (SEED_DATE-pinned) | Prove product in 10s | Small | **Keep** |
| **Manual entry (accounts + transactions)** | No-Plaid path; lowest barrier | Med | **Keep (v1)** |
| Test-connection button | Kill #1 onboarding failure | Small | **Keep** |
| **Connection Assistant + diagnostics** | Hub setup = product, not doc | Med | **Keep (v1)** |
| **Agent detection + auto-config** | "Try to auto-detect agents on the machine" | Med | **Keep (v1)** |
| **Backup & restore (one-click)** | Data-ownership promise; novice-safe | Small | **Keep (v1)** |
| Budgets + progress rings | Meaningful hook | Med | **Keep** |
| Reports + projection + digest + emergency insight | Insight; agent briefing source | Med | **Keep** |
| Bills/debts/goals (+ variable bills) | Plan module | Med | **Keep** |
| Balance history | Net-worth chart; trends | Small | **Keep** |
| Category mapping + overrides | Makes budgets true | Med | **Keep** |
| ⌘K palette · Theme customization + JSON | Fast search; requested beauty | Small | **Keep** |
| Sessions picker + UI + logout-all · Biometric/PIN | Requirement; security value | Med | **Keep** |
| Permission-request inbox | The ask-to-grant loop | Small | **Keep** |
| Notifications (budget/sync/permission) | Alerts only | Med | **Keep** |
| PWA (desktop-local) + app-level offline cache | Installable; honest offline reads | Med | **Keep** |
| QR pairing + Reconnect deep link | One-tap hub connect | Med | **Keep** |
| BYOA tiered + custom views + detection | The headline | Med | **Keep** |
| Share-to-agent (solo) | BYOA on server-less phones | Tiny | **Keep** |
| Webhooks (optional) | Public-URL self-hosters | Small | **Keep** |
| SEO README + static microsite + og + launch | Discovery | Small | **Keep** |
| **dev:local (agent code edits)** | Audited full-code edits | Med+risk | **Defer v1.1** (dev:ui covers tab-level customization in v1) |
| Transaction splitting | Shared expenses/cashback | Med | **Defer v1.1** (FAQ copy) |
| Budget rollover | YNAB core | Small | **Defer v1.1** |
| npm publish of MCP CLI | `npx` one-liner | Small | **Defer v1.1** (local path in v1) |
| WebAuthn · TOTP · Tauri · CSV · recurring detection · what-if · investments holdings · multi-currency · i18n · theme gallery | backlog | — | **Defer** |

---

## 12. Testing & Quality Gates (every phase passes its gate before handoff)

- **Unit (Vitest):** crypto roundtrip/tamper · zod schemas · ingest/dedupe/sign · category matching · budget math · session duration/revoke/logout-all · PIN hash/lockout · amortization + projection (leap years, 5-week months, one-time bills, no-date goals, variable bills) · scope-enforcement matrix (read:banking must NOT see investments in summary/net-worth/reports) · permission-request lifecycle · **registry-completeness test (every scope ≥1 route; every MCP tool maps to scope+endpoint; no orphans)** · **detection probes (mock `which`/configs; assert no exec, no secret reads)** · **hub detect (tailscale absent/present, LAN fallback)** · **manual-entry validation (source flags, sync never touches manual rows)** · **withAllowlist parameterization/injection test** · **migrations from empty + v0→v1 upgrade** · rate limiters.
- **Integration (supertest):** API routes vs SQLite; auth flows; Plaid mocked; agent authz (scopes, allowlist, expiry, revocation, audit rows) · MCP smoke **stdio + Streamable HTTP (POST + SSE GET)** · backup/restore (auth, wrong-key failure).
- **E2E (Playwright; retries:2, workers:1 on sandbox jobs):** critical path w/ real sandbox keys in CI secrets (signup → demo → keys → test-connection → link Houndstooth → transactions → budget → bill/goal/projection → dark mode) + **manual-entry path (no Plaid)** + **connection assistant (LAN detect → QR → pairing)** + auth failure/rate-limit/delete-data + session revocation → 401 + BYOA full loop (create → capabilities → summary → attempt investments → 403 → grant → success → revoke → denied) + dev:ui widget render + **agent detection UI (fake configs)**.
- **Visual:** screenshot suite (SEED_DATE-pinned; light/dark, desktop/mobile, empty/loaded) at P6 and after Kimi K3; CI diff; snapshot baselines committed, updated only in the K3 PR.
- **A11y:** axe-core; design.md lint in CI. **Perf:** Lighthouse ≥90 dashboard; JS ≤ 250 KB gzip; charts + MCP lazy.

**Gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e` green + screenshots. No phase advances on red. **Fix-loop discipline:** report only `tail -50` of failures; max 5 fix loops per phase, then escalate (deepseek-reasoner allowed for P7/P8).

---

## 13. AI Build Orchestration — DeepSeek builds, Kimi K3 beautifies

### 13.1 Division of labor
| | **DeepSeek (deepseek-chat; deepseek-reasoner for P7/P8 on escalation)** | **Kimi K3** |
|---|---|---|
| Role | Builds 100% of fundamentals | Polish/beauty pass ONLY |
| Scope | P0–P8b (Appendix A) | Fixed 20-file list (A.12) |
| Forbidden | Inventing design beyond Appendix B; `@latest` deps; deviating from build-references | Touching logic/tests/deps; anything outside the list |
| Output contract | §12 gate green per phase | build+lint green + **CI check: `git diff --name-only` ⊆ file list (hard fail)** + screenshots |
| Est. cost | ~$6–12 (order of magnitude, +30–40% contingency) | ~$1–3 |

### 13.2 Kimi K3 token-minimization rules (unchanged — the core)
1. Design contract pre-authored. 2. Fixed file list. 3. Baseline first → small diff. 4. Screenshots not prose. 5. One consolidated brief. 6. Targeted patches only. 7. Gates in CI (Kimi runs build+lint). 8. No design essays. 9. First green pass = success. 10. Baseline already good.

### 13.3 Estimated token budget (order of magnitude, +contingency)
| Stage | Model | Est. input | Est. output |
|---|---|---|---|
| P0–P6 (scaffold→planning→release-infra) | DeepSeek | ~1.6M | ~0.7M |
| P7a authz+MCP+detection+registry | DeepSeek | ~140k | ~80k |
| P7b Agents UI | DeepSeek | ~120k | ~70k |
| P8a connected mobile | DeepSeek | ~120k | ~60k |
| P8b solo native (kill criteria) | DeepSeek (+reasoner if escalated) | ~180k | ~90k |
| Fix/verify loops (capped 5/phase) | DeepSeek | ~350k | ~140k |
| **Polish pass** | **Kimi K3** | **~150–230k** | **~35–70k** |

Total DeepSeek ≈ 2.6–3.4M tokens; **Kimi K3 ≈ 185–300k tokens** — tiny because the contract does the thinking.

---

## 14. Roadmap (phases = briefs; gate before next)

```
P0   Scaffold + build-references       [DeepSeek]  Gate: refs exist, build+lint+test green, /api/health
P1   Identity & sessions (+recovery)   [DeepSeek]  Gate: auth e2e (durations, logout-all, recovery, PIN)
P2   Plaid + onboarding                [DeepSeek]  Gate: sandbox link e2e (real keys in CI)
P3   Sync + transactions + cats +      [DeepSeek]  Gate: sync + manual-entry e2e, search/list green
       manual entry
P4   Budgets + reports + dashboard     [DeepSeek]  Gate: seeded charts render
P5   Planning module                   [DeepSeek]  Gate: planning math + digest e2e
P6   Polish-readiness + release infra  [DeepSeek]  Gate: connection assistant e2e, backup/restore,
       (connection assistant, backup/                    demo, empty/error states, PWA, Docker, CI
       restore, microsite, og, gradle)                   (incl. axe+audit+gitleaks in gate), screenshots
P7a  BYOA core (authz, registry, MCP,  [DeepSeek]  Gate: scope matrix + registry test + MCP smoke
       permission requests, detection)                  (stdio+HTTP) + permission-request e2e
P7b  Agents UI (incl. detection UI)    [DeepSeek]  Gate: Agents UI e2e (chips, capability sentence,
                                                       inbox, detection cards, auto-config backup)
P8a  Mobile connected (QR, device-     [DeepSeek]  Gate: APK connected e2e (pairing, unlock, read-only
       lock, webview, cleartext)                       offline toast)
P8b  Mobile solo (native proxy +       [DeepSeek]  Gate: APK solo e2e OR kill criteria → v1.0
       LinkKit + cap-sqlite)                           connected-only, solo v1.1
P9   Beauty pass                       [Kimi K3]   Gate: build+lint + diff⊆list + screenshots reviewed
P10  Verification + security + SEO +   [DeepSeek]  Gate: §10 checklist, Appendix I pass, tag v1.0.0,
       release                                        branch protection ON, Docker+APK+Pages artifacts
```

Wall-clock: 3–5 days of agent runtime. **P8b kill criteria** (hard token budget exceeded / gate red after 5 loops): ship P8a-only mobile in v1.0, solo in v1.1 — UI identical, adapter swaps.

---

## 15. Open Source Release Checklist (v1.0 tag)

```
□ LICENSE (MIT) · README.md (BYOA headline-optional, SEO copy, all 3 shapes, manual-entry + Plaid paths)
□ docs/DESIGN.md · docs/AGENTS.md · docs/build-references/* · agent-manifest.json
□ CONTRIBUTING.md · CODE_OF_CONDUCT.md · SECURITY.md · CHANGELOG.md
□ .github/ISSUE_TEMPLATE/{bug,feature}.yml
□ .github/workflows/ci.yml (lint, typecheck, test, build, audit, gitleaks, e2e incl. sandbox +
  manual-entry + assistant + BYOA + detection, MCP smoke, scope matrix, registry test, screenshots;
  status check "ci") · release.yml (ghcr + signed APK; setup-java 21, android-emulator-runner) ·
  pages.yml (static site upload, no build)
□ Dockerfile + docker-compose.yml (+ compose.tls.yml w/ Caddy) · .env.example
□ Launcher scripts (start.sh/start.bat/.desktop) · .npmrc (save-exact, engine-strict) · .gitleaks.toml ·
  .gitignore (data/, *.db, android/key.properties, keystores) · committed gradle wrapper · engines.node
□ Plaid guide screenshots (no real keys) · og:image 1200×630 (Playwright crop script)
□ Badges: license · CI · docker pulls · "BYOA" · "self-hosted"
□ GitHub wiring per Appendix H (protection applied at P10, secrets, secret scanning)
□ SEO/discovery pass per Appendix I · Wiring matrix conformance (Appendix J) green in CI
```

---

## 16. Deployment — Three Shapes + Connection Assistant (no env editing)

| Shape | How | Barrier |
|---|---|---|
| **Desktop-solo** | Launcher (double-click) → localhost app, SQLite in `~/.open-finance/`; display-name only; PWA installable (localhost = secure context) | 1 click |
| **Hub (desktop-as-server)** | Settings → Hub → Connection Assistant → same-Wi-Fi or Tailscale → QR | ~1 min |
| **Phone-solo** | Install APK → solo mode → native proxy + local DB + PIN; manual entry works without Plaid | 1 install |
| **Phone-connected** | Scan hub QR / enter URL → thin client; **read-only offline** (writes toast "Connect to hub to edit") | 1 tap |

**Connectivity (the whole story):** ① **Local (default)** — hub on LAN, phone pairs over Wi-Fi; assistant detects the LAN IP. ② **Anywhere — Tailscale (recommended remote)** — `tailscale up` on the hub (assistant detects + guides if absent), MagicDNS URL, QR works anywhere; WireGuard-encrypted, zero ports/certs/domain. ③ **Public TLS (power users)** — Caddy auto-TLS or Cloudflare Tunnel. **PWA truth:** service workers need a secure context, so PWA install is desktop-local (launcher opens localhost); hub/web and LAN/Tailscale http have no SW — offline reads come from the app's TanStack persistence instead. Android cleartext: `android:usesCleartextTraffic="true"` for user-entered hub hosts (per-host config can't be extended at runtime); docs recommend Tailscale/TLS for anything sensitive.

---

## 17. Plaid Tiers & Test Credentials (verified July 2026)

| Tier | Who | Cost | Limits |
|---|---|---|---|
| **Sandbox** | Everyone | Free, unlimited | Fake data; onboarding/e2e |
| **Limited Production** | Accounts created **before Apr 15, 2026** | Free limited | Test live data pre-approval |
| **Trial plan** | US/Canada accounts created **on/after Apr 15, 2026** | Free | Up to **10 production items**, auto-approved for most devs; covers most OAuth banks |
| **Full Production** | Approved | Paid | Not needed for personal use |

**Sandbox test credentials:** Houndstooth Bank `ins_109512`, `user_good`/`pass_good`, MFA `1234`; erroneous `user_bad`/`pass_bad`. Personal usage ≈ 190 calls/month for 3 items → fits Sandbox/Trial.

---

## 18. Competitive Positioning

| | Open Finance (ours) | Monarch | YNAB | Actual Budget |
|---|---|---|---|---|
| Cost | Free | $99/yr | $109/yr | Free |
| Open source | ✅ MIT | ❌ | ❌ | ✅ MIT |
| Plaid | **Your own keys — or none (manual entry)** | Built-in | Built-in | Community plugin |
| Self-hosted | ✅ | ❌ | ❌ | ✅ |
| Desktop / phone / hub | **All three shapes, independent** | Cloud only | Cloud only | Server + web |
| Bring Your Own Agent | ✅ **MCP, tiered, permission requests, detection** | ❌ | ❌ | API only |
| Planning (bills/debts/goals/projection) | ✅ built-in | ✅ | ✅ | partial |
| Hub setup | **In-app assistant (LAN/Tailscale/QR)** | n/a | n/a | config files |
| Data ownership | You | Them | Them | You |
| Install time | **10s demo / 5 min real / 2 min agent / 5 min plan** | 15 min | 15 min | 30 min |

**The angle:** *Monarch connections (or none at all) + Actual privacy + $0 forever + your own agent with least-privilege access + a plan for the future — and a demo you see before you commit.*

---

## 19. Risks & Mitigations (v5 update)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Native Android (P8b) outgrows brief | Med | **Kill criteria**: hard token budget, 5-loop cap, connected-only v1.0 fallback; LinkKit specified |
| MCP SDK hallucination by DeepSeek | Med | **build-references committed**; copy-don't-invent; version pinned 1.10.x; stdio+HTTP smoke in gate |
| Version drift (`@latest` habits) | Med | Exact pins + corepack + `.npmrc save-exact` + CI `pnpm install --frozen-lockfile` |
| BYOA token abuse / permission noise | Med | Least privilege, allowlists, dedupe + cap, audit, plain-language warnings |
| Hub IP changes (DHCP) break phone | Med | Assistant steers to MagicDNS; phone stores last URL + Reconnect; hub Settings shows current URL |
| LAN sniffing / Tailscale misuse | Med | Documented trust-your-network; encrypted transport options; secrets encrypted at rest |
| Session token theft (forever) | Med | Hashed at rest, idle timeout, sessions UI, logout-all, "not recommended" label |
| Forgotten password/PIN locks data | Med | **Recovery code** + documented hub reset; restore-from-backup |
| SQLite concurrency on busy hub | Low | WAL + busy_timeout; 1–5 users fine; Postgres swap = one module (roadmap) |
| Projection accuracy expectations | Med | Labeled estimate; actuals + user schedules |
| Plaid ToS/approval friction | Med | Sandbox free; Trial auto-approves; manual entry = zero-Plaid path |
| Plaid API changes | Low | Pin SDK; isolated adapter; sandbox e2e |
| AI build quality variance | Med | Gates, build-references, fix-loop caps, escalation |
| Kimi K3 overruns tokens / touches files it shouldn't | Low | §13.2 + diff⊆list CI hard fail |
| Self-host data loss | Med | Backup download + restore, export, backup docs |

---

## 20. Future Backlog (explicit, v1.1+)

dev:local (audited code edits — gates: `DEV_LOCAL_EDITS=true` + loopback + branch review) · transaction splitting · budget rollover · npm publish (`@open-finance/mcp`) · CSV/OFX import · WebAuthn passkeys · TOTP 2FA · Tauri installer · solo→hub push sync · Postgres migration path · investment holdings/positions · multi-currency conversion · i18n · shared/household budgets · recurring-transaction detection · what-if projection sliders · rule engine for auto-categorization · community theme gallery · credit-card statement-cycle awareness · iOS shell · queued offline writes.

---

## 21. Definition of Done — what "go" means

**All confirmations resolved:**
| # | Decision | Status |
|---|---|---|
| (a) Repo | **open-finance** under DeseretSaint (gh verified) | ✅ |
| (b) Display name | Open Finance | ✅ |
| (c) Accent | emerald default; user-customizable (presets + hex; charts harmonize) | ✅ |
| (d) BYOA default | **read-only by default; user controls read & write permissions incl. investments** | ✅ (copy reframed) |
| (e) Connectivity | Connection Assistant: LAN / Tailscale / domain | ✅ |
| (f) No-Plaid path | manual entry in v1 | ✅ (audit) |
| (g) **dev:local deferred to v1.1** | dev:ui custom views cover tab-level customization in v1 | ⚠️ **flag for veto** |
| (h) Branch protection | applied at P10 (keeps one-shot push unblocked) | ✅ (audit) |

**Execute:** Appendix A in order, zero further design decisions: DeepSeek P0→P8b (each §12 gate green; P8b subject to kill criteria) → Kimi K3 P9 (diff-enforced) → P10 verification + SEO + release (tag v1.0.0; Docker + APK + Pages + docs; protection on).
**Deliverables:** working app in all three shapes (manual or Plaid), green CI with registry/matrix conformance, BYOA tiered + permission requests + detection verified end-to-end, Plan module live, MIT repo published under `github.com/DeseretSaint/open-finance`.

---

## Appendix A — Agent Briefs (paste-ready; each ends with the §12 gate)

> Conventions: repo per Appendix E; `pnpm` + Node 22; exact pins; commit after each task (`feat: …`); report only `tail -50` of failures; max 5 fix loops per phase then escalate (deepseek-reasoner for P7/P8); forbidden: inventing deps, deviating from Appendix B tokens or Appendix L references, committing secrets.

### A.1 P0 — Scaffold + build-references
`pnpm create next-app@15.5.x open-finance --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes` (exact pinned Next 15.5.x); add `better-sqlite3@12.x @types/better-sqlite3 plaid zod bcryptjs @tanstack/react-query recharts @plaid/react-plaid-link serwist@9.x cmdk @modelcontextprotocol/sdk@1.10.x qrcode @types/qrcode jsqr archiver clsx tailwind-merge class-variance-authority`; dev: `vitest @testing-library/react supertest playwright @playwright/test @google/design.md sharp`.
Tasks: Tailwind v4 + shadcn init · **first commit `docs/build-references/`** (mcp-streamable-http.ts, plaid-proxy-plugin.kt skeleton, cap-sqlite-adapter.ts, serwist-next15.ts, next.config.ts w/ standalone+serverExternalPackages, qr-pairing.md — copy from these, never invent) · SQL module (adapter.ts, schema.sql, migrations/up.js, WAL) · lib (env zod, crypto, rate-limit, api) · domain (ingest, categories, budgets, reports, planning, projection, summary, manual-entry) · /api/health · security headers · Docker node:22-bookworm-slim multi-stage non-root + compose + .env.example · CI (lint/typecheck/test/build/audit/gitleaks/design-md-lint) · ESLint/Prettier · **design tokens per Appendix B** · tests: crypto, migrations-empty + v0→v1 upgrade, withAllowlist injection.
Gate: refs committed + full gate green + `curl /api/health`.

### A.2 P1 — Identity & sessions
Per §7/§8: users (username nullable solo, display_name, password optional, recovery_code_hash), sessions (durations incl. forever+idle), register/login/logout/logout-all/sessions/revoke/me/profile/password/username/email/recovery/delete-me; rate limits keyed IP+username; CSRF header; device_lock (PBKDF2 100k, biometric flag, lockout); solo recovery flow; profile/security UI (duration picker literal "Forever (not recommended)"). AuthProvider: session-cookie | device-lock.
Tests: durations, revoke semantics, recovery reset, PIN hash/lockout, rate limits; e2e incl. recovery.
Gate: auth e2e green.

### A.3 P2 — Plaid + onboarding
Per §8: credentials PUT w/ live test; link-token/exchange/items/refresh; encrypted storage; Plaid adapter interface (server impl now; native+LinkKit in P8b); 4-step walkthrough w/ screenshots; Plaid Link via `@plaid/react-plaid-link` (web/connected only); items list remove/reconnect; sandbox e2e w/ CI secrets.
Gate: sandbox link e2e green.

### A.4 P3 — Sync + transactions + manual entry
Sync engine per §7 ingest (cursor, upsert, pending→posted, snapshots, cents, source flags); transactions list/filter/search/PATCH; **manual account + transaction CRUD** (source='manual', never touched by sync; validated); categories CRUD + seed; manual refresh + node-cron 12h + optional webhook; pages: transactions (incl. manual add), accounts (incl. manual create/edit/delete), categories.
Tests: ingest/dedupe, manual-row isolation from sync, validation; e2e manual path.
Gate: full gate green.

### A.5 P4 — Budgets + reports + dashboard
Budgets CRUD + period progress (+ GET /api/budgets/:id/progress); historical reports; export (JSON+CSV zip via archiver); settings routes; budgets/reports/dashboard/settings pages (appearance preview).
Gate: seeded charts render; budget math tests.

### A.6 P5 — Planning module
Per §7/§8: bills (CRUD, create-from-transaction, mark-paid advances next due + remembers last paid amount), debts (CRUD + amortization), goals (CRUD + auto contribution), digest, projection per §8, Plan tab UI; seed demo bills/goals/debts (SEED_DATE).
Tests: period math (leap/5-week/one-time/partial), amortization, projection flags, variable bills.
Gate: planning math + digest e2e.

### A.7 P6 — Polish-readiness + release infra
Demo mode (SEED_DATE gate); empty/error/skeleton states; PWA (Serwist; desktop-local); **Connection Assistant** (hub/detect, hub/apply, diagnostics card; three cards flow; QR; Reconnect deep link); **backup download + restore** (auth, confirm, pre-restore auto-backup, wrong-key test); **agent/hub detect endpoints** (safe probes per §9.5/§10); desktop launcher scripts; Capacitor init (assets, biometrics, preferences, notifications, status-bar, app; CAP_SERVER_URL; cleartext config); **microsite `site/` static HTML+CSS + pages.yml (no build step)**; **og:image 1200×630 crop script**; **gradle wrapper + emulator job skeleton**; README/CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/LICENSE; release.yml; Plaid guide screenshots; screenshot suite (SEED_DATE).
Gate: assistant e2e + backup/restore tests + demo + axe + audit + gitleaks + suite captured + `docker compose up` verified.

### A.8 P7a — BYOA core (authz, registry, MCP, permission requests, detection)
Per §9: agent_tokens/access_log/permission_requests/custom_views; token service; **route registry + scope matrix (Appendix J.2) + registry-completeness test**; authz middleware + withAllowlist; insufficient_scope contract + request upsert + SSE + resolve endpoints; MCP (stdio + Streamable HTTP; tools/prompts/resources filtered per token w/ requires annotations; handlers re-check); OpenAPI x-required-scope; summary + events + capabilities (incl. missing); **agents/detect (safe probes, cache, rate limit)**; AGENTS.md + agent-manifest.json.
Tests: scope matrix, allowlist, tool-list annotation, permission-request lifecycle, MCP smoke stdio+HTTP, registry test, detection probes.
Gate: P7a gate green.

### A.9 P7b — Agents UI
Agents panel: preset cards, chip groups, account picker, tabs picker, capability sentence, permission-request inbox (badge + Grant/Deny), test-it, audit viewer, **detection cards + "Configure for me" (consent, backup, Remove) for Hermes/Claude Code/Cursor configs**; copy rules per §5.
Tests: Agents UI e2e (chips → sentence; grant flow; detection cards w/ fake configs; auto-config backup+undo).
Gate: P7b gate green.

### A.10 P8a — Mobile connected (QR pairing, device-lock, webview)
Capacitor connected mode: pairing scan (jsqr) + accept (10-min TTL), session storage (Keystore via plugin), device_lock unlock flow, offline read-only toast ("Connect to hub to edit"), Reconnect deep link, cleartext config, APK build via CI (setup-java 21 + android-emulator-runner).
Gate: APK connected e2e.

### A.11 P8b — Mobile solo (native proxy + LinkKit + cap-sqlite)
Native Plaid proxy plugin (Kotlin, OkHttp): testCredentials/createLinkToken/exchangePublicToken/getAccounts/syncTransactions/removeItem + **Plaid LinkKit native Link launch**; cap-sqlite adapter (same SQL); solo bootstrap (device row, recovery code, PIN); share-to-agent; solo e2e (link Houndstooth in solo → txns in local DB). **Kill criteria:** token budget exceeded or gate red after 5 loops → stop P8b, ship connected-only v1.0, solo v1.1 (UI identical).
Gate: APK solo e2e OR kill criteria documented.

### A.12 P9 — Beauty pass [Kimi K3] *(fixed, token-minimal brief)*
> You are the design finisher for a finance app whose engineering is complete. Do NOT modify logic, routes, schema, tests, MCP, auth, or dependencies. Purely visual refinement.

- **Read:** `docs/DESIGN.md` → then **only**: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/layout/app-shell.tsx`, `src/components/ui/*` (read-only), `src/components/dashboard/*`, `src/components/transactions/*`, `src/components/budgets/*`, `src/components/planning/*`, `src/components/onboarding/*`, `src/components/reports/*`, `src/components/custom-views/widget-renderer.tsx`, `src/components/settings/*`, `src/components/auth/*`, `src/components/brand/logo.tsx`, `src/app/(marketing)/page.tsx`, `site/index.html`, `src/lib/copy.ts`.
- **Before editing:** review `public/screenshots/` (SEED_DATE-pinned).
- **Do:** refine token values; elevate listed components (spacing, hierarchy, hover/focus, empty states, chart styling, onboarding rhythm, connection assistant, agents/security/planning panels, permission-request inbox, detection cards, microcopy); light+dark equal beauty; keep every class/state hook; add classes only via tokens.
- **Do NOT:** touch outside the list (CI hard-fails on `git diff --name-only` ⊄ list); rewrite files wholesale; rename classes/props; alter behavior; add deps; run tests.
- **Verify:** `pnpm build` + `pnpm lint`; re-capture screenshots (`pnpm screenshots`); reply with changed values + screenshots. No essays. First green pass = success.

### A.13 P10 — Verification + security + SEO + release
§10 checklist · full gate + e2e on main · review Kimi's screenshots with user · fix regressions (small brief) · Appendix I SEO pass · tag v1.0.0 · **enable branch protection (§H)** · publish (Docker + APK + Pages + docs) · launch checklist.

---

## Appendix B — DESIGN.md Contract ("Calm Fintech") — full token spec

> Repo copy: `docs/DESIGN.md`. Validate: `npx @google/design.md lint docs/DESIGN.md` (also in CI). Kimi K3 may refine values; refinements keep WCAG AA and stable token names.

```yaml
---
version: alpha
name: Open Finance — Calm Fintech
description: Warm paper surfaces, one accent doing all the work, generous whitespace, precise financial calm.
colors:
  primary: "#10B981"
  on-primary: "#FFFFFF"
  surface: "#FFFFFF"
  surface-muted: "#F5F5F4"
  background: "#FAFAF9"
  border: "#E7E5E4"
  text: "#1C1917"
  text-muted: "#78716C"
  success: "#16A34A"
  warning: "#D97706"
  danger: "#DC2626"
  chart-1: "#10B981"
  chart-2: "#6366F1"
  chart-3: "#F59E0B"
  chart-4: "#EF4444"
  chart-5: "#8B5CF6"
  chart-6: "#06B6D4"
  surface-dark: "#1C1917"
  surface-muted-dark: "#292524"
  background-dark: "#0C0A09"
  border-dark: "#44403C"
  text-dark: "#FAFAF9"
  text-muted-dark: "#A8A29E"
typography:
  body: { fontFamily: Inter Variable, fontSize: 1rem, lineHeight: 1.5, fontWeight: 400 }
  h1: { fontFamily: Inter Variable, fontSize: 1.875rem, fontWeight: 700, letterSpacing: "-0.02em" }
  h2: { fontFamily: Inter Variable, fontSize: 1.5rem, fontWeight: 600, letterSpacing: "-0.015em" }
  h3: { fontFamily: Inter Variable, fontSize: 1.125rem, fontWeight: 600 }
  money: { fontFamily: Inter Variable, fontSize: 1rem, fontWeight: 600, fontFeature: "tnum" }
  label: { fontFamily: Inter Variable, fontSize: 0.75rem, fontWeight: 500, letterSpacing: "0.04em", textTransform: uppercase }
rounded: { sm: 8px, md: 12px, lg: 16px, xl: 24px }
spacing: { xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, xxl: 48px }
components:
  card: { backgroundColor: "{colors.surface}", rounded: "{rounded.lg}", padding: 24px }
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.md}", padding: 12px }
  button-primary-hover: { backgroundColor: "#059669" }
  input: { backgroundColor: "{colors.surface}", rounded: "{rounded.md}", padding: 12px }
  stat-card: { backgroundColor: "{colors.surface}", rounded: "{rounded.lg}", padding: 24px }
  nav-item-active: { backgroundColor: "{colors.surface-muted}", rounded: "{rounded.md}" }
---
```

**Prose rules:** 1) warm paper light / deep charcoal dark; accent = only saturated color at scale; 60/30/10. 2) Inter everywhere; tabular-nums for ALL money; labels uppercase 12px tracked; nothing <12px. 3) max-width 1200px; 24px card padding; 16px grid; 240px sidebar. 4) hairline borders not heavy shadows. 5) 16px cards, 12px controls, 8px small; user-adjustable 0/8/16/24. 6) 150ms ease-out micro; 300ms transitions; 400ms number tweens; skeleton shimmer 1.2s; honor reduced-motion. 7) one high-emphasis action per screen; destructive = text/ghost until confirmed; every state designed. 8) Do: left-align money, positive green, label-light charts. 9) Don't: gradients at scale, text shadows, emoji in chrome, clashing accents, fun fonts. **Runtime:** accent/radius/density overridable via data-theme + inline CSS vars; charts derive from accent; theme JSON export/import.

---

## Appendix C — Build Command Playbook (pinned — no `@latest`)

```bash
pnpm create next-app@15.5.x open-finance --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes
pnpm dlx shadcn@latest init -d          # shadcn CLI is config-tool only; deps are pinned via package.json
pnpm dlx shadcn@latest add button card input dialog sheet select tabs badge skeleton toast dropdown-menu command
node migrations/up.js                    # SQLite schema + migrations (PRAGMA user_version)
node scripts/seed.js --seed-date 2026-01-01   # demo data, pinned for stable screenshots
npx cap add android                      # after pnpm build; CAP_SERVER_URL env
npx @capacitor/assets generate --android # icons/splash
pnpm screenshots                         # Playwright suite (SEED_DATE)
pnpm audit --prod && npx gitleaks git --redact
npx @google/design.md lint docs/DESIGN.md
gh repo create open-finance --public --source . --remote origin --push --description "…" --homepage "…"
```

---

## Appendix D — .env.example

```env
# Required
ENCRYPTION_KEY="openssl rand -base64 32"   # unique per install!
AUTH_SECRET="openssl rand -base64 32"

# Optional
DATABASE_PATH="./data/open-finance.db"
BIND_ADDRESS="127.0.0.1"                   # Connection Assistant sets 0.0.0.0 + URL in-app
PUBLIC_URL="http://localhost:3000"
DEMO_MODE=false
SEED_DATE="2026-01-01"                     # demo seed / screenshot determinism
WEBHOOK_SECRET=""
CAP_SERVER_URL=""                          # Android build: hub URL for connected mode
DEFAULT_AGENT_SCOPE="read-only"
# CI secrets: CI_PLAID_CLIENT_ID, CI_PLAID_SANDBOX_SECRET,
# ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS
```

---

## Appendix E — Target File Tree

```
open-finance/
├── migrations/                # numbered .sql + up.js runner
├── scripts/                   # seed.js, start.sh, start.bat, screenshots, og-crop
├── docs/                      # DESIGN.md · AGENTS.md · build-references/*
├── site/                      # static HTML+CSS microsite (no build step) + sitemap.xml
├── src/
│   ├── app/
│   │   ├── globals.css        # ★ design tokens (Kimi's main file)
│   │   ├── layout.tsx
│   │   ├── (marketing)/page.tsx
│   │   ├── (auth)/login|signup/page.tsx
│   │   ├── (app)/dashboard|accounts|transactions|budgets|plan|reports|settings|agents/page.tsx
│   │   └── api/…              # §8 routes
│   ├── components/            # ui/ layout/ dashboard|transactions|budgets|planning|reports|
│   │                          # onboarding|settings|auth|brand/ custom-views/ empty-state skeletons
│   ├── hooks/                 # queries, preferences, theme, pairing, session, detection
│   ├── lib/                   # env, crypto, rate-limit, api, copy, money, agent-connect, sessions
│   ├── server/
│   │   ├── db/                # adapter.ts, schema.sql
│   │   ├── domain/            # ingest, categories, budgets, reports, planning, projection, summary, manual-entry
│   │   ├── plaid/             # adapter.ts + server-impl.ts (+ native-impl P8b)
│   │   ├── authz/             # agent-auth.ts, route-registry.ts, permission-requests.ts, registry-test
│   │   ├── detect/            # hub-detect.ts, agents-detect.ts
│   │   └── mcp/               # index.ts, tools.ts, prompts.ts, resources.ts, mcp-cli.mjs
│   └── auth/                  # AuthProvider (session-cookie | device-lock)
├── android/                   # Capacitor + PlaidProxyPlugin.kt (+ LinkKit P8b) + cap-sqlite adapter
├── public/plaid-guide/  public/screenshots/  og-image.png
├── agent-manifest.json
├── .github/workflows/{ci,release,pages}.yml  .github/dependabot.yml
├── Dockerfile  docker-compose.yml  docker-compose.tls.yml  Caddyfile  .env.example
├── .npmrc  .gitleaks.toml  .gitignore  package.json (exact pins + engines)  pnpm-lock.yaml
└── next.config.ts (standalone + serverExternalPackages)
```

---

## Appendix F — Plaid Onboarding Screenshots (captured in P6)

`dashboard.plaid.com/signup` · Team Settings → Keys (client_id) · Keys (sandbox secret) · Keys (production/trial) · Link bank selector · Link login (Houndstooth) — no real values; in `public/plaid-guide/`.

---

## Appendix G — AGENTS.md skeleton (the AI-readable manual)

```markdown
# Open Finance — Agent Guide
Connect any MCP-capable agent (Hermes, OpenClaw, Claude Desktop, Cursor) or a
custom script. Read-only by default. You control what it can read and write —
and you can change that anytime.

## Quickstart (2 min)
1. App → Settings → Agents → "Connect your AI agent" (name, preset, expiry)
2. If the app detects your agent on this machine, use the tailored one-liner
   (or "Configure for me").
3. "Test it" to see the exact JSON your agent receives.
4. Ask: "summarize my finances" / "flag anything unusual" / "build a weekly report"

## Permissions
Read-only by default (summary + banking + budgets; investments are NOT included
in the default but CAN be granted — in presets, chips, or when the agent asks).
Custom tokens add any read/write scopes, account allowlists, and dev:ui.
GET /api/agent/capabilities shows exactly what a token can do — and what's missing.

## Missing permissions
If a tool needs a scope the token lacks, the app returns:
  403 { "error": { "code": "insufficient_scope", "missing": ["read:investments"], … } }
and the app asks the user to grant it (Settings → Agents → permission requests).
You cannot grant yourself permissions. Tell the user which scope you need.

## Endpoints
- MCP: stdio `node /abs/path/dist/mcp-cli.mjs --url <URL> --token <TOKEN>` or HTTP `<URL>/mcp`
- REST: GET /api/agent/summary (Bearer token) — OpenAPI at /api/openapi.json
- Events: SSE GET /api/agent/events (incl. permission_requested)

## Tools (annotated per token)
get_financial_summary · get_capabilities · list_accounts · list_transactions ·
search_transactions · get_transaction · get_spending_by_category · get_cashflow ·
get_net_worth · get_budgets · get_budget_progress · get_planning_items · trigger_sync
(opt-in): set_transaction_category · create/update/delete_budget ·
upsert_planning_item · create/update/delete_category · update_settings ·
list/create/update/delete_custom_view

## Example prompts
- "Summarize my finances this month and flag anything unusual."
- "Warn me if a transaction over $500 posts."
- "What does my 12-month projection look like? Any negative months?"
- "Add a widget to my dashboard showing spending by category this month."

## Security
- Read-only default; every call logged (scope, tool, status) under Settings → Agents.
- Your agent can see your finances — treat its context and output accordingly.
- Revoke anytime; tokens expire on schedule.
```

---

## Appendix H — GitHub Wiring (owner: DeseretSaint — verified active)

```bash
gh api user --jq .login    # expect: DeseretSaint

gh repo create open-finance --public --source . --remote origin --push \
  --description "Open Finance — self-hosted, open-source personal finance app. Bring your own Plaid keys (or none — manual entry), bring your own agent (MCP, tiered permissions). SQLite everywhere: desktop solo · hub · phone. Bills, debts, goals & projection." \
  --homepage "https://github.com/DeseretSaint/open-finance"

gh repo edit open-finance --default-branch main --enable-issues=true --enable-wiki=false \
  --add-topic self-hosted,personal-finance,finance,budgeting,nextjs,react,sqlite,plaid,byoa,mcp,capacitor,android,pwa,typescript,privacy,opensource

# Branch protection: apply AT P10 (after the one-shot push flow completes)
gh api -X PUT repos/DeseretSaint/open-finance/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" -f "required_status_checks[contexts][]=ci" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -f "enforce_admins=false" -f "required_linear_history=true" \
  -f "allow_force_pushes=false" -f "allow_deletions=false"

gh secret set CI_PLAID_CLIENT_ID --body "..."            # sandbox e2e (job guarded; demo-smoke fallback for forks)
gh secret set CI_PLAID_SANDBOX_SECRET --body "..."
gh secret set ANDROID_KEYSTORE_B64 < keystore.b64
gh secret set ANDROID_KEYSTORE_PASSWORD --body "..."
gh secret set ANDROID_KEY_ALIAS --body "..."
gh api -X POST repos/DeseretSaint/open-finance/secret-scanning/push-protection
# Pages: Settings → Pages → GitHub Actions (site/ artifact)
```

---

## Appendix I — Discovery & SEO (the "show up in search" pass)

1. **README (P10)** — H1: *"Open Finance — self-hosted, open-source personal finance app (bring your own Plaid keys · or none · bring your own agent)"*. Hero sub-line: *"Own your data. Bring your own Plaid keys — or track manually. Even bring your own AI agent — optional, but it's the headline."* Reusable line: **"The finance app that lets you bring your own agent — and asks permission before it looks anywhere."** Sections: quickstart (all 3 shapes), **"Bring Your Own Agent — the feature you don't have to use"** (screenshot of Agents panel + permission-request inbox; three bullets: read-only by default, you control read & write limits, your agent asks before it looks anywhere; link to AGENTS.md), manual-entry vs Plaid, security, FAQ (incl. "Do I need an AI agent? No — everything works without one. BYOA is 100% optional."), comparison table, license.
2. **GitHub surface**: description + 15 topics + README pinned + og:image 1200×630.
3. **Microsite (`site/`, static)**: hero = core promise + three shape cards; BYOA = section two (screenshot/GIF of permission request); CTAs "Get started", never "Connect your agent"; meta description + canonical + sitemap.xml.
4. **Launch checklist**: awesome-selfhosted PR · r/selfhosted + r/opensource · Show HN ("BYOA: bring your own agent + bring your own Plaid keys") · Product Hunt (optional) · X/Bluesky.
5. **Measure**: stars/insights, search console, README views; iterate keywords in v1.1.

---

## Appendix J — Wiring Matrix (no dead ends, mechanically enforced)

> The build must pass the **registry-completeness test** (J.5) in CI: every scope has ≥1 route, every MCP tool maps to a scope + endpoint, every table has ≥1 consumer. This appendix is the source of truth the registry is generated from.

### J.1 Tables → consumers
| Table | Consumers |
|---|---|
| users | auth endpoints, sessions, device_lock, plaid_credentials/items, accounts(manual), budgets/planning, agent_tokens, pairing |
| sessions | auth middleware, /api/auth/sessions, logout-all |
| device_lock | mobile unlock (P1/P8a) |
| plaid_credentials | /api/plaid/credentials, plaid adapter |
| plaid_items | /api/plaid/items, sync engine |
| accounts | /api/accounts, /api/plaid/items list, transactions filter, reports, summary, allowlist |
| balance_history | net-worth report, summary |
| transactions | /api/transactions, ingest, budgets, reports, summary, search, manual POST |
| categories | /api/categories, budgets, transactions.userCategoryId |
| budgets + budget_categories | /api/budgets, progress |
| user_settings | /api/settings, cron, hub mode (P6) |
| bills / debts / goals | /api/planning/*, digest, projection |
| agent_tokens | agent-auth middleware, /api/agent/*, capabilities |
| agent_access_log | audit viewer |
| agent_permission_requests | /api/agent/requests, inbox, resolve |
| custom_views | /api/custom-views, widget-renderer |
| pairing_codes | /api/pairing/*, QR |

### J.2 Route registry (endpoint → required scope) — the enforcement truth
| Route (agent-accessible) | Required scopes |
|---|---|
| GET /api/agent/summary | read:summary |
| GET /api/accounts | read:banking OR read:investments (per account type + allowlist) |
| GET /api/transactions, GET /api/transactions/:id | read:banking OR read:investments |
| PATCH /api/transactions/:id | transactions:edit |
| GET /api/budgets, GET /api/budgets/:id/progress, GET /api/categories | read:budgets |
| POST/PATCH/DELETE /api/budgets* | budgets:write |
| GET /api/planning/* | read:planning |
| POST/PATCH/DELETE /api/planning/* | planning:write |
| POST/PATCH/DELETE /api/categories* | categories:write |
| GET /api/reports/* | read:reports (allowlist-filtered) |
| PUT /api/settings (agent) | settings:write |
| GET /api/settings (agent) | read:summary |
| POST /api/transactions/sync, POST /api/plaid/items/:id/refresh | sync:run |
| GET/POST/PATCH/DELETE /api/custom-views | dev:ui |
| GET /api/agent/capabilities | (always) |
| GET /api/agent/events | any read scope |
| NOT agent-accessible (user session only): /api/auth/*, /api/health, /api/hub/*, /api/pairing/*, /api/agents/detect, /api/export, /api/backup*, /api/accounts POST/PATCH/DELETE (manual), /api/transactions POST/DELETE (manual) | — |

### J.3 MCP tool registry (tool → scope → endpoint)
| Tool | Scope | Backing endpoint |
|---|---|---|
| get_financial_summary | read:summary | /api/agent/summary |
| get_capabilities | always | /api/agent/capabilities |
| list_accounts | read:banking\|read:investments | /api/accounts |
| list_transactions / search_transactions / get_transaction | read:banking\|read:investments | /api/transactions* |
| get_spending_by_category / get_cashflow / get_net_worth | read:reports | /api/reports/* |
| get_budgets / get_budget_progress | read:budgets | /api/budgets* |
| get_planning_items | read:planning | /api/planning/* |
| trigger_sync | sync:run | /api/transactions/sync |
| set_transaction_category | transactions:edit | PATCH /api/transactions/:id |
| create_budget / update_budget / delete_budget | budgets:write | /api/budgets* |
| upsert_planning_item | planning:write | /api/planning/* |
| create_category / update_category / delete_category | categories:write | /api/categories* |
| update_settings | settings:write | PUT /api/settings |
| list_custom_views / create_custom_view / update_custom_view / delete_custom_view | dev:ui | /api/custom-views* |

### J.4 Phases → deliverables → gates — see §14.
### J.5 Registry-completeness test (CI): iterate J.2 + J.3; fail if any scope has zero routes, any MCP tool lacks scope+endpoint, any table has no consumer, or any route is unmapped.

---

## Appendix K — Audit Log (what was audited and decided)

| Audit | Outcome |
|---|---|
| Product & UX (agent) | P0-1..4 accepted (assistant, offline honesty, manual entry, marketing demo) · P1-5..9 accepted (solo auth, recovery, dev:local defer, copy, DHCP) · P1-10 split v1.1 · P2-11..13 accepted (variable bills, backup/restore, rollover v1.1) |
| Build pipeline (agent) | P0-1..5 accepted (pins, build-references, protection at P10, MCP CLI path, P8 split + LinkKit + CI-only Android) · P1-6..13 accepted (deps, PWA truth, cleartext, gate gaps, Docker, static microsite, token discipline, NAT rate limit) · P2-14..18 accepted (Kimi diff check, SEED_DATE, Playwright, hygiene, og crop) |
| Architecture & security (completed in-house after 2 agent timeouts) | manual-row schema (nullable plaid ids, source flag), pairing TTL/single-use/hash, hub/agents detect safety contracts (no exec/no secrets/rate-limited), backup/restore auth + wrong-key test, recovery code, NAT-safe rate limiting, CSP/headers, Docker hardening, withAllowlist injection test |
| Wiring (in-house, automated) | gaps fixed via Appendix J: route→scope mapping, MCP tool registry, table→consumer matrix, registry-completeness test; compact-notation false positives verified OK |

---

## Appendix L — Build References (commit before P1; agents copy, don't invent)

`docs/build-references/` must contain working snippets for the four highest-drift areas (build audit P0-2): `mcp-streamable-http.ts` (Next 15 route handler: `runtime='nodejs'`, `force-dynamic`, McpServer + StreamableHTTPServerTransport) · `plaid-proxy-plugin.kt` (skeleton: 6 methods, OkHttp, EncryptedSharedPreferences, LinkKit hook) · `cap-sqlite-adapter.ts` (async adapter implementing the DB interface) · `serwist-next15.ts` (Next 15 + Serwist 9 wiring) · `next.config.ts` (`output:'standalone'`, `serverExternalPackages:['better-sqlite3']`) · `qr-pairing.md` (start/accept flow, 10-min TTL, deep link). Each brief references them explicitly.

---

*Next: your "go". Plan v5 = audited (product, build, security, wiring), copy-corrected, pinned, wired with a mechanical no-dead-ends test, and confirmed on every open decision (one flag: dev:local deferred to v1.1 — veto anytime). Nothing left to discover mid-build.*
