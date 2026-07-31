import { apiErrors } from "@/lib/api";
import { getDb, type Db } from "@/server/db/adapter";
import {
  derivePinHashHex,
  randomSaltHex,
  timingSafeEqualHex,
} from "@/lib/pin-crypto";

/**
 * Device lock (mobile, P8a §10.4) — PIN at rest via PBKDF2-SHA256 100k +
 * 16B salt (per plan §10), timing-safe verify, lockout 5× → 30s doubling to
 * 8 minutes. Unlock succeeds only when not locked out. Biometric is a system
 * prompt on the device — we only store the enabled flag.
 */

const PIN_RE = /^\d{4,12}$/;
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 8 * 60_000;

export interface DeviceLockRow {
  user_id: string;
  pin_hash: string | null;
  pin_salt: string | null;
  biometric_enabled: number;
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
}

export function derivePinHash(pin: string, salt: string): Promise<string> {
  return derivePinHashHex(pin, salt);
}

function lockMsFor(failed: number): number {
  // failed=5 → 30s, 6 → 60s, … capped at 8m.
  const ms = BASE_LOCK_MS * 2 ** Math.max(0, failed - MAX_ATTEMPTS);
  return Math.min(ms, MAX_LOCK_MS);
}

export function createDeviceLockService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<DeviceLockRow | null> {
      return (await db.get<DeviceLockRow>("SELECT * FROM device_lock WHERE user_id = ?", userId)) ?? null;
    },

    /** Set or change the PIN. Returns nothing; caller decides session handling. */
    async setPin(userId: string, pin: string): Promise<void> {
      if (!PIN_RE.test(pin)) throw apiErrors.badRequest("PIN must be 4–12 digits.");
      const salt = randomSaltHex();
      const hash = await derivePinHash(pin, salt);
      const existing = await this.get(userId);
      if (existing) {
        await db.run(
          `UPDATE device_lock SET pin_hash = ?, pin_salt = ?, failed_attempts = 0, locked_until = NULL, updated_at = ?
           WHERE user_id = ?`,
          hash,
          salt,
          new Date().toISOString(),
          userId
        );
      } else {
        await db.run(
          `INSERT INTO device_lock (user_id, pin_hash, pin_salt, biometric_enabled, failed_attempts, locked_until, updated_at)
           VALUES (?, ?, ?, 0, 0, NULL, ?)`,
          userId,
          hash,
          salt,
          new Date().toISOString()
        );
      }
    },

    /** True when the user has a PIN configured. */
    async hasPin(userId: string): Promise<boolean> {
      const row = await this.get(userId);
      return !!row?.pin_hash;
    },

    /** Attempt to unlock. Throws 423 (locked) when locked out, 401 on wrong PIN. */
    async unlock(userId: string, pin: string): Promise<{ ok: true; locked: false }> {
      const row = await this.get(userId);
      if (!row?.pin_hash) throw apiErrors.badRequest("No PIN configured.");

      const now = Date.now();
      if (row.locked_until) {
        const lockedUntil = new Date(row.locked_until).getTime();
        if (now < lockedUntil) {
          const ms = lockedUntil - now;
          throw apiErrors.locked(`Too many attempts. Try again in ${Math.ceil(ms / 1000)}s.`);
        }
        // lock expired → reset attempts
        await db.run(
          "UPDATE device_lock SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?",
          userId
        );
        row.failed_attempts = 0;
        row.locked_until = null;
      }

      const expected = row.pin_hash;
      const actual = await derivePinHash(pin, row.pin_salt!);
      const ok = timingSafeEqualHex(expected, actual);

      if (!ok) {
        const failed = row.failed_attempts + 1;
        const lockedUntil = failed >= MAX_ATTEMPTS ? new Date(now + lockMsFor(failed)).toISOString() : null;
        await db.run(
          "UPDATE device_lock SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE user_id = ?",
          failed,
          lockedUntil,
          new Date().toISOString(),
          userId
        );
        if (lockedUntil) {
          throw apiErrors.locked(`Too many attempts. Try again in ${Math.ceil(lockMsFor(failed) / 1000)}s.`);
        }
        throw apiErrors.wrongPin();
      }

      // success → reset counters
      await db.run(
        "UPDATE device_lock SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?",
        new Date().toISOString(),
        userId
      );
      return { ok: true, locked: false };
    },

    /** Enable/disable biometric unlock (system prompt handles the actual scan). */
    async setBiometric(userId: string, enabled: boolean): Promise<void> {
      await db.run(
        `INSERT INTO device_lock (user_id, pin_hash, pin_salt, biometric_enabled, failed_attempts, locked_until, updated_at)
         VALUES (?, NULL, NULL, ?, 0, NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET biometric_enabled = ?, updated_at = ?`,
        userId,
        enabled ? 1 : 0,
        new Date().toISOString(),
        enabled ? 1 : 0,
        new Date().toISOString()
      );
    },

    /** Public lock state for the UI (never the hash). */
    async state(userId: string): Promise<{
      configured: boolean;
      biometricEnabled: boolean;
      locked: boolean;
      retryAfterMs: number | null;
    }> {
      const row = await this.get(userId);
      if (!row) return { configured: false, biometricEnabled: false, locked: false, retryAfterMs: null };
      const now = Date.now();
      const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : null;
      const locked = lockedUntil !== null && now < lockedUntil;
      return {
        configured: !!row.pin_hash,
        biometricEnabled: row.biometric_enabled === 1,
        locked,
        retryAfterMs: locked && lockedUntil ? lockedUntil - now : null,
      };
    },
  };
}
