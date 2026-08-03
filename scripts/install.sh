#!/usr/bin/env bash
# Open Finance — one-line desktop installer (macOS / Linux)
#
#   curl -fsSL https://raw.githubusercontent.com/DeseretSaint/open-finance/main/scripts/install.sh | bash
#
# Downloads the latest main, installs dependencies, builds, and starts the
# app at http://localhost:3000 (open your browser there). Data lives in a
# SQLite file under the install dir — your machine, your data.
set -euo pipefail

DIR="${OPEN_FINANCE_DIR:-$HOME/.open-finance}"
PORT="${PORT:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js 22+ is required. Install it from https://nodejs.org (or via nvm), then re-run this command." >&2
  exit 1
fi

echo "→ Installing Open Finance to ${DIR} …"
mkdir -p "$DIR"
curl -fsSL "https://github.com/DeseretSaint/open-finance/archive/refs/heads/main.tar.gz" \
  | tar -xz --strip-components=1 -C "$DIR"

cd "$DIR"
echo "→ Installing dependencies …"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "→ Building (first build takes a minute) …"
pnpm build

node migrations/up.js
mkdir -p data

echo ""
echo "✅ Open Finance is ready → http://localhost:${PORT}"
echo "   (Ctrl+C stops it; run the same command again to update & restart)"
echo ""
export NODE_ENV=production
export HOSTNAME=127.0.0.1
export PORT
exec node .next/standalone/server.js
