import { apiErrors } from "@/lib/api-error";
import { getDb, type Db } from "@/server/db/registry";
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

    /**
     * Set or change the PIN. Returns nothing; caller decides session handling.
     * Rejected with 423 while the device is locked out: the PIN-change route
     * sits inside the device-lock exemption prefix (the lock screen's own
     * surface), so without this check an attacker with in-app access could
     * REPLACE the PIN mid-lockout and unlock with their own PIN once the
     * cooldown expires. Pass force=true only from a verified recovery flow
     * (resetPin) — recovery is the sanctioned way to regain access.
     */
    async setPin(userId: string, pin: string, force = false): Promise<void> {
      if (!PIN_RE.test(pin)) throw apiErrors.badRequest("PIN must be 4–12 digits.");
      const existing = await this.get(userId);
      if (!force && existing) {
        const now = Date.now();
        const lockedUntil = existing.locked_until ? new Date(existing.locked_until).getTime() : null;
        if (lockedUntil !== null && now < lockedUntil) {
          throw apiErrors.locked("Device is locked. Unlock it (or use your recovery code) before changing the PIN.");
        }
      }
      const salt = randomSaltHex();
      const hash = await derivePinHash(pin, salt);
      if (existing) {
        // NOTE: setPin deliberately does NOT touch failed_attempts/locked_until.
        // A locked device's lockout must survive a PIN change — only unlock(),
        // unlockWithBiometric(), and recovery (resetPin) are allowed to clear it.
        // (Run 48 closed the counter-clearing hole; the locked-out rejection
        // above closes the replace-PIN-then-unlock-after-expiry hole.)
        await db.run(
          `UPDATE device_lock SET pin_hash = ?, pin_salt = ?, updated_at = ?
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

    /**
     * Enable/disable biometric unlock (system prompt handles the actual scan).
     * Rejected with 423 while the device is locked out: the biometric
     * enable/disable routes sit inside the device-lock exemption prefix (the
     * lock screen's own surface), and unlockWithBiometric() requires only
     * biometric_enabled === 1 to clear the lockout — so without this check an
     * attacker with in-app access could enable biometrics mid-lockout and then
     * call the (legitimately exempt) biometric-unlock endpoint to bypass the
     * PIN and the lockout entirely. No force param: recovery resets the PIN
     * only, never biometrics.
     */
    async setBiometric(userId: string, enabled: boolean): Promise<void> {
      const existing = await this.get(userId);
      if (existing) {
        const now = Date.now();
        const lockedUntil = existing.locked_until ? new Date(existing.locked_until).getTime() : null;
        if (lockedUntil !== null && now < lockedUntil) {
          throw apiErrors.locked("Device is locked. Unlock it (or use your recovery code) before changing biometric unlock.");
        }
      }
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

    /**
     * Unlock via biometrics. The native BiometricPrompt has ALREADY verified
     * the user's fingerprint/face by the time this is called — this just
     * checks the pref is on, clears any lockout, and resets counters.
     */
    async unlockWithBiometric(userId: string): Promise<{ ok: true; locked: false }> {
      const row = await this.get(userId);
      if (!row) throw apiErrors.badRequest("No device lock configured.");
      if (row.biometric_enabled !== 1) {
        throw apiErrors.badRequest("Biometric unlock is not enabled.");
      }
      await db.run(
        "UPDATE device_lock SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?",
        new Date().toISOString(),
        userId
      );
      return { ok: true, locked: false };
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
