-- 006: agent smart-categorization preference. When ON, the connected agent
-- may auto-categorize uncategorized or generically-named expenses it is
-- confident about, and may leave ambiguous ("gray area") ones alone. When OFF
-- (default), the agent only suggests and the user categorizes manually.
ALTER TABLE user_settings ADD COLUMN agent_auto_categorize INTEGER NOT NULL DEFAULT 0;
