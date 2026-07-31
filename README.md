# Open Finance

**Self-hosted, open-source personal finance app. Bring your own Plaid keys — or track manually. Bring your own AI agent — optional, but it's the headline.**

> *The finance app that lets you bring your own agent — and asks permission before it looks anywhere.*

- 🏠 **Runs anywhere** — desktop solo · hub (LAN / Tailscale) · phone (APK / PWA)
- 🔐 **You own your data** — SQLite on your machine, AES-256-GCM at rest, no cloud, no middleman
- 🔑 **Bring your own Plaid keys** — or skip Plaid entirely (manual entry is first-class)
- 🤖 **Bring your own agent** — MCP integration, read-only by default, you control every read & write permission, your agent asks before it looks anywhere
- 📅 **Plan ahead** — bills, debts, savings & investment goals, and a 12-month projection

---

## Documentation

| Document | Where |
|---|---|
| Developer overview — architecture, how it works, build & test | [`docs/PLAN.md`](docs/PLAN.md) |
| Design tokens & visual contract | [`docs/DESIGN.md`](docs/DESIGN.md) |
| AI-agent integration manual (BYOA) | [`docs/AGENTS.md`](docs/AGENTS.md) |
| Machine-readable agent manifest | [`agent-manifest.json`](agent-manifest.json) |

---

## The idea

- **You own your data.** It lives in a SQLite file on *your* machine or *your* hub. We run nothing.
- **You own the pipe.** Paste your own free Plaid keys (sandbox → trial plan) — or none at all.
- **You own your agent.** Connect your own Hermes, OpenClaw, or any MCP-capable agent in two minutes. Read-only by default; you control what it can read and write, including investments; it asks permission before it looks anywhere; every call is audited and revocable.
- **You own your plan.** Bills, debts, goals, and an honest projection of your standing.

## FAQ

**Is it really free?** Yes — MIT licensed, self-hosted, no accounts with us, no fees. Plaid usage uses *your* free Sandbox/Trial keys.

**Do I need my own Plaid API keys?** For real bank connections, yes — they're free (Sandbox or the Trial plan). You can also use the app with no Plaid at all via manual entry.

**Do I need an AI agent?** No — everything works without one. BYOA is 100% optional.

**Does it work on my phone without a server?** Yes — the Android app has a solo mode that runs fully on-device, or connects to your hub via a QR code.

---

## License

[MIT](LICENSE)
