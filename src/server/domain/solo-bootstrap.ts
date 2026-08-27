import { apiErrors } from "@/lib/api-error";
import { timingSafeEqualHex } from "@/lib/pin-crypto";
import { getDb, type Db } from "@/server/db/registry";
import { createDeviceLockService } from "@/server/domain/device-lock";

/**
 * Solo bootstrap (P8b): creates the on-device identity the webview uses when it
 * runs without a hub — a device user row (the SAME `users` table the server
 * uses, so every domain service works unchanged), a recovery code shown once,
 * and an optional PIN via the existing device_lock service.
 *
 * The device user is distinguished by `is_demo = 0` + a username reserved for
 * the device (`device-<uuid>`); it never logs in over HTTP, so no password is
 * set — recovery + PIN replace the password in solo flows.
 */

const DEVICE_USERNAME_RE = /^device-[a-f0-9-]{36}$/;

export interface SoloDeviceRow {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

/** Remove all finance data from a throwaway demo before upgrading the device. */
async function clearDemoData(db: Db, userId: string): Promise<void> {
  await db.transaction(async () => {
    await db.run("DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)", userId);
    await db.run("DELETE FROM balance_history WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)", userId);
    await db.run("DELETE FROM budget_categories WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ?)", userId);
    await db.run("DELETE FROM budgets WHERE user_id = ?", userId);
    await db.run("DELETE FROM bills WHERE user_id = ?", userId);
    await db.run("DELETE FROM debts WHERE user_id = ?", userId);
    await db.run("DELETE FROM goals WHERE user_id = ?", userId);
    await db.run("DELETE FROM agent_tokens WHERE user_id = ?", userId);
    await db.run("DELETE FROM custom_views WHERE user_id = ?", userId);
    await db.run("DELETE FROM categories WHERE user_id = ?", userId);
    await db.run("DELETE FROM accounts WHERE user_id = ?", userId);
  });
}

/** SHA-256 hex (not for passwords — recovery codes are high-entropy). */
async function hashSecret(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomRecoveryCode(): string {
  // 10 groups of 4 base32-ish chars, dashed: XXXX-XXXX-… = 40 × 5 = 200 bits
  // of entropy. MUST come from a CSPRNG: this code is the sole "I forgot my
  // PIN" path (resetPin). The legacy non-cryptographic PRNG was a weakness
  // here — crypto.getRandomValues is WebCrypto (browser + Node 22),
  // matching this file's existing crypto.subtle/randomUUID usage.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1
  const rand = new Uint32Array(40);
  crypto.getRandomValues(rand);
  const parts: string[] = [];
  for (let g = 0; g < 10; g++) {
    let chunk = "";
    for (let i = 0; i < 4; i++) {
      // 2^32 % 32 === 0 → zero modulo bias.
      chunk += alphabet[rand[g * 4 + i] % alphabet.length];
    }
    parts.push(chunk);
  }
  return parts.join("-");
}

export function createSoloBootstrapService(db: Db = getDb()) {
  const deviceLock = createDeviceLockService(db);

  return {
    /** True when a device user already exists (solo already bootstrapped). */
    async isBootstrapped(): Promise<boolean> {
      const row = await db.get<{ id: string }>(
        "SELECT id FROM users WHERE username LIKE 'device-%' LIMIT 1"
      );
      return !!row;
    },

    /** The device user row, or null if not bootstrapped. */
    async getDeviceUser(): Promise<SoloDeviceRow | null> {
      const row = await db.get<SoloDeviceRow>(
        "SELECT id, username, display_name, created_at FROM users WHERE username LIKE 'device-%' ORDER BY created_at LIMIT 1"
      );
      return row ?? null;
    },

    /**
     * Bootstrap the device identity. Returns the recovery code ONCE — the
     * caller must show it to the user; it is stored only as a hash.
     *
     * If the device was only used for the DEMO (is_demo=1), "creating an
     * account" upgrades that demo device into a real one: keeps the same
     * device row (all domain services reference the device user id), mints a
     * NEW recovery code, flips is_demo off, and resets onboarding so the
     * setup wizard (PIN, Plaid, agent) runs again. Demo sample data stays —
     * the user can delete it in the app. A REAL existing account is a
     * conflict (the landing page should route to unlock instead).
     */
    async bootstrap(input: { displayName?: string; pin?: string; isDemo?: boolean }): Promise<{
      user: SoloDeviceRow;
      recoveryCode: string;
      hasPin: boolean;
    }> {
      const existing = await this.getDeviceUser();
      if (existing) {
        const row = await db.get<{ is_demo: number }>(
          "SELECT is_demo FROM users WHERE id = ?",
          existing.id
        );
        if (!row || row.is_demo !== 1) {
          throw apiErrors.conflict("This device already has an account — unlock it instead.");
        }
        // Demo-only device → clear the throwaway dataset before upgrading.
        await clearDemoData(db, existing.id);
        const recoveryCode = randomRecoveryCode();
        const displayName = (input.displayName ?? "This phone").trim().slice(0, 50) || "This phone";
        await db.transaction(async () => {
          await db.run(
            "UPDATE users SET display_name = ?, recovery_code_hash = ?, is_demo = 0, updated_at = ? WHERE id = ?",
            displayName,
            await hashSecret(recoveryCode),
            now(),
            existing.id
          );
          // Reset onboarding so the wizard walks through PIN / Plaid / agent.
          await db.run(
            "UPDATE user_settings SET onboarding_completed = 0, updated_at = ? WHERE user_id = ?",
            now(),
            existing.id
          );
          if (input.pin) {
            await deviceLock.setPin(existing.id, input.pin);
          }
        });
        return {
          user: {
            id: existing.id,
            username: existing.username,
            display_name: displayName,
            created_at: existing.created_at,
          },
          recoveryCode,
          hasPin: !!input.pin,
        };
      }

      const id = crypto.randomUUID();
      const username = `device-${id}`;
      const displayName = (input.displayName ?? "This phone").trim().slice(0, 50) || "This phone";
      const recoveryCode = randomRecoveryCode();

      await db.transaction(async () => {
        await db.run(
          `INSERT INTO users (id, username, display_name, recovery_code_hash, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id,
          username,
          displayName,
          await hashSecret(recoveryCode),
          input.isDemo ? 1 : 0,
          now(),
          now()
        );
        await db.run("INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)", id, now());
        if (input.pin) {
          await deviceLock.setPin(id, input.pin);
        }
      });

      return {
        user: { id, username, display_name: displayName, created_at: now() },
        recoveryCode,
        hasPin: !!input.pin,
      };
    },

    /**
     * Verify a recovery code for the device user (used by the "I forgot my
     * PIN" flow — same semantics as the server's resetPasswordWithRecovery).
     */
    async verifyRecoveryCode(code: string): Promise<boolean> {
      const user = await this.getDeviceUser();
      if (!user) return false;
      const row = await db.get<{ recovery_code_hash: string | null }>(
        "SELECT recovery_code_hash FROM users WHERE id = ?",
        user.id
      );
      if (!row?.recovery_code_hash) return false;
      // Constant-time compare (parity with server-mode safeEqual + device-lock
      // timingSafeEqualHex) — a plain === leaks hash-prefix timing on the
      // sole "I forgot my PIN" reset path.
      return timingSafeEqualHex(row.recovery_code_hash, await hashSecret(code.trim().toUpperCase()));
    },

    /** Reset the device PIN after a verified recovery code. */
    async resetPin(code: string, newPin: string): Promise<void> {
      if (!(await this.verifyRecoveryCode(code))) {
        throw apiErrors.badRequest("Recovery code is incorrect.");
      }
      const user = await this.getDeviceUser();
      if (!user) throw apiErrors.notFound("Device user");
      // force=true: recovery is the sanctioned way to regain access and must
      // work even mid-lockout (that is what "I forgot my PIN" is for).
      await deviceLock.setPin(user.id, newPin, true);
    },

    /** True when the device user has a PIN configured. */
    async hasPin(): Promise<boolean> {
      const user = await this.getDeviceUser();
      if (!user) return false;
      return deviceLock.hasPin(user.id);
    },

    /** Unlock the device (throws 423/401 per device_lock semantics). */
    async unlock(pin: string): Promise<void> {
      const user = await this.getDeviceUser();
      if (!user) throw apiErrors.notFound("Device user");
      await deviceLock.unlock(user.id, pin);
    },

    isDeviceUsername: (username: string) => DEVICE_USERNAME_RE.test(username),
  };
}
