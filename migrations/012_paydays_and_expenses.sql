-- 012: manual payday schedule + one-off expenses with contribution plans
--
-- payday_mode: 'auto' (default — detect from income transactions) |
--              'interval' (every payday_interval) | 'days_of_month' (payday_days)
-- payday_interval: 'weekly' | 'biweekly' | 'monthly'
-- payday_days: JSON array of day-of-month ints, e.g. [1, 15]
ALTER TABLE user_settings ADD COLUMN payday_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE user_settings ADD COLUMN payday_interval TEXT;
ALTER TABLE user_settings ADD COLUMN payday_days TEXT;

-- goals.type: 'savings' (default) | 'expense' (one-off upcoming expense).
-- contribution_mode: 'none' (no set-aside) | 'interval' (regular intervals) |
--                    'days_of_month' (specific days) | 'agent' (agent schedules)
-- contribution_interval: 'weekly' | 'biweekly' | 'monthly'
-- contribution_days: JSON array of day-of-month ints, e.g. [5, 20]
ALTER TABLE goals ADD COLUMN contribution_mode TEXT NOT NULL DEFAULT 'interval';
ALTER TABLE goals ADD COLUMN contribution_interval TEXT;
ALTER TABLE goals ADD COLUMN contribution_days TEXT;
