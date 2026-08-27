-- 021: partial index to speed the per-account pending-balance subquery.
-- summary/reports/projection/accounts each run a correlated subquery
--   SELECT SUM(amount_cents) FROM transactions
--   WHERE account_id = ? AND pending = 1 AND exclude_from_budgets = 0 AND is_transfer = 0
-- which scans every transaction of an account to isolate the (sparse) pending
-- rows. A partial index keyed on account_id for pending = 1 rows lets the
-- planner seek straight to the handful of pending rows instead of scanning the
-- whole per-account set. Tiny index (only pending rows), zero behavior change.
CREATE INDEX idx_txn_account_pending ON transactions(account_id) WHERE pending = 1;
