import { createRequire } from "node:module";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

// Build a realistic db: 3 accounts, lots of transactions, a few pending each,
// then ANALYZE so the planner has stats to pick the partial index.
function seed(db: Database.Database) {
  db.exec(`INSERT INTO users (id, username, display_name, created_at, updated_at)
           VALUES ('u1','u','U','2026-01-01','2026-01-01')`);
  const insAcct = db.prepare(
    `INSERT INTO accounts (id, user_id, name, type, currency, created_at)
     VALUES (?,?,?,?,?,?)`
  );
  const insTxn = db.prepare(
    `INSERT INTO transactions (id, account_id, amount_cents, date, name, pending, exclude_from_budgets, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  for (let a = 0; a < 3; a++) {
    const aid = `a${a}`;
    insAcct.run(aid, "u1", `Acct ${a}`, "depository", "USD", "2026-01-01");
    for (let t = 0; t < 200; t++) {
      // ~5% of rows are pending, scattered across accounts
      const pending = t % 19 === 0 ? 1 : 0;
      insTxn.run(
        `${aid}-${t}`,
        aid,
        -100,
        `2026-02-${String((t % 28) + 1).padStart(2, "0")}`,
        `Merchant ${t}`,
        pending,
        0,
        "plaid",
        "2026-02-01"
      );
    }
  }
  db.exec("ANALYZE");
}

const SUBQ = `SELECT a.id,
  (SELECT COALESCE(SUM(t.amount_cents),0) FROM transactions t
   WHERE t.account_id = a.id AND t.pending = 1 AND t.exclude_from_budgets = 0 AND t.is_transfer = 0) AS pending_balance_cents
FROM accounts a WHERE a.user_id = 'u1'`;

describe("pending-balance partial index (021)", () => {
  it("migration 21 is applied by the runner", () => {
    const db = new Database(":memory:");
    const r = runMigrations(db);
    expect(r.current).toBeGreaterThanOrEqual(21);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_txn_account_pending'"
      )
      .get();
    expect(row).toBeTruthy();
    db.close();
  });

  it("planner uses idx_txn_account_pending for the correlated pending subquery", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    seed(db);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${SUBQ}`).all() as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(" | ");
    // The correlated subquery must seek via the partial index, not a full scan.
    expect(detail).toContain("idx_txn_account_pending");
    db.close();
  });

  it("pending balance is computed correctly via the indexed subquery", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    seed(db);
    const rows = db.prepare(SUBQ).all() as { id: string; pending_balance_cents: number }[];
    expect(rows.length).toBe(3);
    for (const r of rows) {
      // every pending row here is an expense (-100), so the sum must be negative
      expect(r.pending_balance_cents).toBeLessThan(0);
    }
    db.close();
  });
});
