import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createPlanningService, amortize, advanceDueDate, initialDueDate, nextOccurrenceOfDay } from "@/server/domain/planning";
import { createProjectionService } from "@/server/domain/projection";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

async function seedCategory(db: ReturnType<typeof createTestDb>, userId: string, name: string) {
  const id = randomUUID();
  await db.run(
    "INSERT INTO categories (id, user_id, name, color, is_system, created_at) VALUES (?, ?, ?, NULL, 1, ?)",
    id,
    userId,
    name,
    new Date().toISOString()
  );
  return id;
}

async function seedTxn(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  accountId: string,
  over: { date: string; amountCents: number; categoryId?: string | null; name?: string }
) {
  await db.run(
    `INSERT INTO transactions
       (id, account_id, amount_cents, date, name, user_category_id, pending, exclude_from_budgets, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'manual', ?)`,
    randomUUID(),
    accountId,
    over.amountCents,
    over.date,
    over.name ?? "Txn",
    over.categoryId ?? null,
    new Date().toISOString()
  );
}

async function seedBalance(db: ReturnType<typeof createTestDb>, userId: string, accountId: string, balanceCents: number) {
  await db.run("UPDATE accounts SET current_balance_cents = ? WHERE id = ?", balanceCents, accountId);
}

describe("planning dates", () => {
  it("nextOccurrenceOfDay clamps to month end and rolls forward", () => {
    expect(nextOccurrenceOfDay(15, "2026-07-10")).toBe("2026-07-15");
    expect(nextOccurrenceOfDay(15, "2026-07-20")).toBe("2026-08-15");
    expect(nextOccurrenceOfDay(31, "2026-02-10")).toBe("2026-02-28");
    expect(nextOccurrenceOfDay(31, "2024-02-10")).toBe("2024-02-29"); // leap year
  });

  it("advanceDueDate steps by frequency", () => {
    expect(advanceDueDate("weekly", "2026-07-01")).toBe("2026-07-08");
    expect(advanceDueDate("biweekly", "2026-07-01")).toBe("2026-07-15");
    expect(advanceDueDate("monthly", "2026-01-31")).toBe("2026-02-28"); // clamped
    expect(advanceDueDate("quarterly", "2026-07-01")).toBe("2026-10-01");
    expect(advanceDueDate("yearly", "2026-07-01")).toBe("2027-07-01");
    expect(advanceDueDate("one-time", "2026-07-01")).toBeNull();
  });

  it("initialDueDate prefers explicit date, then due day, then frequency default", () => {
    expect(initialDueDate("monthly", 15, "2026-12-25", "2026-07-01")).toBe("2026-12-25");
    expect(initialDueDate("monthly", 15, null, "2026-07-01")).toBe("2026-07-15");
    expect(initialDueDate("weekly", null, null, "2026-07-01")).toBe("2026-07-08");
    expect(initialDueDate("one-time", null, null, "2026-07-01")).toBeNull();
    expect(initialDueDate("one-time", null, "2026-08-01", "2026-07-01")).toBe("2026-08-01");
  });
});

