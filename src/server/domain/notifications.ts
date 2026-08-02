import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Notification + biometric preferences (P11). One service used by BOTH the
 * server routes and the solo router — no node:* imports, so it's safe in the
 * webview bundle.
 *
 * Preferences live on user_settings (migration 004):
 *   notif_enabled     — on-device push (local notifications) on/off
 *   notif_frequency   — daily | weekly
 *   notif_time        — HH:MM (24h, local device time)
 *   email_enabled     — email digest on/off (hub sends via SMTP)
 *   email_address     — destination address
 *   email_frequency   — daily | weekly
 *   biometric_enabled — allow fingerprint/face unlock instead of PIN
 */

export type Frequency = "daily" | "weekly";

export interface NotificationPrefs {
  notifEnabled: boolean;
  notifFrequency: Frequency;
  notifTime: string;
  emailEnabled: boolean;
  emailAddress: string | null;
  emailFrequency: Frequency;
  biometricEnabled: boolean;
}

const DEFAULTS: NotificationPrefs = {
  notifEnabled: false,
  notifFrequency: "weekly",
  notifTime: "09:00",
  emailEnabled: false,
  emailAddress: null,
  emailFrequency: "weekly",
  biometricEnabled: false,
};

function normFrequency(v: unknown): Frequency {
  return v === "daily" ? "daily" : "weekly";
}

export function createNotificationsService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<NotificationPrefs> {
      const row = await db.get<{
        notif_enabled: number;
        notif_frequency: string;
        notif_time: string;
        email_enabled: number;
        email_address: string | null;
        email_frequency: string;
        biometric_enabled: number;
      }>(
        `SELECT notif_enabled, notif_frequency, notif_time,
                email_enabled, email_address, email_frequency, biometric_enabled
         FROM user_settings WHERE user_id = ?`,
        userId
      );
      if (!row) return { ...DEFAULTS };
      return {
        notifEnabled: row.notif_enabled === 1,
        notifFrequency: normFrequency(row.notif_frequency),
        notifTime: /^\d{2}:\d{2}$/.test(row.notif_time) ? row.notif_time : DEFAULTS.notifTime,
        emailEnabled: row.email_enabled === 1,
        emailAddress: row.email_address ?? null,
        emailFrequency: normFrequency(row.email_frequency),
        biometricEnabled: row.biometric_enabled === 1,
      };
    },

    /** Partial update; omitted fields are left unchanged. */
    async update(
      userId: string,
      patch: Partial<Omit<NotificationPrefs, never>>
    ): Promise<NotificationPrefs> {
      const current = await this.get(userId);
      const next: NotificationPrefs = {
        notifEnabled: patch.notifEnabled ?? current.notifEnabled,
        notifFrequency: patch.notifFrequency ? normFrequency(patch.notifFrequency) : current.notifFrequency,
        notifTime: patch.notifTime ?? current.notifTime,
        emailEnabled: patch.emailEnabled ?? current.emailEnabled,
        emailAddress: patch.emailAddress !== undefined ? (patch.emailAddress || null) : current.emailAddress,
        emailFrequency: patch.emailFrequency ? normFrequency(patch.emailFrequency) : current.emailFrequency,
        biometricEnabled: patch.biometricEnabled ?? current.biometricEnabled,
      };
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO user_settings (
           user_id, notif_enabled, notif_frequency, notif_time,
           email_enabled, email_address, email_frequency, biometric_enabled, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           notif_enabled = excluded.notif_enabled,
           notif_frequency = excluded.notif_frequency,
           notif_time = excluded.notif_time,
           email_enabled = excluded.email_enabled,
           email_address = excluded.email_address,
           email_frequency = excluded.email_frequency,
           biometric_enabled = excluded.biometric_enabled,
           updated_at = excluded.updated_at`,
        userId,
        next.notifEnabled ? 1 : 0,
        next.notifFrequency,
        next.notifTime,
        next.emailEnabled ? 1 : 0,
        next.emailAddress,
        next.emailFrequency,
        next.biometricEnabled ? 1 : 0,
        now
      );
      return next;
    },
  };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;
