import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createSummaryService } from "@/server/domain/summary";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

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
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, -320000, '2026-07-01', 'Paycheck', 'manual', ?)`,
      randomUUID(),
      acc,
      now
    );
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, 8500, '2026-07-03', 'Starbucks', 'manual', ?)`,
      randomUUID(),
      acc,
      now
    );
    // Next month — excluded from month totals
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, 9999, '2026-08-01', 'August', 'manual', ?)`,
      randomUUID(),
      acc,
      now
    );

    const summary = await createSummaryService(db).get(user.id, "2026-07-15");
    expect(summary.totalBalanceCents).toBe(400000);
    expect(summary.byType.depository).toBe(500000);
    expect(summary.byType.credit).toBe(-100000);
    expect(summary.monthIncomeCents).toBe(320000);
    expect(summary.monthExpenseCents).toBe(8500);
    expect(summary.monthNetCents).toBe(311500);
    expect(summary.recentTransactions).toHaveLength(3);
    expect(summary.budgetOverview).toEqual([]);
  });
});
