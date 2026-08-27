# User-Configured AI Provider (BYOA) — Design Doc

Status: DRAFT for Keaton's review. Backend/security surface is otherwise resolved
(see ledger). This doc specifies how the app lets the user pick their own
categorization/insight AI provider with **no hardcoded vendor** and a
**local/OSS-first default** — the open alternative to the current BYOA-MCP path.

## 1. Current state (already vendor-neutral)

- Categorization is a two-layer pipeline (`src/server/domain/categorizer.ts` →
  `autoCategorize`):
  1. `matchLearned` — the user's own past manual recategorizations (highest priority).
  2. `match` — Plaid `personal_finance_category` / `category_path` longest-pattern match.
  3. `matchByName` — merchant-name keyword fallback (`NAME_KEYWORDS`).
  - Anything still uncategorized is counted as `leftForAgent` and surfaced to the
    connected agent on its next poll.
- The agent is **brought by the user**: they run any model behind any MCP client
  and connect it to the app's MCP server with a scoped token. No vendor string
  exists in the app code. This is the "bring your own agent" (BYOA) path and it
  already satisfies "no hardcoded vendor."
- This doc covers the **gap**: a user who does *not* want to stand up their own
  agent/MCP client should still be able to point the app at an AI provider of
  their choice directly from Settings.

## 2. Goal

Let the user configure a direct AI provider in Settings:

- **Local/OSS-first default:** a self-hosted OSS model behind an
  OpenAI-compatible endpoint (e.g. a local Ollama instance). No account, no
  cloud, no key required for this mode.
- **User-supplied key (opt-in):** a hosted endpoint + the user's own API key,
  entered by the user. The app hardcodes **no** vendor base URL and **no** model
  list — the user supplies both.
- The provider is used **only** for the gray-area `leftForAgent` items. The local
  precedence chain (learned → Plaid → keyword) always runs first, so the provider
  is a fallback, never a required dependency.
- A provider suggestion is a **suggestion** the user confirms. A confirmed
  suggestion flows back through `recordLearning`, so the next identical-merchant
  charge is resolved locally (no provider call).

## 3. Data model

Add a user-scoped provider config (parity with how Plaid tokens are stored):

- New `ai_provider` row in `user_settings` (or a small `user_ai_provider` table):
  - `mode` — `local` | `hosted` (enum; default `local`).
  - `base_url` — user-supplied endpoint (text). Empty for the default local mode
    only if a configurable default is set in env; otherwise the user must enter it.
  - `api_key` — **encrypted at rest with AES-256-GCM + per-record AAD**, identical
    to `src/server/domain/phone-import.ts` / `backup.ts`. Never returned to the
    client in plaintext; written only behind session + CSRF + a confirmation
    password (mirror the backup-export gate).
  - `request_path` / `model` — optional, user-supplied (no app default beyond an
    empty field). The app sends a standard chat/completions-shaped request and
    parses a category name back; it does not assume a specific vendor schema.
- **Dependency:** storing this needs a server settings store. The `/api/settings`
  route + `settings:write` wiring is currently **unrouted** (queued under
  "Needs Keaton", run 20/31). This doc's implementation is BLOCKED on that
  decision — either (a) add the `ai_provider` column to `user_settings` + a scoped
  `/api/settings` subset route, or (b) extend `agent_prefs` to carry the provider
  config. Recommend (a) so the key lives beside other secrets.

## 4. Runtime boundary (single choke point)

All provider calls go through one server-side function, `suggestCategory(provider,
txn)`, so:

- The request shape, timeout, and retry are centralized (no per-page fetch, no
  user-controllable URL executed from the client — server holds `base_url`).
- The provider receives **only** the minimal context needed: the merchant name,
  amount, and the user's category list (names + ids). No account numbers, no
  balances, no other users' data.
- The response is constrained: the app maps the returned label to one of the
  user's existing category ids (or "no suggestion"); an unknown label is dropped,
  never stored as a new category automatically.
- Network egress is server-side only (no client-side `fetch` to an arbitrary
  host), keeping the CSP `connect-src` allowlist intact.

## 5. Security / privacy guarantees

- Secret at rest: AES-256-GCM + AAD, parity with Plaid tokens (no plaintext key
  in DB or backups beyond the existing envelope).
- Scope: provider config is per-user, user_id-scoped on every read/write; no
  cross-user access.
- No vendor lock-in: zero hardcoded base URLs or model names in source. The
  default local mode points only at a user-entered `base_url`.
- Fail-closed: if the provider is unreachable / returns garbage, the transaction
  stays uncategorized (same as today's `leftForAgent`) — never silently
  mis-categorized.
- Local-first: the default experience requires no cloud account; the hosted-key
  mode is an explicit opt-in the user enables.

## 6. Out of scope (Keaton decisions)

- Whether to keep **both** the MCP/BYOA path and the direct-provider path, or
  consolidate.
- The `/api/settings` store decision that unblocks persistence (see §3).
- Whether provider suggestions are auto-applied (after N confirmations) or always
  require a tap.
- Whether to expose the provider config in solo/phone mode (where there is no
  server) — likely gated to server mode only.

## 7. Acceptance criteria (when implemented)

- `pnpm typecheck && pnpm lint && pnpm test` green; `pnpm build` green.
- A settings screen lets the user pick `local` (enter an endpoint) or `hosted`
  (enter endpoint + key); key is written encrypted and never shown back in full.
- `autoCategorize` still runs the local chain first; only `leftForAgent` items
  reach the provider.
- A provider suggestion maps to an existing category id or is dropped; a confirmed
  suggestion is recorded via `recordLearning`.
- No hardcoded vendor string anywhere in `src/`.
- Live smoke: a local OSS endpoint categorizes a gray-area txn; an unreachable
  endpoint leaves the txn uncategorized (no crash, no mis-categorize).
