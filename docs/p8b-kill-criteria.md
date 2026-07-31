# P8b — Mobile Solo: status update (foundation shipped, wiring in progress)

**Status:** 🚧 In progress (v1.1) · **Last updated:** 2026-07-31 · **Phase:** P8b (A.11)

## Where it started

P8b (phone-solo: native Plaid proxy + LinkKit + cap-sqlite local DB) was deferred
from v1.0 via the kill criteria. v1.0 shipped connected-only mobile (P8a).
This doc replaces the "deferred" status with the current build state.

## What's shipped (commit `24d7c94`, all gates green)

The entire solo foundation is committed and verified (168 tests, typecheck/lint/
build green, migration-parity CI gate added):

| Asset | File | Notes |
|---|---|---|
| **CapSqliteDb** | `src/server/db/cap-sqlite.ts` | Db impl over @capacitor-community/sqlite **v8** (API differs from the reference doc: `retrieveConnection(db, readonly)` returns the conn directly; `saveToStore` on SQLiteConnection; `run` returns `capSQLiteChanges`). Version-tracked migrations via `_migrations` table — idempotent re-runs. |
| **Db interface split** | `src/server/db/types.ts` | `Db`/`DbRow` moved out of `adapter.ts` so webview bundles import the interface without better-sqlite3. |
| **Mode detection** | `src/lib/mobile-mode.ts` | `resolveMobileMode(origin, storedHubUrl)`: native + no hub → solo; native + origin==stored hub → connected; plain web → connected. |
| **Solo bootstrap** | `src/server/domain/solo-bootstrap.ts` | Device user row (`device-<uuid>`), recovery code (shown once, stored hashed), PIN via device_lock, recovery reset. |
| **Dual-runtime PIN crypto** | `src/lib/pin-crypto.ts` | WebCrypto PBKDF2 (works in Node 22 AND webview). device-lock refactored onto it; same hex output → legacy rows valid. |
| **Native Plaid client** | `src/server/plaid/native.ts` | `PlaidClient` impl over the native `PlaidProxy` plugin + `launchNativeLink()`. |
| **Migration bundle** | `src/server/db/migrations-bundle.ts` | **GENERATED** by `scripts/gen-migrations-bundle.mjs`; parity enforced in CI (`pnpm check:migrations`). |
| **Android wiring** | `build.gradle`, `PlaidProxyPlugin.kt` | `@capacitor-community/sqlite` dep; LinkKit **sdk-core 5.5.2** (FastOpenPlaidLink handler API — matches minSdk 23/compileSdk 35; v6 would force API 26 + compileSdk 36); `launchLink` + result callback. |
| **capacitor.config** | `capacitor.config.ts` | Webview loads the bundled app; `CAP_SERVER_URL` only for connected-only builds. |

## What remains

1. **Solo API surface in the webview** — the app's UI calls `/api/*`; solo needs
   those calls to run domain services in-process against CapSqliteDb instead of
   HTTP. The domain services are already `createXService(db)` factories with DI —
   the work is wiring a solo router that constructs them with `CapSqliteDb`.
2. **Solo UI flows** — bootstrap screen (device row + recovery + PIN), Plaid
   screens gated on PlaidProxy when solo, LinkKit-driven linking.
3. **Share-to-agent** (JSON/CSV via share sheet).
4. **Solo e2e in CI** — link Houndstooth in solo → txns in local DB, with the
   owner's sandbox keys as secrets.
5. **Pair-to-hub later** — connected mode already exists (P8a QR pairing); solo
   → hub handoff needs a documented path (backup/restore exists; a sync merge
   is the stretch goal).

## Gotchas learned (so far)

- **cap-sqlite v8 API ≠ v7/reference doc**: `retrieveConnection` returns the
  connection directly (no `{result, connection}`), `saveToStore` lives on
  `SQLiteConnection` (not the conn), `run()` → `{changes: {changes, lastId}}`.
- **PBKDF2 salt semantics**: node's `pbkdf2Sync` hashed the salt string as UTF-8
  bytes; WebCrypto takes a byte array — feed it the UTF-8 of the stored salt
  string, NOT hex-decoded, or legacy hashes break and tests fail.
- **Kotlin only compiles in CI** (no local Android SDK) — verify new Android
  deps on the android.yml run; the local Mac can't compile-check Kotlin.
- **LinkKit v6** needs minSdk 26 + compileSdk 36 + the new session API
  (`createPlaidLinkSession`/`OpenPlaidLink`). Pinned 5.5.2 instead — handler
  API (`FastOpenPlaidLink`/`PlaidHandler`/`Plaid.create(appCtx, config)`)
  matches the project's pinned toolchain. Revisit v6 when the toolchain bumps.
- **Migration bundle must be generated, not hand-written** — the first hand
  attempt diverged from the real schema (20 vs 21 tables). The generator +
  byte-identical parity test + CI gate make divergence impossible going forward.
