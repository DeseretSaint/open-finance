import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, SqliteDb } from "@/server/db/adapter";
import { createAuthService } from "@/server/auth/service";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

let dir: string;
let file: string;
let db: SqliteDb;
const UID = "u-orphan";
const TOKEN = "tok-orphan";
const ACC = "acc-orphan";
const CAT = "cat-orphan";
const BUD = "bud-orphan";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "of-orphan-"));
  file = path.join(dir, "test.db");
  const raw = new Database(file);
  runMigrations(raw);
  raw.exec(
    `INSERT INTO users (id, username, display_name, password_hash, recovery_code_hash, created_at, updated_at)
     VALUES ('${UID}', 'orphanuser', 'Orphan', 'x', 'y', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );
  raw.close();
  db = createDb(file);
  // Populate every user-owned table with rows for UID.
  await db.run(`INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)`, UID, "2026-01-01T00:00:00.000Z");
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, last_seen_at)
     VALUES ('s-1', ?, 'th', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(`INSERT INTO device_lock (user_id, updated_at) VALUES (?, ?)`, UID, "2026-01-01T00:00:00.000Z");
  await db.run(
    `INSERT INTO plaid_credentials (id, user_id, client_id_enc, secret_enc, environment, updated_at)
     VALUES ('pc-1', ?, 'a', 'b', 'sandbox', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(
    `INSERT INTO plaid_items (id, user_id, environment, created_at) VALUES ('pi-1', ?, 'sandbox', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(
    `INSERT INTO accounts (id, user_id, name, currency, created_at) VALUES (?, ?, 'Acct', 'USD', '2026-01-01T00:00:00.000Z')`,
    ACC,
    UID
  );
  await db.run(
    `INSERT INTO balance_history (id, account_id, date, balance_cents) VALUES ('bh-1', ?, '2026-01-01', 0)`,
    ACC
  );
  await db.run(
    `INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, 'Cat', '2026-01-01T00:00:00.000Z')`,
    CAT,
    UID
  );
  await db.run(
    `INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, 'Bud', 0, 'monthly', '2026-01-01T00:00:00.000Z')`,
    BUD,
    UID
  );
  await db.run(`INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)`, BUD, CAT);
  await db.run(
    `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
     VALUES ('t-1', ?, 0, '2026-01-01', 'Txn', 'manual', '2026-01-01T00:00:00.000Z')`,
    ACC
  );
  await db.run(
    `INSERT INTO bills (id, user_id, name, amount_cents, created_at, updated_at) VALUES ('b-1', ?, 'Bill', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(
    `INSERT INTO debts (id, user_id, name, principal_cents, start_date, created_at, updated_at) VALUES ('d-1', ?, 'Debt', 0, '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(
    `INSERT INTO goals (id, user_id, name, target_cents, created_at, updated_at) VALUES ('g-1', ?, 'Goal', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(
    `INSERT INTO agent_tokens (id, user_id, name, token_hash, token_prefix, scopes, created_at) VALUES (?, ?, 'Tok', 'th2', 'pre', 'read:banking', '2026-01-01T00:00:00.000Z')`,
    TOKEN,
    UID
  );
  await db.run(
    `INSERT INTO agent_access_log (id, token_id, scope_used, tool, method, status, created_at) VALUES ('al-1', ?, 'read:banking', 'x', 'GET', 200, '2026-01-01T00:00:00.000Z')`,
    TOKEN
  );
  await db.run(
    `INSERT INTO agent_permission_requests (id, token_id, scope, requested_at) VALUES ('apr-1', ?, 'read:investments', '2026-01-01T00:00:00.000Z')`,
    TOKEN
  );
  await db.run(
    `INSERT INTO custom_views (id, user_id, tab, name, widget_def, created_at, updated_at) VALUES ('cv-1', ?, 'dashboard', 'CV', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    UID
  );
  await db.run(
    `INSERT INTO category_learnings (user_id, merchant_key, category_id, count, created_at, updated_at) VALUES (?, 'mkt', ?, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    UID,
    CAT
  );
  await db.run(`INSERT INTO agent_manual (user_id, updated_at) VALUES (?, ?)`, UID, "2026-01-01T00:00:00.000Z");
  await db.run(
    `INSERT INTO pairing_codes (code_hash, user_id, expires_at, used) VALUES ('ph', ?, '2099-01-01T00:00:00.000Z', 0)`,
    UID
  );
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("deleteUser leaves no orphaned rows", () => {
  it("removes the user and every user-owned row (direct + cascade + subquery)", async () => {
    await createAuthService(db).deleteUser(UID);

    const count = async (sql: string, ...args: unknown[]) =>
      (await db.get<{ c: number }>(sql, ...(args as [])))?.c ?? -1;

    expect(await count(`SELECT COUNT(*) c FROM users WHERE id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM user_settings WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM sessions WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM device_lock WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM plaid_credentials WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM plaid_items WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM accounts WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM categories WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM budgets WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM bills WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM debts WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM goals WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM agent_tokens WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM custom_views WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM category_learnings WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM agent_manual WHERE user_id = ?`, UID)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM pairing_codes WHERE user_id = ?`, UID)).toBe(0);
    // Subquery-cleaned tables keyed by account_id / token_id.
    expect(await count(`SELECT COUNT(*) c FROM balance_history WHERE account_id = ?`, ACC)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM transactions WHERE account_id = ?`, ACC)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM budget_categories WHERE budget_id = ?`, BUD)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM agent_access_log WHERE token_id = ?`, TOKEN)).toBe(0);
    expect(await count(`SELECT COUNT(*) c FROM agent_permission_requests WHERE token_id = ?`, TOKEN)).toBe(0);
  });
});
