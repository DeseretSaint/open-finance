# Open Finance — self-hosted, open-source personal finance app

**Bring your own Plaid keys — or none. Bring your own agent — optional, but it's the headline.**

> *The finance app that lets you bring your own agent — and asks permission before it looks anywhere.*

- 🏠 **Runs anywhere** — desktop solo · hub (LAN / Tailscale) · phone (APK / PWA, paired via QR)
- 🔐 **You own your data** — SQLite on your machine, AES-256-GCM at rest, no cloud, no middleman
- 🔑 **Bring your own Plaid keys** — or skip Plaid entirely (manual entry is first-class)
- 🤖 **Bring your own agent** — MCP integration, read-only by default, you control every read & write permission, your agent asks before it looks anywhere
- 📅 **Plan ahead** — bills, debts, savings & investment goals, and a 12-month projection

---

## Quickstart

**Option A — desktop solo (no server needed).** One line, any macOS/Linux machine with Node 22:

```bash
curl -fsSL https://raw.githubusercontent.com/DeseretSaint/open-finance/main/scripts/install.sh | bash
```

It downloads the app, installs dependencies, builds, and opens `http://localhost:3000` — then create your account, add Plaid keys or track manually. (Prefer to run from source? `pnpm install && pnpm build && ./scripts/start.sh`.)

**Option B — hub on your LAN / Tailscale.** Run the app on a desktop or small server, then pair your phone from Settings → Hub & phone pairing. The Connection Assistant detects the right URL (LAN IP or Tailscale MagicDNS) and shows a QR code; the phone scans it and connects in one tap.

**Option C — Docker.** `docker compose up` — the image runs non-root with `HEALTHCHECK /api/health`, SQLite on a volume, env-only secrets.

**Option D — Android APK.** Grab the latest signed APK from the [releases page](https://github.com/DeseretSaint/open-finance/releases) — QR-pair it to your hub (or run it fully on-device in solo mode).

---

## Bring Your Own Agent — the feature you don't have to use

Every part of the app works with no agent at all. If you do connect one (Hermes, OpenClaw, Claude, Cursor, or any MCP-capable agent), it starts **read-only**:

- **Read-only by default** — a fresh token can see a summary and your banking accounts, nothing else.
- **You control read & write limits** — pick presets or exact scopes (investments, reports, editing, sync…), restrict to specific accounts, set an expiry.
- **Your agent asks before it looks anywhere** — hitting a permission wall creates a request in your inbox; you Grant or Deny, and every call lands in the audit log.

See [`docs/AGENTS.md`](docs/AGENTS.md) for the full integration manual and [`agent-manifest.json`](agent-manifest.json) for the machine-readable manifest.

## Manual entry vs Plaid

| | Manual | Plaid |
|---|---|---|
| Accounts & transactions | Fully supported, first-class | Synced automatically |
| Cost | Free forever | Your free Sandbox/Trial keys |
| Setup | Instant | Paste keys → Link → done |
| Offline | Works anywhere | Needs the hub |

## Security

- SQLite with **AES-256-GCM encryption at rest** — the DB file alone is unreadable without your `ENCRYPTION_KEY`.
- Session cookies HttpOnly + SameSite=Lax, CSRF via `x-of-request: 1`, rate limits keyed by IP+username, generic login errors, recovery-code password reset.
- Agent tokens hashed at rest (`of_` prefix), revocable, expiring, per-account allowlists, full audit log, permission requests for anything out of scope.
- Security headers (CSP, DENY framing, nosniff), parameterized SQL only, gitleaks + `pnpm audit` in CI, [SECURITY.md](SECURITY.md) with a disclosure policy.

## FAQ

**Is it really free?** Yes — MIT licensed, self-hosted, no accounts with us, no fees. Plaid usage uses *your* free Sandbox/Trial keys.

**Do I need my own Plaid API keys?** For real bank connections, yes — they're free (Sandbox or the Trial plan). You can also use the app with no Plaid at all via manual entry.

**Do I need an AI agent?** No — everything works without one. BYOA is 100% optional.

**Does it work on my phone?** Yes — the Android APK connects to your hub via QR pairing (with a device PIN lock). A fully on-device solo mode is planned for v1.1.

## Documentation

| Document | Where |
|---|---|
| Developer overview — architecture, how it works, build & test | [`docs/PLAN.md`](docs/PLAN.md) |
| Design tokens & visual contract | [`docs/DESIGN.md`](docs/DESIGN.md) |
| AI-agent integration manual (BYOA) | [`docs/AGENTS.md`](docs/AGENTS.md) |
| Machine-readable agent manifest | [`agent-manifest.json`](agent-manifest.json) |
| Mobile roadmap & kill-criteria decision | [`docs/p8b-kill-criteria.md`](docs/p8b-kill-criteria.md) |

## License

[MIT](LICENSE)
