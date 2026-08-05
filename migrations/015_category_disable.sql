-- 015: allow default and custom categories to be disabled without deleting history
ALTER TABLE categories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_categories_user_enabled ON categories(user_id, enabled, name);

-- Disabled categories remain referenced by historical transactions. They are
-- omitted from active pickers, budgets, and automatic Plaid matching only.
