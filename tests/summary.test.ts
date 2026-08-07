import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createSummaryService } from "@/server/domain/summary";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

/** ISO date `day` days into the month that is `offset` months from now. */
function dateIn(offset: number, day: number): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1 + offset).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("summary", () => {
  it("aggregates balances, month totals, budgets, and recent transactions", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, current_balance_cents, created_at) VALUES (?, ?, NULL, 'Checking', 'depository', 'USD', 500000, ?)",
      randomUUID(),
      user.id,
      now
    );
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, current_balance_cents, created_at) VALUES (?, ?, NULL, 'Visa', 'credit', 'USD', -100000, ?)",
      randomUUID(),
      user.id,
      now
    );
    const acc = await seedManualAccount(db, user.id);
    // income = POSITIVE, expense = NEGATIVE
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, 320000, ?, 'Paycheck', 'manual', ?)`,
      randomUUID(),
      acc,
      dateIn(0, 1),
      now
    );
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, -8500, ?, 'Starbucks', 'manual', ?)`,
      randomUUID(),
      acc,
      dateIn(0, 3),
      now
    );
    // Next month — excluded from month totals
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, -9999, ?, 'August', 'manual', ?)`,
      randomUUID(),
      acc,
      dateIn(1, 1),
      now
    );

    const summary = await createSummaryService(db).get(user.id, dateIn(0, 15));
    expect(summary.totalBalanceCents).toBe(400000);
    expect(summary.byType.depository).toBe(500000);
    expect(summary.byType.credit).toBe(-100000);
    expect(summary.monthIncomeCents).toBe(320000);
    expect(summary.monthExpenseCents).toBe(8500);
    expect(summary.monthNetCents).toBe(311500);
    expect(summary.recentTransactions).toHaveLength(3);
    expect(summary.budgetOverview).toEqual([]);
  });

  it("excludes transactions belonging to soft-deleted accounts", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const visible = await seedManualAccount(db, user.id, "Visible");
    const removed = await seedManualAccount(db, user.id, "Removed");
    await db.run("UPDATE accounts SET deleted_at = ?, hidden = 0 WHERE id = ?", new Date().toISOString(), removed);
    const now = new Date().toISOString();
    for (const [accountId, amount, name] of [[visible, 10000, "Real income"], [removed, 900000, "Removed income"]] as const) {
      await db.run(
        `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
        randomUUID(), accountId, amount, dateIn(0, 5), name, now
      );
    }
    const summary = await createSummaryService(db).get(user.id, dateIn(0, 15));
    expect(summary.monthIncomeCents).toBe(10000);
    expect(summary.recentTransactions.map((t) => t.name)).not.toContain("Removed income");
  });

  it("month totals include pending income/expense by default (agent budget input)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const now = new Date().toISOString();
    // Cleared paycheck + pending second paycheck (income = positive).
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, pending, created_at) VALUES (?, ?, 120000, ?, 'Paycheck 1', 'manual', 0, ?)`,
      randomUUID(), acc, dateIn(0, 2), now
    );
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, pending, created_at) VALUES (?, ?, 120000, ?, 'Paycheck 2 (pending)', 'manual', 1, ?)`,
      randomUUID(), acc, dateIn(0, 20), now
    );
    const summary = await createSummaryService(db).get(user.id, dateIn(0, 25));
    // Default includePending=true → full month income is what the agent sees
    // via /api/agent/summary when building budgets.
    expect(summary.monthIncomeCents).toBe(240000);
    // Opt-out excludes pending.
    const strict = await createSummaryService(db).get(user.id, dateIn(0, 25), null, { kind: "month" }, false, false);
    expect(strict.monthIncomeCents).toBe(120000);
  });
});
