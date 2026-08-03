-- 010: per-account net-worth inclusion (P24). Accounts linked as investments
-- (e.g. Robinhood) can be excluded from the day-to-day net worth shown on the
-- Home overview, while still appearing in the Accounts tab. Default: included.
ALTER TABLE accounts ADD COLUMN include_in_net_worth INTEGER NOT NULL DEFAULT 1;
