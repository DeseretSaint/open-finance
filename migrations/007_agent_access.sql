-- 007: agent access tiers (P20). Together with agent_auto_categorize (006):
--   agent_auto_categorize — activity WRITE toggle (smart categorization).
--     OFF (default): agent may only READ activity (transactions) as they come in.
--     ON: agent may also WRITE categories on activity — but still sees NO
--     overall financial status (summary, net worth, budgets, reports).
--   agent_global — full-app READ access (summary, budgets, planning, reports,
--     investments). OFF (default): agent is activity-only.
--   agent_global_write — sub-toggle: when ON (and global), agent also gets
--     every WRITE scope (budgets, categories, planning, settings, sync).
-- Effective scopes at request time = token scopes ∩ these user-level caps.
ALTER TABLE user_settings ADD COLUMN agent_global INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN agent_global_write INTEGER NOT NULL DEFAULT 0;
