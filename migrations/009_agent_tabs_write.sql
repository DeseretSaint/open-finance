-- 009: per-tab agent WRITE access + categorization backlog (P22/P23).
-- agent_tabs_write holds a JSON array of tab keys the agent may WRITE to
-- (in addition to reading them). Valid keys (same as agent_tabs):
-- dashboard, accounts, activity, budgets, reports, planning, investments.
-- Tabs without write scopes are no-ops:
--   activity  → transactions:edit (categorize)
--   budgets   → budgets:write
--   planning  → planning:write
-- agent_global_write still overrides everything (all scopes).
--
-- agent_categorize_backlog_months: how far back (in months) the agent may
-- auto-categorize when smart categorization is on. Default 1 (recommended);
-- allowed 1, 3, 6, 12.
ALTER TABLE user_settings ADD COLUMN agent_tabs_write TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_settings ADD COLUMN agent_categorize_backlog_months INTEGER NOT NULL DEFAULT 1;
