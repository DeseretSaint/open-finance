import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { SOLO_MIGRATIONS } from "@/server/db/migrations-bundle";

// The solo adapter talks to @capacitor-community/sqlite (native Android).
// Mock it with a better-sqlite3-backed connection that mirrors the plugin's
// API surface (execute/run/query with transaction=false), so the REAL
// CapSqliteDb code path runs against a real SQLite engine in Node.
vi.mock("@capacitor-community/sqlite", () => {
  class MockConnection {
    private raw: InstanceType<typeof Database>;
    constructor() {
      this.raw = new Database(":memory:");
    }
    async open() {}
    async execute(sql: string) {
      this.raw.exec(sql);
    }
    async run(sql: string, params: unknown[]) {
      const r = this.raw.prepare(sql).run(...(params as never[]));
      return { changes: { changes: r.changes, lastId: Number(r.lastInsertRowid) } };
    }
    async query(sql: string, params?: unknown[]) {
      const rows = this.raw
        .prepare(sql)
        .all(...((params ?? []) as never[])) as Record<string, unknown>[];
      return { values: rows };
    }
  }
  const conn = new MockConnection();
  return {
    CapacitorSQLite: {},
    SQLiteConnection: class {
      async checkConnectionsConsistency() {}
      async retrieveConnection() {
        return conn;
      }
      async createConnection() {
        return conn;
      }
      async saveToStore() {}
    },
  };
});

const { CapSqliteDb } = await import("@/server/db/cap-sqlite");

describe("cap-sqlite foreign key enforcement (solo parity with adapter.ts)", () => {
  it("sets PRAGMA foreign_keys = ON on the solo connection", async () => {
    const db = new CapSqliteDb();
    const rows = await db.all<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(rows[0]?.foreign_keys).toBe(1);
  });

  it("rejects an orphan budget_categories insert after solo migrate", async () => {
    const db = new CapSqliteDb();
    await db.migrate(SOLO_MIGRATIONS);
    const userId = randomUUID();
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      userId,
      "fk-solo",
      "FK Solo",
      "stub-hash",
      now,
      now
    );
    const budgetId = randomUUID();
    await db.run(
      "INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      budgetId,
      userId,
      "Food",
      10000,
      "monthly",
      now
    );
    // With foreign_keys OFF this "succeeds" (orphan); with it ON it must throw.
    await expect(
      db.run(
        "INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)",
        budgetId,
        randomUUID() // no such category
      )
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM budget_categories");
    expect(rows).toHaveLength(0);
  });
});