describe("bills", () => {
  it("creates a monthly bill with a computed due date", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const bill = await svc.createBill(user.id, { name: "Rent", amountCents: 150000, frequency: "monthly", dueDay: 1 });
    expect(bill.name).toBe("Rent");
    expect(bill.amount_cents).toBe(150000);
    expect(bill.next_due_date).toMatch(/^\d{4}-\d{2}-01$/);
    expect(bill.active).toBe(true);
  });

  it("creates a bill from a transaction (prefill)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    await seedTxn(db, user.id, acc, { date: "2026-07-10", amountCents: 4200, categoryId: food, name: "Netflix" });
    const txn = await db.get<{ id: string }>("SELECT id FROM transactions LIMIT 1");
    const svc = createPlanningService(db);
    const bill = await svc.createBill(user.id, { name: "", amountCents: 0, transactionId: txn!.id });
    expect(bill.name).toBe("Netflix");
    expect(bill.amount_cents).toBe(4200);
    expect(bill.category_id).toBe(food);
  });

  it("marking paid remembers the actual amount and advances the due date", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const bill = await svc.createBill(user.id, { name: "Electric", amountCents: 8000, frequency: "monthly", nextDueDate: "2026-07-15" });
    const paid = await svc.payBill(user.id, bill.id, 9344); // variable bill: actual amount differs
    expect(paid.last_paid_amount_cents).toBe(9344);
    expect(paid.next_due_date).toBe("2026-08-15");
  });

  it("paying a one-time bill deactivates it", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const bill = await svc.createBill(user.id, { name: "Tax", amountCents: 50000, frequency: "one-time", nextDueDate: "2026-07-31" });
    const paid = await svc.payBill(user.id, bill.id);
    expect(paid.active).toBe(false);
    expect(paid.next_due_date).toBeNull();
    await expect(svc.payBill(user.id, bill.id)).rejects.toThrow();
  });

  it("updates and deletes bills, scoped per user", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    const svc = createPlanningService(db);
    const bill = await svc.createBill(u1.id, { name: "Rent", amountCents: 150000 });
    const updated = await svc.updateBill(u1.id, bill.id, { amountCents: 160000, name: "Rent v2" });
    expect(updated.amount_cents).toBe(160000);
    await expect(svc.updateBill(u2.id, bill.id, { amountCents: 1 })).rejects.toThrow();
    await svc.removeBill(u1.id, bill.id);
    expect(await svc.listBills(u1.id)).toHaveLength(0);
  });

  it("validates amount and frequency", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    await expect(svc.createBill(user.id, { name: "Bad", amountCents: -5 })).rejects.toThrow();
    await expect(svc.createBill(user.id, { name: "Bad", amountCents: 100, frequency: "daily" as never })).rejects.toThrow();
    await expect(svc.createBill(user.id, { name: "OneTime", amountCents: 100, frequency: "one-time" })).rejects.toThrow(); // needs date
  });
});

describe("debts & amortization", () => {
  it("computes a fixed payment from term and simulates payoff", () => {
    // $10,000 at 6% APR over 36 months → ~$304.22/mo
    const a = amortize(1_000_000, 600, 36, 0);
    expect(a.monthlyPaymentCents).toBeGreaterThan(30000);
    expect(a.monthlyPaymentCents).toBeLessThan(31000);
    expect(a.monthsToPayoff).toBeLessThanOrEqual(36);
    expect(a.totalInterestCents).toBeGreaterThan(0);
    expect(a.payoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the minimum payment when no term is set (longer payoff, more interest)", () => {
    const a = amortize(1_000_000, 600, null, 15000);
    expect(a.monthlyPaymentCents).toBe(15000);
    expect(a.monthsToPayoff).toBeGreaterThan(36);
  });

  it("returns null payoff when payment is zero or below interest", () => {
    expect(amortize(1_000_000, 600, null, 0).monthsToPayoff).toBeNull();
    // $10k at 24% APR, $100/mo — interest alone is ~$200/mo, never pays down
    const a = amortize(1_000_000, 2400, null, 10000);
    expect(a.monthsToPayoff).toBeNull();
    expect(a.monthlyPaymentCents).toBe(10000);
  });

  it("0% APR with term is principal divided by months", () => {
    const a = amortize(1_200_000, 0, 12, 0);
    expect(a.monthlyPaymentCents).toBe(100000);
    expect(a.monthsToPayoff).toBe(12);
    expect(a.totalInterestCents).toBe(0);
  });

  it("CRUD + amortization surfaces on the service", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const debt = await svc.createDebt(user.id, {
      name: "Car loan",
      principalCents: 2_000_000,
      aprBps: 480,
      minPaymentCents: 40000,
      termMonths: 60,
    });
    expect(debt.amortization.monthlyPaymentCents).toBeGreaterThan(0);
    expect(debt.amortization.monthsToPayoff).toBeGreaterThan(0);
    expect(debt.amortization.monthsToPayoff).toBeLessThanOrEqual(60);
    const list = await svc.listDebts(user.id);
    expect(list[0].name).toBe("Car loan");
    await svc.removeDebt(user.id, debt.id);
    expect(await svc.listDebts(user.id)).toHaveLength(0);
  });
});

