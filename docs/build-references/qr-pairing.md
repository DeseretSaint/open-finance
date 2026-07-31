# QR Pairing — reference flow (P6 endpoints live; P8a wires the phone side)

## Server (already shipped in P6)

1. `POST /api/pairing/start` (session auth) — creates a single-use code with a
   **10-minute TTL**, hashed at rest. Returns `{ code, url, ttlSeconds }` where
   `url = <PUBLIC_URL>/pair?code=…`.
2. `POST /api/pairing/accept` (no session — the phone has none yet) — validates
   the code (exists, unused, not expired), marks it used, and issues a 30-day
   hub session cookie/token for the code's owner. Single-use: replay → 400.
3. `GET /api/pairing/start` — lists the user's active (unused) codes.

## Phone side (P8a)

- Scan the QR (jsqr) or open the `…/pair?code=…` deep link.
- The webview calls `POST /api/pairing/accept {code}` and stores the session
  token in Android Keystore via the native plugin (EncryptedSharedPreferences).
- "Reconnect" deep link re-opens the stored hub URL; offline → read-only toast
  "Connect to hub to edit".

## Why single-use + TTL

The QR encodes a capability, not a credential. If it leaks, it dies in 10
minutes and can't be replayed. The hub user sees active codes in Settings → Hub.
