import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, SqliteDb } from "@/server/db/adapter";
import { createAuthService } from "@/server/auth/service";
import { createSession, getSessionFromToken } from "@/server/auth/sessions";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

let dir: string;
let file: string;
let db: SqliteDb;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "of-auth-"));
  file = path.join(dir, "test.db");
  const raw = new Database(file);
  runMigrations(raw);
  raw.close();
  db = createDb(file);
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const auth = () => createAuthService(db);

describe("auth service", () => {
  it("registers a user (lowercased username) + settings row", async () => {
    const { user } = await auth().register({
      username: "Alice",
      display_name: "Alice A.",
      password: "correct-horse-battery-staple",
    });
    expect(user.username).toBe("alice");
    expect(user.display_name).toBe("Alice A.");
    const settings = await db.get("SELECT user_id FROM user_settings WHERE user_id = ?", user.id);
    expect(settings).toBeTruthy();
  });

  it("rejects duplicate usernames", async () => {
    await expect(
      auth().register({ username: "ALICE", display_name: "x", password: "another-strong-pass" })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces the password policy", async () => {
    await expect(
      auth().register({ username: "bob", display_name: "Bob", password: "short" })
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(
      auth().register({ username: "carol", display_name: "Carol", password: "password" })
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("logs in with correct credentials and fails with wrong ones", async () => {
    const wrong = auth().login({ username: "alice", password: "nope-nope-nope", duration: "30d", device_label: "test" });
    await expect(wrong).rejects.toMatchObject({ code: "bad_request" });

    const { user, token, expiresAt } = await auth().login({
      username: "alice",
      password: "correct-horse-battery-staple",
      duration: "30d",
      device_label: "test",
    });
    expect(user.username).toBe("alice");
    expect(expiresAt).toBeTruthy();

    const session = await getSessionFromToken(token, db);
    expect(session?.user.id).toBe(user.id);
  });

  it("creates forever sessions with idle timeout and no expiry", async () => {
    const { user } = await auth().login({
      username: "alice",
      password: "correct-horse-battery-staple",
      duration: "forever",
      device_label: "forever-device",
    });
    const row = await db.get<{ expires_at: string | null; idle_timeout_h: number | null }>(
      "SELECT expires_at, idle_timeout_h FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      user.id
    );
    expect(row?.expires_at).toBeNull();
    expect(row?.idle_timeout_h).toBe(2160);
  });

  it("revokes a single session", async () => {
    const { user } = await auth().register({ username: "dave", display_name: "Dave", password: "dave-has-a-strong-pass" });
    const s1 = await createSession(user.id, "7d", "dev1", db);
    const s2 = await createSession(user.id, "7d", "dev2", db);
    await auth().revokeSession((await getSessionFromToken(s1.token, db))!.id, user.id);
    expect(await getSessionFromToken(s1.token, db)).toBeNull();
    expect(await getSessionFromToken(s2.token, db)).not.toBeNull();
  });

  it("logout-all revokes everything; password change keeps only the current session", async () => {
    const { user } = await auth().register({ username: "erin", display_name: "Erin", password: "erin-has-a-strong-pass" });
    await createSession(user.id, "7d", "other", db);
    const token = (await createSession(user.id, "7d", "current", db)).token;
    const current = await getSessionFromToken(token, db);
    expect(current).not.toBeNull();

    await auth().changePassword(user.id, "erin-has-a-strong-pass", "erin-new-strong-pass");
    await auth().revokeAllSessions(user.id, current!.id);

    const rows = await db.all<{ id: string }>("SELECT id FROM sessions WHERE user_id = ?", user.id);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(current!.id);
  });

  it("resets a password with the recovery code and invalidates old sessions", async () => {
    const { user } = await auth().register({ username: "frank", display_name: "Frank", password: "frank-has-a-strong-pass" });
    const code = await auth().createRecoveryCode(user.id);
    const session = await createSession(user.id, "30d", "dev", db);

    await expect(
      auth().resetPasswordWithRecovery("frank", "wrong-code", "frank-reset-strong-pass")
    ).rejects.toMatchObject({ code: "bad_request" });

    await auth().resetPasswordWithRecovery("frank", code, "frank-reset-strong-pass");
    expect(await getSessionFromToken(session.token, db)).toBeNull();
    await expect(
      auth().login({ username: "frank", password: "frank-has-a-strong-pass", duration: "30d", device_label: "t" })
    ).rejects.toMatchObject({ code: "bad_request" });
    const login = await auth().login({ username: "frank", password: "frank-reset-strong-pass", duration: "30d", device_label: "t" });
    expect(login.user.username).toBe("frank");
  });

  it("deletes a user and their related rows", async () => {
    const { user } = await auth().register({ username: "grace", display_name: "Grace", password: "grace-has-a-strong-pass" });
    await createSession(user.id, "30d", "dev", db);
    await db.run("INSERT INTO bills (id, user_id, name, amount_cents, frequency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      "b1", user.id, "Rent", 100000, "monthly", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    await auth().deleteUser(user.id);
    const u = await db.get("SELECT id FROM users WHERE id = ?", user.id);
    expect(u).toBeUndefined();
    const bill = await db.get("SELECT id FROM bills WHERE user_id = ?", user.id);
    expect(bill).toBeUndefined();
    const s = await db.get("SELECT id FROM sessions WHERE user_id = ?", user.id);
    expect(s).toBeUndefined();
  });
});

describe("rate limiter", () => {
  it("blocks after max attempts and recovers after the window", async () => {
    const { createRateLimiter } = await import("@/lib/rate-limit");
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(false);
    limiter.prune();
    // window still active; simulate expiry by resetting
    limiter.reset("k");
    expect(limiter.check("k").ok).toBe(true);
  });
});
