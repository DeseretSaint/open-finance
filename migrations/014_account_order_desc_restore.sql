-- 014: account reorder + descriptions + restore (soft delete)
-- sort_order: user-controlled display order (default 0 = stable, then name)
-- description: free-text note shown on the account card
-- deleted_at: soft delete so removed accounts can be restored (v0.3.11)
ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN description TEXT;
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_accounts_sort ON accounts(user_id, sort_order);
