#!/usr/bin/env bash
# Open Finance launcher (macOS / Linux)
# Opens the app on localhost (secure context → PWA installable).
set -euo pipefail

cd "$(dirname "$0")/.."

# Node 22 preferred (engines: >=22 <23); falls back to whatever node is on PATH.
if command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  source "$(nvm dir 2>/dev/null || echo "$HOME/.nvm")/nvm.sh" >/dev/null 2>&1 || true
  nvm use 22 >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 is required. Install it from https://nodejs.org" >&2
  exit 1
fi

export NODE_ENV=production
export HOSTNAME=127.0.0.1
export PORT="${PORT:-3000}"

# First run: install deps + build.
if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  corepack enable 2>/dev/null || true
  pnpm install --frozen-lockfile
fi
if [ ! -d .next/standalone ]; then
  echo "Building…"
  pnpm build
fi

node migrations/up.js
mkdir -p data

# Open the browser once the server is up.
( for i in $(seq 1 60); do
    curl -sf http://127.0.0.1:"$PORT"/api/health >/dev/null 2>&1 && {
      open "http://127.0.0.1:$PORT" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT" 2>/dev/null || true
      break
    }
    sleep 1
  done ) &

exec node .next/standalone/server.js
