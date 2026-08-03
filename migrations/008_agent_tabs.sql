-- 008: granular per-tab agent read access (P21). agent_tabs holds a JSON
-- array of tab keys the agent may READ (e.g. ["activity","budgets"]).
-- Valid keys: dashboard, accounts, activity, budgets, reports, planning,
-- investments. Combined with 006/007:
--   agent_auto_categorize — activity WRITE (smart categorization)
--   agent_global — master toggle: read access to ALL tabs (overrides agent_tabs)
--   agent_global_write — sub-toggle: write access across the whole app
-- Default: agent may watch activity (transactions) only.
ALTER TABLE user_settings ADD COLUMN agent_tabs TEXT NOT NULL DEFAULT '["activity"]';
