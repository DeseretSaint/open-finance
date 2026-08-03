-- 002_updates.sql — update notifications & scheduling state (per-install, hub-wide)
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- update decisions live here as JSON:
--   update.latest_version   "1.0.1"
--   update.latest_url       "https://github.com/DeseretSaint/open-finance/releases/tag/v1.0.1"
--   update.dismissed        "1.0.1"           (stop notifying about this version)
--   update.scheduled_at     ISO timestamp     (update scheduled for a specific time)
--   update.running          "1"               (an update is applying right now)
