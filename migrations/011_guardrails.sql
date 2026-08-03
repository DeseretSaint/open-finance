-- 011: AI guardrails (D4). User-facing safety rails for the agent, each
-- changeable in Settings → AI agent → Advanced and audited on change.
--   agent_auto_approve_reads — when ON, permission requests for READ scopes
--     that fall inside the user's existing caps are auto-approved instead of
--     sitting in the inbox. OFF (default): every out-of-scope attempt asks.
--   agent_require_write_confirm — when ON (default), destructive agent writes
--     (delete budget / category / planning item) require an explicit Grant in
--     the permission inbox before they run. OFF: a token holding the write
--     scope may delete directly (still fully audited).
--   agent_audit_enabled — when ON (default), every agent call lands in the
--     audit log. Recommended always-on; exposed with a warning.
ALTER TABLE user_settings ADD COLUMN agent_auto_approve_reads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN agent_require_write_confirm INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN agent_audit_enabled INTEGER NOT NULL DEFAULT 1;
