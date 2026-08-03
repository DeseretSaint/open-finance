import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { seedSoloDemo } from "@/lib/solo-demo-seed";

describe("solo demo seed (P8b)", () => {
  it("seeds demo data idempotently and the summary reflects it", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({ displayName: "Demo phone", pin: undefined });

    await seedSoloDemo(db, user.id);
    await seedSoloDemo(db, user.id); // second call must be a no-op

    const accounts = await import("@/server/domain/accounts");
    const accSvc = accounts.createAccountsService(db);
    const rows = await accSvc.list(user.id);
    expect(rows).toHaveLength(2); // checking + credit, not duplicated

    const txns = await import("@/server/domain/transactions");
    const txnSvc = txns.createTransactionsService(db);
    const list = await txnSvc.list(user.id, { limit: 200, offset: 0 });
    expect(list.total).toBeGreaterThan(20); // ~13 weeks × (2 checking + 4 credit) + paychecks

    const summary = await import("@/server/domain/summary");
    const s = await summary.createSummaryService(db).get(user.id);
    expect(s.totalBalanceCents).toBeGreaterThan(0);
  });

  it("uses the correct sign convention: income positive, expenses negative", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({ displayName: "Demo phone", pin: undefined });
    await seedSoloDemo(db, user.id);

    const txns = await import("@/server/domain/transactions");
    const txnSvc = txns.createTransactionsService(db);
    const list = await txnSvc.list(user.id, { limit: 200, offset: 0 });

    const paycheck = list.rows.find((t) => t.name === "Paycheck");
    const rent = list.rows.find((t) => t.name === "Rent");
    const groceries = list.rows.find((t) => t.name === "Groceries — WinCo");

    expect(paycheck).toBeDefined();
    expect(rent).toBeDefined();
    expect(groceries).toBeDefined();
    // income = money in = POSITIVE; expenses = money out = NEGATIVE
    expect(paycheck!.amount_cents).toBeGreaterThan(0);
    expect(rent!.amount_cents).toBeLessThan(0);
    expect(groceries!.amount_cents).toBeLessThan(0);
  });

  it("seeds granular per-category budgets (AI-adjustable)", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({ displayName: "Demo phone", pin: undefined });
    await seedSoloDemo(db, user.id);

    const budgets = await import("@/server/domain/budgets");
    const list = budgets.createBudgetsService(db).list(user.id);
    const names = (await list).map((b) => b.name);
    expect(names).toEqual(
      expect.arrayContaining(["Rent", "Groceries", "Dining Out", "Transport", "Utilities", "Fun Money", "Investing", "Savings"])
    );
  });
});
