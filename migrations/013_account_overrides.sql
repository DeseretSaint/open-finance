-- 013: per-account user override / soft-delete for Plaid accounts
-- hidden accounts are not recreated by subsequent syncs
ALTER TABLE accounts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN type_override INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_accounts_visible ON accounts(user_id, hidden);
CREATE INDEX IF NOT EXISTS idx_accounts_plaid_visible ON accounts(user_id, plaid_account_id, hidden);

-- Existing Plaid types are provider classifications, not user overrides.
-- Only a later Accounts-page edit sets type_override = 1.
