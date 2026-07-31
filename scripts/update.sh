#!/usr/bin/env bash
# Open Finance self-updater (bare-metal / git installs).
# Triggered by the app's "Update now" or a scheduled update. Detached by the
# server, so it survives the server restart. On success it rebuilds and
# restarts the standalone server in the background.
#
# Env:
#   OPEN_FINANCE_UPDATE=1   set by the app when invoking (skips this safety)
#   UPDATE_SCRIPT_DIR       optional override for the repo root
#   PORT / HOSTNAME         passed through for the restarted server
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="${UPDATE_SCRIPT_DIR:-$PWD}"

if [[ "${OPEN_FINANCE_UPDATE:-}" != "1" ]]; then
  echo "Refusing to run directly — invoke via the app (Update now / scheduled)." >&2
  exit 1
fi

log() { echo "[update $(date +%H:%M:%S)] $*"; }

log "pulling latest…"
git fetch origin main
git reset --hard origin/main

log "installing dependencies…"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
pnpm install --frozen-lockfile

log "building…"
pnpm build

# Migrations run on next boot (entrypoint / start script runs migrations/up.js).

log "restarting server…"
# Kill the current standalone server, then relaunch detached.
pkill -f "node .next/standalone/server.js" || true
sleep 1
PORT="${PORT:-3000}" HOSTNAME="${HOSTNAME:-127.0.0.1}" NODE_ENV=production \
  nohup node .next/standalone/server.js >> data/server.log 2>&1 &
disown || true

log "done — Open Finance updated and restarted."
