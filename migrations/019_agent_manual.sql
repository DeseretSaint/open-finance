-- 018: user-editable AI steering manual (in-app agent instructions).
-- Per-domain guidance the connected agent reads on every poll, so guidance
-- updates never require editing the agent's own config. One row per user.
CREATE TABLE agent_manual (
  user_id      TEXT PRIMARY KEY,
  categorization TEXT NOT NULL DEFAULT '',
  budgeting    TEXT NOT NULL DEFAULT '',
  general      TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);
