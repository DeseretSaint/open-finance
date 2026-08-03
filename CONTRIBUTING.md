# Contributing

Thanks for your interest in Open Finance!

## Ground rules

- **Read [`docs/PLAN.md`](docs/PLAN.md) first** — it is the contract: architecture, schema,
  API, design tokens, roadmap, and development phases. Changes to behavior should update the plan.
- **Every feature must have a purpose** — if it doesn't earn its place, it doesn't land.
- **No secrets, ever.** No real keys, tokens, passwords, or `.env` files in commits
  (gitleaks runs in CI and will fail the build).
- **Design tokens come from `docs/DESIGN.md`** — do not invent new colors/spacing.

## Development flow

- Branch from `main`, open a PR, CI must be green (`ci` status check).
- Commit style: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- Tests: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`.
- Visual changes: update the screenshot suite (`pnpm screenshots`) in the same PR.

## Architecture at a glance

- Next.js 15 (App Router) · React 19 · Tailwind v4 + shadcn/ui
- SQLite everywhere (raw SQL module; `better-sqlite3` on server, `cap-sqlite` on Android)
- Hand-rolled sessions auth · REST + zod
- Plaid via a server adapter (or the native Android proxy plugin)
- BYOA: MCP server + tiered scopes + permission requests

## Building the Android APK

The APK is built in CI (`release.yml`) — you do not need a local Android SDK to
contribute. See `docs/PLAN.md` Appendix H for signing secrets.

## Code of conduct

Be kind, be constructive. Harassment of any kind is not tolerated.
