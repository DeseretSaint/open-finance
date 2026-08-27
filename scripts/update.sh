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

# ── Pre-update data snapshot (D1) ───────────────────────────────────────────
# No update may be able to destroy un-backed-up data. Before touching the
# tree, copy the live DB (+ wal/shm) aside; keep the last 3 snapshots. The
# previous build is also preserved so a failed build rolls back to it.
DATA_DIR="$REPO/data"
SNAP_DIR="$DATA_DIR/update-snapshots"
mkdir -p "$SNAP_DIR"
if [[ -f "$DATA_DIR/open-finance.db" ]]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  SNAP="$SNAP_DIR/$STAMP"
  mkdir -p "$SNAP"
  cp -a "$DATA_DIR/open-finance.db" "$SNAP/" 2>/dev/null || true
  cp -a "$DATA_DIR/open-finance.db-wal" "$SNAP/" 2>/dev/null || true
  cp -a "$DATA_DIR/open-finance.db-shm" "$SNAP/" 2>/dev/null || true
  log "data snapshot saved → $SNAP"
  # keep last 3
  ls -1dt "$SNAP_DIR"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
fi

# Preserve the previous build so a failed build can't strand the install.
if [[ -d "$REPO/.next" ]]; then
  rm -rf "$REPO/.next.previous"
  cp -a "$REPO/.next" "$REPO/.next.previous" 2>/dev/null || true
fi

rollback() {
  log "UPDATE FAILED — rolling back."
  if [[ -d "$REPO/.next.previous" ]]; then
    rm -rf "$REPO/.next"
    mv "$REPO/.next.previous" "$REPO/.next"
    log "previous build restored."
  fi
  git reset --hard HEAD@{1} 2>/dev/null || true
  PORT="${PORT:-3000}" HOSTNAME="${HOSTNAME:-127.0.0.1}" NODE_ENV=production \
    nohup node .next/standalone/server.js >> data/server.log 2>&1 &
  disown || true
  log "rolled back to the previous version; your data was never touched (snapshot in $SNAP_DIR)."
  exit 1
}
trap rollback ERR

log "pulling latest…"
git fetch origin main
git reset --hard origin/main

log "installing dependencies…"
# Portable PATH for node/pnpm: prefer a node on PATH (and its bin dir), then
# fall back to an nvm-installed node if present. Do NOT hardcode absolute
# nvm version dirs — they don't exist on most installs (and on macOS the
# login shell is zsh, so ~/.nvm/nvm.sh isn't sourced by default). Mirrors the
# resolution already used by start.sh / install.sh.
if command -v node >/dev/null 2>&1; then
  export PATH="$(dirname "$(command -v node)"):$PATH"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  nvm use 22 >/dev/null 2>&1 || true
  command -v node >/dev/null 2>&1 && export PATH="$(dirname "$(command -v node)"):$PATH"
fi
pnpm install --frozen-lockfile

log "building…"
pnpm build

# Build succeeded — the rollback path is no longer needed.
trap - ERR
rm -rf "$REPO/.next.previous"

# Migrations run on next boot (entrypoint / start script runs migrations/up.js).

log "restarting server…"
# Kill the current standalone server, then relaunch detached.
pkill -f "node .next/standalone/server.js" || true
sleep 1
PORT="${PORT:-3000}" HOSTNAME="${HOSTNAME:-127.0.0.1}" NODE_ENV=production \
  nohup node .next/standalone/server.js >> data/server.log 2>&1 &
disown || true

log "done — Open Finance updated and restarted."