describe("goals", () => {
  it("computes progress, months left, required contribution, and projected completion", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const goal = await svc.createGoal(user.id, {
      name: "Emergency fund",
      targetCents: 1_200_000,
      currentCents: 300_000,
      targetDate: "2026-12-31",
      monthlyContributionCents: 50_000,
    });
    expect(goal.pct).toBeCloseTo(0.25);
    expect(goal.monthsLeft).toBeGreaterThan(0);
    expect(goal.requiredMonthlyCents).toBeGreaterThan(0);
    expect(goal.projectedCompletionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("no target date → no required contribution or months left", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const goal = await svc.createGoal(user.id, { name: "Vacation", targetCents: 500_000 });
    expect(goal.monthsLeft).toBeNull();
    expect(goal.requiredMonthlyCents).toBeNull();
  });

  it("CRUD with validation", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    await expect(svc.createGoal(user.id, { name: "", targetCents: 100 })).rejects.toThrow();
    await expect(svc.createGoal(user.id, { name: "X", targetCents: -1 })).rejects.toThrow();
    const g = await svc.createGoal(user.id, { name: "House", targetCents: 10_000_000 });
    const updated = await svc.updateGoal(user.id, g.id, { currentCents: 1_000_000 });
    expect(updated.current_cents).toBe(1_000_000);
    await svc.removeGoal(user.id, g.id);
    expect(await svc.listGoals(user.id)).toHaveLength(0);
  });
});

describe("digest", () => {
  it("returns upcoming and overdue bills within the window", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10); // 5 days ago
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10); // 5 days out
    const far = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10); // 90 days out

    await svc.createBill(user.id, { name: "Rent", amountCents: 150000, frequency: "monthly", nextDueDate: past }); // overdue
    await svc.createBill(user.id, { name: "Netflix", amountCents: 1549, frequency: "monthly", nextDueDate: soon }); // upcoming
    await svc.createBill(user.id, { name: "Far", amountCents: 100, frequency: "monthly", nextDueDate: far }); // outside

    const d = await svc.digest(user.id, 30);
    expect(d.overdueBills.map((b) => b.name)).toEqual(["Rent"]);
    expect(d.upcomingBills.map((b) => b.name)).toEqual(["Netflix"]);
    expect(d.totalUpcomingCents).toBe(1549);
  });
});

