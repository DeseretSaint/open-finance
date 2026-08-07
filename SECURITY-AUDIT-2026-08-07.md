# Open Finance — Security Audit (2026-08-07)

Scope: full source review of the Open Finance app (repo `DeseretSaint/open-finance`, branch `main`, pre-v0.3.24).
Method: primary-source code read of auth, crypto, routing, Android FGS, updater, and dependency audit.
Severity: CRITICAL > HIGH > MEDIUM > LOW. "Self-hosted / solo" context means the threat model is
(device theft, malicious app on same LAN, XSS-in-webview, supply-chain) more than multi-tenant SaaS.

## Findings

### CRITICAL
- **C1 — Remote token disclosed in plaintext via `GET /api/agent/remote` (no auth gate).** ✅ FIXED.
  `GET /api/agent/remote` now returns only `{enabled, port}` — never the token. The raw token is
  returned exactly once in the `POST /api/agent/remote/enable` response (display-once in the UI).
  Remote (header-carrying) requests to any other route require a Bearer token; GET status is the
  one readable-without-token path and leaks nothing sensitive.

### HIGH
- **H1 — Remote token stored plaintext + non-timing-safe compare.** ✅ FIXED. Token is now
  `hashSecret()` (SHA-256) at rest; compares with `safeEqual` (timing-safe). A legacy raw value
  still authenticates once, then is migrated to the hash (backward-compatible).
- **H2 — FGS socket binds to all interfaces `0.0.0.0`.** ⚠️ INTENTIONAL / MITIGATED. The app has no
  Tailscale SDK — the agent reaches the phone at its `100.x.y.z` Tailscale address, and those packets
  arrive destined for that address (not loopback), so binding to `127.0.0.1` would *break* remote
  access. Correct mitigation is the **token gate** (H1/C1): every remote request must present the
  device-local bearer. The port only listens while remote access is enabled. On a hostile LAN an
  attacker still needs the token. (If a Tailscale SDK is later added, bind to the Tailscale interface
  address specifically.)
- **H3 — Updater APK download has no host allowlist.** ✅ FIXED. `UpdaterPlugin.downloadAndInstall`
  now rejects non-https URLs and any host not in a pinned allowlist (`github.com`,
  `*.githubusercontent.com` release-asset hosts). Redirects are disabled (`followRedirects(false)`,
  `followSslRedirects(false)`) so a 302 cannot redirect the download off-trust. SHA256 still verifies
  integrity against the release metadata.

### MEDIUM
- **M1 — Recovery code compared with `!==`.** ✅ FIXED. Now uses `safeEqual` (timing-safe), like the
  password reset path.
- **M2 — `auto_granted` scope expansion.** Unchanged (bounded by user caps; `autoApproveReads` off by
  default). Acceptable.
- **M3 — `secure` cookie flag.** ✅ FIXED. `isHttps()` now defaults to `secure` unless
  `OF_ALLOW_INSECURE_COOKIE=true` is explicitly set (local HTTP dev only). Hub deploy enforces TLS.
- **M4 — Committed `android/keystore/debug.jks`.** ✅ FIXED. Removed from git tracking (`git rm
  --cached`), now covered by `.gitignore` (`*.jks`). File kept on disk so local builds keep a stable
  debug signing identity. Release builds use a separate CI-injected keystore.

### Added in continuation pass (turns 11–20)
- **H4 — Device lock NOT enforced on the remote/API surface.** ✅ FIXED (correctly scoped). The
  remote bearer **authorizes the agent even when the device is locked** — this is intentional: the
  foreground service's purpose is to serve the agent while the screen is off. The real hole was the
  *no-token bypass* (C1/H1): a Locked device could be reached with no credential. Now a valid Bearer
  is always required for remote data access. In-app webview calls are gated by the UI PIN pad plus a
  server-side 423 when `deviceLock.locked` (routes the lock screen needs are exempt).
- **M5 — `allowMixedContent: true` + `cleartext: true` in capacitor.config.** ⚠️ PARTIAL. Kept
  cleartext (needed for user-entered LAN/Tailscale hub hosts) but added `InsecureHubWarning` — a
  top-banner warning when the webview loads over plain HTTP on a non-local, non-Tailscale host.
- **M6 — In-memory rate limiter resets on restart.** Unchanged (documented acceptable for
  single-process self-hosted; DoS-quality, not confidentiality/integrity).
- **Verified safe (continuation):** [unchanged] backup/restore PBKDF2+GCM; pairing hashed+TTL; no
  cloud secrets in git; `dangerouslySetInnerHTML` static; device-lock state route pre-auth by design.

### LOW / INFO (verified safe)
- SQL: all queries parameterized; the only `${table}` interpolations (`auth/service.ts:213`,
  `solo-backup.ts:232`) use a hardcoded allowlist array — no injection.
- No hardcoded secrets in source (grep for SK-/AKIA/ghp_/private-key found nothing). `.env` gitignored.
- `npm audit --prod`: **no known vulnerabilities.**
- Session cookie: `httpOnly: true, sameSite: "lax"` — good; CSRF covered by custom token (44 routes
  call `requireCsrf`). No `Access-Control-*` headers anywhere (no cross-origin leakage).
- Agent authz: `requireAgentScope` enforces scopes; token scopes ∩ user caps (`effectiveScopes`);
  MCP server re-checks scopes per tool (`requireScopes`). Well-designed.
- Crypto: AES-256-GCM with per-record AAD (`userId:recordId`) — good; key derived via SHA-256 of
  `ENCRYPTION_KEY` (ensure `ENCRYPTION_KEY` is high-entropy + 32+ bytes; consider scrypt/argonid
  stretch). Plaid access tokens encrypted at rest — good.
- Android manifest: no `exported="true"` components besides MainActivity (launcher); FGS is
  `exported="false"`; FileProvider `exported="false"` with grantUriPermissions — good.

## Prioritized fixes (recommended order)
1. ✅ C1 — `GET /api/agent/remote` returns `{enabled, port}` only; token is display-once at enable.
2. ✅ H1 — remote token hashed at rest (SHA-256) + timing-safe compare; legacy raw migrated on use.
3. ⚠️ H2 — bind stays `0.0.0.0` (Tailscale needs it); exposure mitigated by the H1/C1 token gate.
4. ✅ H3 — updater host allowlist (GitHub only) + redirect disabled + https-only.
5. ✅ M1/M3/M4 — timing-safe recovery compare; `secure` cookie default-on; debug keystore gitignored.
6. ✅ H4 — remote bearer always required; device stays unlocked-for-agent by design; in-app 423 gate.
7. ⚠️ M5 — `InsecureHubWarning` banner for plain-HTTP non-Tailscale hubs (cleartext retained).

## Verification done
- `pnpm audit --prod` → clean.
- grep for hardcoded secrets → none. SQL injection → only safe hardcoded allowlists.
- read auth (agent/session/remote), crypto, updater, FGS, manifest, CSRF, MCP scope enforcement.
- Kotlin (FGS bind, updater) reviewed by read (no local Android SDK to compile — CI compiles).
- **Gates after fixes:** `pnpm typecheck` ✅, `pnpm test` 267 passing ✅, `pnpm lint` 0 errors ✅,
  `pnpm build` (web) ✅, `pnpm build:mobile` ✅. New tests in `tests/remote-access.test.ts` cover
  C1/H1/H4 behavior (hash-at-rest, GET-leak, bearer-required, legacy-migration, locked-device-remote).
