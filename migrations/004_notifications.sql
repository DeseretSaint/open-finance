-- 004: notification + biometric preferences (per-user)
ALTER TABLE user_settings ADD COLUMN notif_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN notif_frequency TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE user_settings ADD COLUMN notif_time TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE user_settings ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN email_address TEXT;
ALTER TABLE user_settings ADD COLUMN email_frequency TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE user_settings ADD COLUMN biometric_enabled INTEGER NOT NULL DEFAULT 0;
