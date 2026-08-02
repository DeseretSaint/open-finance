import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Onboarding state (P8c): whether the user has completed the first-run
 * walkthrough. Stored per-user on user_settings (works identically on the
 * hub's better-sqlite3 and the phone's CapSqliteDb).
 */
export interface OnboardingStatus {
  completed: boolean;
  completedAt: string | null;
}

export function createOnboardingService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<OnboardingStatus> {
      const row = await db.get<{
        onboarding_completed: number;
        updated_at: string | null;
      }>(
        "SELECT onboarding_completed, updated_at FROM user_settings WHERE user_id = ?",
        userId
      );
      if (!row) return { completed: false, completedAt: null };
      const completed = row.onboarding_completed === 1;
      return {
        completed,
        completedAt: completed ? row.updated_at : null,
      };
    },

    /** Mark the walkthrough complete (idempotent). */
    async complete(userId: string): Promise<OnboardingStatus> {
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO user_settings (user_id, onboarding_completed, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET onboarding_completed = 1, updated_at = excluded.updated_at`,
        userId,
        now
      );
      return { completed: true, completedAt: now };
    },

    /** Restart the walkthrough (Settings → "Restart setup tour"). */
    async reset(userId: string): Promise<OnboardingStatus> {
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO user_settings (user_id, onboarding_completed, updated_at)
         VALUES (?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET onboarding_completed = 0, updated_at = excluded.updated_at`,
        userId,
        now
      );
      return { completed: false, completedAt: null };
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
