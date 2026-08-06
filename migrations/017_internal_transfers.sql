-- 017: mark linked-account internal transfers so they are not income or expense
ALTER TABLE transactions ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_txn_transfer ON transactions(account_id, date, is_transfer);

-- A transfer is retained in Activity but excluded from income, expense,
-- spending, budgets, projections, and report totals.
