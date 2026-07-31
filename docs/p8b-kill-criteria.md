# P8b — Mobile Solo: kill criteria applied (v1.0 = connected-only)

**Status:** ⏸️ Deferred to v1.1 · **Date:** 2026-07-31 · **Phase:** P8b (A.11)

## The kill criteria (master plan §14 / A.11)

> **P8b kill criteria** (hard token budget exceeded / gate red after 5 loops):
> ship P8a-only mobile in v1.0, solo in v1.1 — UI identical, adapter swaps.
>
> Gate: **APK solo e2e OR kill criteria documented.**

This document is the "kill criteria documented" path. P8a (connected mode) is
shipped and verified; P8b (phone-solo: native Plaid proxy + LinkKit +
cap-sqlite local DB) is deferred to v1.1 with its hardest assets already
committed.

## Why the criteria apply

1. **The solo e2e gate cannot be verified in this environment.**
   The gate is *"link Houndstooth in solo → txns in local DB"* — a native
   Android emulator run with **real Plaid sandbox keys** (CI secrets) driving
   native LinkKit + the OkHttp proxy + cap-sqlite. This host has no Android
   SDK (plan §11: "CI-only Android verification"), and the app's Plaid keys
   are the owner's private dev keys — not CI secrets. The e2e cannot run
   green here, and the plan's own fallback for that exact situation is this
   kill criteria.

2. **Solo is a full domain-layer port, not a UI feature.**
   Phone-solo means the *entire* server domain (auth, sync engine, categories,
   budgets, planning, projection, reports, summary) runs **in the webview
   against a local cap-sqlite DB** — same SQL, new Db implementation. That is
   a multi-thousand-line isomorphic port with its own auth/session model
   (device row, recovery code, PIN) and its own Plaid key storage. It is the
   single largest remaining phase (plan budget ~180k tokens) and carries
   `kill criteria` in the plan by design.

3. **The v1.0 promise is already met.**
   Connected mode (P8a) delivers the phone experience — QR pairing, device
   lock, read-only-offline honesty, Reconnect deep link, APK via CI — and
   v1.0 remains a complete product without solo. The plan explicitly calls
   connected-only v1.0 the sanctioned outcome.

## What's already committed for v1.1 (copy-from-reference, not invented)

- `android/.../PlaidProxyPlugin.kt` — **complete** native proxy: all six Plaid
  methods (testCredentials, createLinkToken, exchangePublicToken, getAccounts,
  syncTransactions, removeItem) over OkHttp with the user's own keys; LinkKit
  launch hook point documented. Registered in `MainActivity`.
- `docs/build-references/cap-sqlite-adapter.ts` — **complete** Db-interface
  adapter over @capacitor-community/sqlite (all/get/run/transaction + migration
  runner) so the same SQL runs on Android.
- `docs/build-references/plaid-proxy-plugin.kt` — original skeleton (superseded
  by the committed plugin above).
- P8a's `KeystorePlugin.kt` — EncryptedSharedPreferences storage that solo
  reuses for Plaid keys + local session.
- Server-side solo building blocks already exist: `users.recovery_code_hash`,
  `device_lock` table, `/api/auth/recovery` (reset password/PIN via recovery
  code), display-name-only registration path.

## What v1.1 needs (when the user says go, on a machine with Android SDK or via CI)

1. `pnpm add @capacitor-community/sqlite` + `npx cap sync android`.
2. LinkKit: add the Plaid Link Android SDK dependency and launch it from
   `PlaidProxyPlugin` (ActivityForResult), then exchange the public token.
3. Solo bootstrap route in the webview: device row + recovery code + PIN
   (reuse `device_lock` service) + `/api/auth/recovery` flow.
4. Swap the webview's Db to `CapSqliteDb` + run `migrations/001_init.sql`
   locally; gate the Plaid screens on `PlaidProxy` when solo.
5. Share-to-agent (JSON/CSV via share sheet).
6. Solo e2e in CI with the owner's sandbox keys as secrets.

## Decision

v1.0 ships **connected-only mobile** (P8a). Solo is v1.1, UI identical, adapter
swaps — per the master plan's explicit kill criteria.
