import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, SqliteDb } from "@/server/db/adapter";
import {
  __touchedCountForTest,
  _resetTouchedForTest,
  touchSession,
} from "@/server/auth/sessions";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

let dir: string;
let db: SqliteDb;
let sessionId: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "of-touch-"));
  const file = path.join(dir, "test.db");
  const raw = new Database(file);
  runMigrations(raw);
  raw.exec(
    `INSERT INTO users (id, username, display_name, created_at, updated_at)
     VALUES ('u-touch', 'touchuser', 'Touch User', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );
  raw.close();
  db = createDb(file);
  sessionId = randomUUID();
  // The touched map is module-level; keep this file hermetic both ways.
  _resetTouchedForTest();
});

afterAll(() => {
  _resetTouchedForTest();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function insertSessionRow(id: string): Promise<void> {
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, expires_at, idle_timeout_h, last_seen_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    id,
    "u-touch",
    `hash-${id}`,
    "test-device",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  );
}

async function lastSeen(id: string): Promise<string | null> {
  const row = await db.get<{ last_seen_at: string | null }>(
    "SELECT last_seen_at FROM sessions WHERE id = ?",
    id
  );
  return row?.last_seen_at ?? null;
}

describe("touchSession memory bounding", () => {
  it("still throttles repeat touches within the window", async () => {
    vi.useFakeTimers();
    try {
      _resetTouchedForTest();
      const t0 = Date.parse("2026-06-01T00:00:00.000Z");
      vi.setSystemTime(t0);
      await insertSessionRow(sessionId);
      await touchSession(sessionId, db);
      const first = await lastSeen(sessionId);
      expect(first).not.toBeNull();
      // Within the 5-min window: no DB write.
      vi.setSystemTime(t0 + 60_000);
      await touchSession(sessionId, db);
      expect(await lastSeen(sessionId)).toBe(first);
      // Past the window: writes again.
      vi.setSystemTime(t0 + 300_001);
      await touchSession(sessionId, db);
      expect(await lastSeen(sessionId)).not.toBe(first);
    } finally {
      vi.useRealTimers();
      _resetTouchedForTest();
    }
  });

  it("prunes stale entries once the cap is reached", async () => {
    vi.useFakeTimers();
    try {
      _resetTouchedForTest();
      const t0 = Date.parse("2026-06-01T00:00:00.000Z");
      vi.setSystemTime(t0);
      for (let i = 0; i < 1000; i++) await touchSession(`stale-${i}`, db);
      expect(__touchedCountForTest()).toBe(1000);
      // Advance past the throttle window: every entry is inert and must be
      // reclaimed by the next touch (a missing entry behaves identically).
      vi.setSystemTime(t0 + 300_001);
      await touchSession("fresh-id", db);
      expect(__touchedCountForTest()).toBe(1);
    } finally {
      vi.useRealTimers();
      _resetTouchedForTest();
    }
  });

  it("hard-caps the tracked set under a flood of distinct fresh sessions", async () => {
    _resetTouchedForTest();
    for (let i = 0; i < 1100; i++) await touchSession(`flood-${i}`, db);
    // Cap is 1000; the set may transiently hold cap+1 (evict-then-insert).
    expect(__touchedCountForTest()).toBeLessThanOrEqual(1001);
    expect(__touchedCountForTest()).toBeLessThan(1100);
    _resetTouchedForTest();
  });
});
