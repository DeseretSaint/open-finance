# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| main (unreleased) | ✅ |

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Instead:

1. Open a **private security advisory** on GitHub:
   https://github.com/DeseretSaint/open-finance/security/advisories/new
2. Or email the maintainers (address to be added) with a subject line starting
   with `[SECURITY]`.

You should receive an acknowledgement within 7 days. We ask that you allow
time for a fix and disclosure before publishing details.

## What we take seriously

- Exposure of secrets (Plaid keys, session/agent tokens, `ENCRYPTION_KEY`, `AUTH_SECRET`)
- Unauthorized access to another user's data on a shared hub
- BYOA token privilege escalation (scope/allowlist bypass)
- XSS / CSRF / injection in the web app
- Supply-chain (dependency) compromise

## Disclosure policy

- We will credit reporters (unless anonymity is requested).
- We will publish a security advisory + patch release for verified issues.
- Coordinated disclosure: 90 days for high-severity, 30 days for critical.

## Hardening notes for users

- `ENCRYPTION_KEY` and `AUTH_SECRET` must be unique per install.
- Agent tokens grant financial read access — treat them carefully, revoke when unused.
- LAN mode = trust your network; prefer Tailscale or TLS for anything sensitive.
- Back up your SQLite file (`Settings → Backup` once shipped) — a backup is only
  restorable with the same `ENCRYPTION_KEY`.
