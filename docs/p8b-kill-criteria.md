# P8b — Mobile Solo: DONE (v1.1.0 shipped 2026-07-31)

**Status:** ✅ Shipped · **Release:** v1.1.0 (standalone APK) · **Commit:** b8a55ee

## What shipped

The APK is now **generic and standalone** — no hub, no server, no baked-in URL.
Anybody can download, bootstrap their device (recovery code + PIN), use the app
fully on-device (local SQLite), bring their own Plaid keys, and connect their
own hub later.

## Kill criteria → status

| Criterion | Status |
|---|---|
| Webview loads bundled app (no CAP_SERVER_URL) | ✅ capacitor.config.ts — `server.url` only when explicitly set |
| Local SQLite (CapSqliteDb) + schema | ✅ cap-sqlite.ts v8 API + migrations-bundle (generated, parity-checked in CI) |
| Same SQL on server + phone | ✅ Db interface in types.ts (no better-sqlite3 import); db/registry.ts provider indirection |
| Device row + recovery code + PIN | ✅ solo-bootstrap.ts (WebCrypto-safe) + device-lock.ts refactored off node:crypto |
| Plaid on-device (no server) | ✅ native.ts over PlaidProxyPlugin + LinkKit wired (sdk-core 5.5.2) |
| Solo API surface (in-process /api/*) | ✅ solo-router.ts — auth/bootstrap, device-lock, accounts, categories, transactions, budgets, summary, reports, planning, projection |
| Domain layer bundles into webview | ✅ api-error.ts (no next/server), uuid.ts (global crypto), webcrypto-shim.ts |
| CI gates | ✅ ci.yml + apk-build.yml; client bundle verified free of better-sqlite3 |

## Verified

- `pnpm typecheck` / `lint` / `test` (171 tests) / `build` — all green
- Client chunks: **zero** better-sqlite3 references
- APK artifact `open-finance-v1.1.0-standalone.apk` (30 MB) — `server.url` absent
- SHA256: `2b4c03168d14fc510554982306891f30055c113109449c42d2d1a54215961f42`

## Known gaps (next phase candidates)

- Plaid screens in solo mode need the native proxy's LinkKit launch flow tested
  on a real device (CI compiles, but no Android SDK locally)
- Share-to-agent, backup/restore, MCP routes are hub-only for now
- Sync engine (Plaid sync) runs on the hub; solo relies on LinkKit + manual entry
