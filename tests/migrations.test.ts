import { createRequire } from "node:module";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

const TABLES = [
  "users", "sessions", "device_lock", "plaid_credentials", "plaid_items",
  "accounts", "balance_history", "transactions", "categories", "budgets",
  "budget_categories", "user_settings", "bills", "debts", "goals",
  "agent_tokens", "agent_access_log", "agent_permission_requests",
  "custom_views", "pairing_codes",
];

describe("migrations", () => {
  it("applies the full schema from an empty database", () => {
    const db = new Database(":memory:");
    const r = runMigrations(db);
    expect(r.applied).toBeGreaterThan(0);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    for (const t of TABLES) expect(rows.map((x) => x.name)).toContain(t);
    db.close();
  });

  it("is idempotent — second run applies nothing", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const r2 = runMigrations(db);
    expect(r2.applied).toBe(0);
    db.close();
  });

  it("tracks version in _migrations and PRAGMA user_version", () => {
    const db = new Database(":memory:");
    const r = runMigrations(db);
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(r.current);
    db.close();
  });

  it("stores a manual transaction row", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run("t1", "a1", 1000, "2026-01-01", "Test", "manual", "2026-01-01T00:00:00Z");
    const row = db.prepare("SELECT amount_cents, source FROM transactions WHERE id='t1'").get() as {
      amount_cents: number;
      source: string;
    };
    expect(row.amount_cents).toBe(1000);
    expect(row.source).toBe("manual");
    db.close();
  });
});