describe("projection", () => {
  /** Month-start ISO for `offset` months relative to the current month. */
  function monthStart(offset: number): string {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset, 1).toISOString().slice(0, 10);
  }

  async function seedScenario(db: ReturnType<typeof createTestDb>, userId: string, accountId: string) {
    const income = await seedCategory(db, userId, "Income");
    // 3 full months of income (previous 3 months, so the projection's
    // "last 3 FULL months" window sees exactly them) — income = POSITIVE.
    for (let i = 3; i >= 1; i--) {
      const m = monthStart(-i).slice(0, 7);
      await seedTxn(db, userId, accountId, { date: `${m}-05`, amountCents: 500000, categoryId: income, name: "Paycheck" });
      await seedTxn(db, userId, accountId, { date: `${m}-15`, amountCents: 500000, categoryId: income, name: "Paycheck" });
    }
    await seedBalance(db, userId, accountId, 1_000_000); // $10k baseline
  }

  it("projects balance with income, bills, debts, and flags", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedScenario(db, user.id, acc);
    const svc = createPlanningService(db);
    const proj = createProjectionService(db);

    await svc.createBill(user.id, { name: "Rent", amountCents: 200000, frequency: "monthly", nextDueDate: monthStart(0) });
    await svc.createBill(user.id, { name: "Insurance", amountCents: 120000, frequency: "yearly", nextDueDate: `${monthStart(0).slice(0, 7)}-15` }); // ≈ $10k/mo
    await svc.createDebt(user.id, { name: "Loan", principalCents: 100000, minPaymentCents: 20000 });

    const p = await proj.project(user.id, 12);
    expect(p.estimate).toBe(true);
    expect(p.assumes).toBe("all things constant");
    expect(p.baselineCents).toBe(1_000_000);
    expect(p.monthlyIncomeCents).toBe(1_000_000); // $10k/mo avg (2 paychecks × $5k)
    expect(p.monthlyBillsCents).toBe(200000 + 10000); // rent + yearly/12
    expect(p.monthlyDebtCents).toBe(20000);
    expect(p.points).toHaveLength(12);
    // month 1: 1,000,000 + 1,000,000 − 210,000 − 20,000 − goals(0)
    expect(p.points[0].balanceCents).toBe(1_770_000);
    expect(p.points[0].flag).toBe("ok");
    expect(p.dangerMonths).toHaveLength(0);
    expect(p.emergencyFund.recommendedCents).toBe((200000 + 10000 + 20000) * 3);
  });

  it("flags danger when projected balance goes negative", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedScenario(db, user.id, acc);
    const svc = createPlanningService(db);
    const proj = createProjectionService(db);

    await svc.createBill(user.id, { name: "Huge", amountCents: 2_500_000, frequency: "monthly", nextDueDate: monthStart(0) });
    const p = await proj.project(user.id, 12);
    // 1,000,000 + 1,000,000 − 2,500,000 = −500,000 → danger immediately
    expect(p.points[0].flag).toBe("danger");
    expect(p.dangerMonths).toContain(p.points[0].month);
  });

  it("uses last paid amount for variable bills", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedScenario(db, user.id, acc);
    const svc = createPlanningService(db);
    const proj = createProjectionService(db);

    const bill = await svc.createBill(user.id, { name: "Electric", amountCents: 5000, frequency: "monthly", nextDueDate: monthStart(0) });
    await svc.payBill(user.id, bill.id, 9344); // actual last paid amount
    const p = await proj.project(user.id, 12);
    expect(p.monthlyBillsCents).toBe(9344);
  });

  it("lands one-time bills on their month and skips inactive bills", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedScenario(db, user.id, acc);
    const svc = createPlanningService(db);
    const proj = createProjectionService(db);

    // One-time bill lands 2 months out (points[0] is next month); inactive
    // monthly bill in the current month.
    const oneTime = `${monthStart(2).slice(0, 7)}-15`;
    await svc.createBill(user.id, { name: "Tax", amountCents: 300000, frequency: "one-time", nextDueDate: oneTime });
    const inactive = await svc.createBill(user.id, { name: "Old", amountCents: 100000, frequency: "monthly", nextDueDate: monthStart(0) });
    await svc.updateBill(user.id, inactive.id, { active: false });

    const p = await proj.project(user.id, 12);
    // Month 0 (next month): baseline 1,000,000 + income 1,000,000 − no monthly bills (Old inactive) = 2,000,000
    expect(p.points[0].balanceCents).toBe(2_000_000);
    // One-time bill month: 2,000,000 + 1,000,000 − one-time Tax 300,000 = 2,700,000
    const billed = p.points.find((pt) => pt.month === monthStart(2).slice(0, 7))!;
    expect(billed.balanceCents).toBe(2_700_000);
    // Following month: no one-time → 3,700,000
    expect(p.points[2].balanceCents).toBe(3_700_000);
  });

  it("caps goal contributions at the monthly surplus and can be toggled", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedScenario(db, user.id, acc);
    const svc = createPlanningService(db);
    const proj = createProjectionService(db);

    await svc.createGoal(user.id, {
      name: "Huge goal",
      targetCents: 100_000_000,
      currentCents: 0,
      targetDate: `${monthStart(6).slice(0, 7)}-31`,
    }); // needs ~$20M/mo — way over surplus
    const withGoals = await proj.project(user.id, 12, true);
    const without = await proj.project(user.id, 12, false);
    // surplus = 1,000,000 − 0 (no bills) − 0 (no debts) → goal capped at 1,000,000
    expect(withGoals.monthlyGoalCents).toBe(1_000_000);
    expect(without.monthlyGoalCents).toBe(0);
  });

  it("produces a warning flag when balance dips below one month of expenses", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedScenario(db, user.id, acc);
    const svc = createPlanningService(db);
    const proj = createProjectionService(db);

    // expenses ≈ $1.05M/mo vs income $1M/mo → balance erodes by $50k/mo,
    // crossing below 1 month of expenses (avg $1.05M) without hitting zero
    await svc.createBill(user.id, { name: "Rent", amountCents: 600000, frequency: "monthly", nextDueDate: monthStart(0) });
    await svc.createBill(user.id, { name: "Car", amountCents: 450000, frequency: "monthly", nextDueDate: monthStart(0) });
    const p = await proj.project(user.id, 12);
    // month 1: 1,000,000 + 1,000,000 − 1,050,000 = 950,000 < 1,050,000 → warning
    expect(p.points[0].flag).toBe("warning");
    expect(p.warningMonths).toContain(p.points[0].month);
    // never actually hits zero within 12 months (balance 400,000 at end) → no danger
    expect(p.dangerMonths).toHaveLength(0);
  });

  it("expense goals (one-off bills) persist their contribution plan (012)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);
    const expense = await svc.createGoal(user.id, {
      name: "Midwife",
      type: "expense",
      targetCents: 380_000,
      targetDate: "2026-08-31",
      monthlyContributionCents: 20_000,
      contributionMode: "days_of_month",
      contributionDays: [5, 20],
    });
    expect(expense.type).toBe("expense");
    expect(expense.contribution_mode).toBe("days_of_month");
    expect(JSON.parse(expense.contribution_days ?? "[]")).toEqual([5, 20]);

    // Interval mode validates its interval.
    const iv = await svc.createGoal(user.id, {
      name: "Car registration",
      type: "expense",
      targetCents: 60_000,
      contributionMode: "interval",
      contributionInterval: "biweekly",
    });
    expect(iv.contribution_mode).toBe("interval");
    expect(iv.contribution_interval).toBe("biweekly");

    // Bad mode rejected.
    await expect(
      svc.createGoal(user.id, { name: "Bad", type: "expense", targetCents: 100, contributionMode: "sometimes" as string })
    ).rejects.toThrow();
    // Interval without an interval rejected.
    await expect(
      svc.createGoal(user.id, { name: "Bad2", type: "expense", targetCents: 100, contributionMode: "interval" })
    ).rejects.toThrow();

    // updateGoal can switch the plan.
    const switched = await svc.updateGoal(user.id, expense.id, { contributionMode: "agent" });
    expect(switched.contribution_mode).toBe("agent");
  });

  it("manual paydays: set/get + next payday calculation (012)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createPlanningService(db);

    expect(await svc.getPaydays(user.id)).toEqual({ mode: "auto", interval: null, days: [] });

    const set = await svc.setPaydays(user.id, { mode: "days_of_month", days: [15, 30] });
    expect(set.mode).toBe("days_of_month");
    expect(set.days).toEqual([15, 30]);

    const next = await svc.nextPaydayAfter(user.id, "2026-08-10");
    expect(next).toBe("2026-08-15");

    // Next month when both days have passed.
    const next2 = await svc.nextPaydayAfter(user.id, "2026-08-31");
    expect(next2).toBe("2026-09-15");

    // Interval mode.
    await svc.setPaydays(user.id, { mode: "interval", interval: "biweekly" });
    expect(await svc.nextPaydayAfter(user.id, "2026-08-10")).toBe("2026-08-24");

    // Auto mode returns null (caller falls back to income probe).
    await svc.setPaydays(user.id, { mode: "auto" });
    expect(await svc.nextPaydayAfter(user.id, "2026-08-10")).toBeNull();

    // Validation: days_of_month needs days; interval needs an interval.
    await expect(svc.setPaydays(user.id, { mode: "days_of_month", days: [] })).rejects.toThrow();
    await expect(svc.setPaydays(user.id, { mode: "interval" })).rejects.toThrow();
  });
});
