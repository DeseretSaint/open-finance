import { randomBytes, randomUUID } from "node:crypto";
import { hashSecret } from "@/lib/crypto";
import { apiErrors } from "@/lib/api";
import { createRateLimiter } from "@/lib/rate-limit";
import { getDb, type Db } from "@/server/db/adapter";
import { createSession, getSessionFromRequest, type Duration, type SessionInfo } from "./sessions";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password";

export interface PublicUser {
  id: string;
  username: string | null;
  display_name: string;
  email: string | null;
  is_demo: boolean;
  created_at: string;
}

function toPublicUser(row: {
  id: string;
  username: string | null;
  display_name: string;
  email: string | null;
  is_demo: number;
  created_at: string;
}): PublicUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    email: row.email,
    is_demo: row.is_demo === 1,
    created_at: row.created_at,
  };
}

function now(): string {
  return new Date().toISOString();
}

export const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });
export const registerLimiter = createRateLimiter({ windowMs: 3600_000, max: 5 });
export const sensitiveLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

export function createAuthService(db: Db = getDb()) {
  return {
    async register(input: { username: string; display_name: string; password: string }) {
      const username = input.username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        throw apiErrors.badRequest(
          "Username must be 3–32 characters using letters, numbers, dot, dash, or underscore."
        );
      }
      const display_name = input.display_name.trim().slice(0, 50) || username;
      const policy = validatePasswordPolicy(input.password, username);
      if (policy) throw apiErrors.badRequest(policy);
      const existing = await db.get("SELECT id FROM users WHERE username = ?", username);
      if (existing) throw apiErrors.conflict("That username is already taken.");
      const id = randomUUID();
      await db.run(
        `INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        username,
        display_name,
        await hashPassword(input.password),
        now(),
        now()
      );
      await db.run(
        "INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)",
        id,
        now()
      );
      return { user: await this.getUserById(id) };
    },

    async login(input: { username: string; password: string; duration: Duration; device_label: string }) {
      const username = input.username.trim().toLowerCase();
      const row = await db.get<{
        id: string; username: string | null; display_name: string; email: string | null;
        is_demo: number; created_at: string; password_hash: string | null;
      }>("SELECT * FROM users WHERE lower(username) = lower(?)", username);
      if (!row || !row.password_hash || !(await verifyPassword(input.password, row.password_hash))) {
        throw apiErrors.badRequest("Incorrect username or password.");
      }
      const session = await createSession(row.id, input.duration, input.device_label.slice(0, 100), db);
      return { user: toPublicUser(row), token: session.token, expiresAt: session.expiresAt };
    },

    async getUserById(id: string) {
      const row = await db.get<{
        id: string; username: string | null; display_name: string; email: string | null;
        is_demo: number; created_at: string;
      }>("SELECT id, username, display_name, email, is_demo, created_at FROM users WHERE id = ?", id);
      if (!row) throw apiErrors.notFound("User");
      return toPublicUser(row);
    },

    async revokeSession(sessionId: string, userId: string) {
      await db.run("DELETE FROM sessions WHERE id = ? AND user_id = ?", sessionId, userId);
    },

    async revokeAllSessions(userId: string, keepSessionId?: string) {
      if (keepSessionId) {
        await db.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", userId, keepSessionId);
      } else {
        await db.run("DELETE FROM sessions WHERE user_id = ?", userId);
      }
    },

    async listSessions(userId: string) {
      const rows = await db.all<{
        id: string; device_label: string; created_at: string; expires_at: string | null; last_seen_at: string;
      }>("SELECT id, device_label, created_at, expires_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC", userId);
      return rows;
    },

    async updateDisplayName(userId: string, display_name: string) {
      const name = display_name.trim().slice(0, 50);
      if (!name) throw apiErrors.badRequest("Display name cannot be empty.");
      await db.run("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?", name, now(), userId);
      return this.getUserById(userId);
    },

    async changePassword(userId: string, current: string, next: string) {
      const row = await db.get<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", userId);
      if (!row?.password_hash || !(await verifyPassword(current, row.password_hash))) {
        throw apiErrors.badRequest("Current password is incorrect.");
      }
      const policy = validatePasswordPolicy(next);
      if (policy) throw apiErrors.badRequest(policy);
      await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(next), now(), userId);
      // Revoke all sessions except the current one (handled by the route).
      return { revokeOthers: true };
    },

    async changeUsername(userId: string, password: string, newUsername: string) {
      const row = await db.get<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", userId);
      if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
        throw apiErrors.badRequest("Password is incorrect.");
      }
      const username = newUsername.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        throw apiErrors.badRequest("Username must be 3–32 characters using letters, numbers, dot, dash, or underscore.");
      }
      const taken = await db.get("SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?", username, userId);
      if (taken) throw apiErrors.conflict("That username is already taken.");
      await db.run("UPDATE users SET username = ?, updated_at = ? WHERE id = ?", username, now(), userId);
      return { username };
    },

    async changeEmail(userId: string, password: string, email: string | null) {
      const row = await db.get<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", userId);
      if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
        throw apiErrors.badRequest("Password is incorrect.");
      }
      const value = email?.trim().toLowerCase() || null;
      if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw apiErrors.badRequest("That email address is not valid.");
      }
      if (value) {
        const taken = await db.get("SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?", value, userId);
        if (taken) throw apiErrors.conflict("That email is already in use.");
      }
      await db.run("UPDATE users SET email = ?, updated_at = ? WHERE id = ?", value, now(), userId);
      return { email: value };
    },

    async resetPasswordWithRecovery(username: string, recoveryCode: string, newPassword: string) {
      const policy = validatePasswordPolicy(newPassword);
      if (policy) throw apiErrors.badRequest(policy);
      const row = await db.get<{ id: string; recovery_code_hash: string | null }>(
        "SELECT id, recovery_code_hash FROM users WHERE lower(username) = lower(?)",
        username
      );
      if (!row?.recovery_code_hash || row.recovery_code_hash !== hashSecret(recoveryCode)) {
        throw apiErrors.badRequest("Recovery code is incorrect.");
      }
      await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(newPassword), now(), row.id);
      await db.run("DELETE FROM sessions WHERE user_id = ?", row.id);
      return { ok: true };
    },

    async deleteUser(userId: string) {
      await db.transaction(async () => {
        // Tables keyed by token/budget/account subqueries first (parents still exist).
        await db.run(
          "DELETE FROM agent_permission_requests WHERE token_id IN (SELECT id FROM agent_tokens WHERE user_id = ?)",
          userId
        );
        await db.run(
          "DELETE FROM agent_access_log WHERE token_id IN (SELECT id FROM agent_tokens WHERE user_id = ?)",
          userId
        );
        await db.run(
          "DELETE FROM budget_categories WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ?)",
          userId
        );
        await db.run(
          "DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)",
          userId
        );
        await db.run(
          "DELETE FROM balance_history WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)",
          userId
        );
        // Tables with a direct user_id column.
        for (const table of [
          "plaid_credentials", "plaid_items", "accounts", "categories", "budgets", "bills",
          "debts", "goals", "agent_tokens", "custom_views", "sessions", "device_lock",
          "user_settings",
        ]) {
          await db.run(`DELETE FROM ${table} WHERE user_id = ?`, userId);
        }
        await db.run("DELETE FROM users WHERE id = ?", userId);
      });
    },

    async createRecoveryCode(userId: string): Promise<string> {
      const code = randomBytes(16).toString("hex");
      await db.run("UPDATE users SET recovery_code_hash = ?, updated_at = ? WHERE id = ?", hashSecret(code), now(), userId);
      return code;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export async function requireSession(req: Request): Promise<SessionInfo> {
  const session = await getSessionFromRequest(req);
  if (!session) throw apiErrors.unauthorized();
  return session;
}

/** CSRF guard for mutating cookie-authenticated routes. */
export function requireCsrf(req: Request): void {
  if (req.headers.get("x-of-request") !== "1") {
    throw apiErrors.forbidden("Missing CSRF header.");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function deviceLabel(req: Request): string {
  return (
    req.headers.get("x-of-device") ||
    req.headers.get("user-agent") ||
    "Unknown device"
  );
}
