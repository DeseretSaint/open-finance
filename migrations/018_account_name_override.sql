-- 018: preserve user-defined account names across Plaid refreshes
ALTER TABLE accounts ADD COLUMN name_override TEXT;

-- A non-null override wins over Plaid's institution-provided name.
CREATE INDEX IF NOT EXISTS idx_accounts_name_override ON accounts(user_id, name_override);
