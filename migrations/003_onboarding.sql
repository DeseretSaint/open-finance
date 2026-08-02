-- 003: first-run onboarding flag (per-user, on user_settings)
ALTER TABLE user_settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
