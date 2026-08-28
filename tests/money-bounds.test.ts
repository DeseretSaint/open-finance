import { describe, expect, it } from "vitest";
import { createTransactionsService } from "@/server/domain/transactions";
import { createAccountsService } from "@/server/domain/accounts";
import { createBudgetsService } from "@/server/domain/budgets";
import { createPlanningService } from "@/server/domain/planning";
import { MAX_AMOUNT_CENTS } from "@/server/domain/money";
import { createTestDb, seedUser, seedManualAccount } from "./helpers";

describe("money magnitude bounds", () => {
  it("createManual rejects a transaction amount above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "alice");
    const acct = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    await expect(
      svc.createManual(user.id, {
        accountId: acct,
        amountCents: MAX_AMOUNT_CENTS + 1,
        date: "2026-01-01",
        name: "Too big",
      })
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM transactions WHERE account_id = ?", acct);
    expect(rows).toHaveLength(0);
  });

  it("createManual accepts a normal negative amount", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "alice");
    const acct = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    const t = await svc.createManual(user.id, {
      accountId: acct,
      amountCents: -5000,
      date: "2026-01-01",
      name: "Coffee",
    });
    expect(t.amount_cents).toBe(-5000);
  });

  it("accounts.createManual rejects a currentBalance above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "bob");
    const svc = createAccountsService(db);
    await expect(
      svc.createManual(user.id, {
        name: "Fat account",
        currentBalanceCents: -(MAX_AMOUNT_CENTS + 100),
        availableBalanceCents: -(MAX_AMOUNT_CENTS + 100),
      })
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM accounts WHERE user_id = ?", user.id);
    expect(rows).toHaveLength(0);
  });

  it("accounts.createManual accepts a normal balance", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "bob");
    const svc = createAccountsService(db);
    const a = await svc.createManual(user.id, {
      name: "Checking",
      currentBalanceCents: 123456,
      availableBalanceCents: 100000,
    });
    expect(a.current_balance_cents).toBe(123456);
  });

  it("budgets.create rejects an amount above MAX_AMOUNT_CENTS and leaves no row", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "carol");
    const svc = createBudgetsService(db);
    await expect(
      svc.create(user.id, {
        name: "Groceries",
        amountCents: MAX_AMOUNT_CENTS + 1,
        period: "monthly",
      })
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM budgets WHERE user_id = ?", user.id);
    expect(rows).toHaveLength(0);
  });

  it("budgets.create accepts a normal amount", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "carol");
    const svc = createBudgetsService(db);
    const b = await svc.create(user.id, {
      name: "Groceries",
      amountCents: 50000,
      period: "monthly",
    });
    expect(b.amount_cents).toBe(50000);
  });

  it("budgets.update rejects an amount above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "carol");
    const svc = createBudgetsService(db);
    const b = await svc.create(user.id, {
      name: "Groceries",
      amountCents: 50000,
      period: "monthly",
    });
    await expect(
      svc.update(user.id, b.id, { amountCents: MAX_AMOUNT_CENTS + 1 })
    ).rejects.toThrow();
    const row = await db.get("SELECT amount_cents FROM budgets WHERE id = ?", b.id);
    expect(row?.amount_cents).toBe(50000);
  });

  it("planning createBill rejects an amount above MAX_AMOUNT_CENTS and leaves no row", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "dave");
    const svc = createPlanningService(db);
    await expect(
      svc.createBill(user.id, { name: "Rent", amountCents: MAX_AMOUNT_CENTS + 1 })
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM bills WHERE user_id = ?", user.id);
    expect(rows).toHaveLength(0);
  });

  it("planning createDebt rejects a principal above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "erin");
    const svc = createPlanningService(db);
    await expect(
      svc.createDebt(user.id, { name: "Mortgage", principalCents: MAX_AMOUNT_CENTS + 1 })
    ).rejects.toThrow();
  });

  it("planning createGoal rejects a target above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "frank");
    const svc = createPlanningService(db);
    await expect(
      svc.createGoal(user.id, { name: "House", targetCents: -(MAX_AMOUNT_CENTS + 1) })
    ).rejects.toThrow();
  });

  it("planning updateGoal rejects a target above MAX_AMOUNT_CENTS and leaves the value unchanged", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "grace");
    const svc = createPlanningService(db);
    const g = await svc.createGoal(user.id, { name: "Car", targetCents: 2000000 });
    await expect(
      svc.updateGoal(user.id, g.id, { targetCents: MAX_AMOUNT_CENTS + 1 })
    ).rejects.toThrow();
    const row = await db.get("SELECT target_cents FROM goals WHERE id = ?", g.id);
    expect(row?.target_cents).toBe(2000000);
  });
});
