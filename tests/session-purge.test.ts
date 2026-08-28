import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, SqliteDb } from "@/server/db/adapter";
import {
  _resetPurgeThrottleForTest,
  createSession,
  getSessionFromToken,
  maybePurgeExpiredSessions,
  purgeExpiredSessions,
} from "@/server/auth/sessions";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

let dir: string;
let file: string;
let db: SqliteDb;
let userId: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "of-purge-"));
  file = path.join(dir, "test.db");
  const raw = new Database(file);
  runMigrations(raw);
  raw.exec(
    `INSERT INTO users (id, username, display_name, created_at, updated_at)
     VALUES ('u-purge', 'purgeuser', 'Purge User', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );
  raw.close();
  db = createDb(file);
  userId = "u-purge";
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetPurgeThrottleForTest();
});

async function insertSession(opts: {
  id: string;
  expiresAt?: string | null;
  idleTimeoutH?: number | null;
  lastSeenAt?: string;
}): Promise<void> {
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, expires_at, idle_timeout_h, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.id,
    userId,
    `hash-${opts.id}`,
    "test-device",
    "2026-01-01T00:00:00.000Z",
    opts.expiresAt ?? null,
    opts.idleTimeoutH ?? null,
    opts.lastSeenAt ?? "2026-01-01T00:00:00.000Z"
  );
}

async function sessionIds(): Promise<string[]> {
  const rows = await db.all<{ id: string }>("SELECT id FROM sessions ORDER BY id");
  return rows.map((r) => r.id);
}

describe("purgeExpiredSessions", () => {
  it("deletes expired sessions and keeps valid ones", async () => {
    await insertSession({ id: "s-expired", expiresAt: "2026-01-02T00:00:00.000Z" });
    await insertSession({ id: "s-valid", expiresAt: "2999-01-01T00:00:00.000Z" });
    const removed = await purgeExpiredSessions(db, Date.parse("2026-06-01T00:00:00.000Z"));
    expect(removed).toBe(1);
    expect(await sessionIds()).toEqual(["s-valid"]);
  });

  it("deletes idle-timed-out sessions and keeps fresh ones", async () => {
    await db.run("DELETE FROM sessions");
    // idle_timeout_h = 2160 (90d), last seen 2026-01-01 → dead by 2026-06-01
    await insertSession({ id: "s-idle-dead", idleTimeoutH: 2160, lastSeenAt: "2026-01-01T00:00:00.000Z" });
    // idle_timeout_h = 2160, last seen recently → alive
    await insertSession({ id: "s-idle-alive", idleTimeoutH: 2160, lastSeenAt: "2026-05-30T00:00:00.000Z" });
    const removed = await purgeExpiredSessions(db, Date.parse("2026-06-01T00:00:00.000Z"));
    expect(removed).toBe(1);
    expect(await sessionIds()).toEqual(["s-idle-alive"]);
  });

  it("keeps forever sessions with no expiry and no idle timeout", async () => {
    await db.run("DELETE FROM sessions");
    await insertSession({ id: "s-forever", expiresAt: null, idleTimeoutH: null });
    const removed = await purgeExpiredSessions(db, Date.parse("2030-01-01T00:00:00.000Z"));
    expect(removed).toBe(0);
    expect(await sessionIds()).toEqual(["s-forever"]);
  });

  it("purged sessions no longer authenticate", async () => {
    await db.run("DELETE FROM sessions");
    const { token } = await createSession(userId, "1h", "short-lived", db);
    // Force-expire the row, then purge at a time past expiry.
    await db.run("UPDATE sessions SET expires_at = '2026-01-01T01:00:00.000Z'");
    await purgeExpiredSessions(db, Date.parse("2026-01-01T02:00:00.000Z"));
    expect(await getSessionFromToken(token, db)).toBeNull();
  });
});

describe("maybePurgeExpiredSessions throttle", () => {
  it("runs at most once per interval", async () => {
    await db.run("DELETE FROM sessions");
    await insertSession({ id: "s-throttle", expiresAt: "2026-01-02T00:00:00.000Z" });
    const t0 = Date.parse("2026-06-01T00:00:00.000Z");
    await maybePurgeExpiredSessions(db, t0);
    expect(await sessionIds()).toEqual([]);
    // Re-insert; a call 1 minute later must NOT purge (throttled).
    await insertSession({ id: "s-throttle-2", expiresAt: "2026-01-02T00:00:00.000Z" });
    await maybePurgeExpiredSessions(db, t0 + 60_000);
    expect(await sessionIds()).toEqual(["s-throttle-2"]);
    // A call after the 1h interval purges again.
    await maybePurgeExpiredSessions(db, t0 + 3_600_001);
    expect(await sessionIds()).toEqual([]);
  });
});
