import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import type { Db } from "@/server/db/types";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";

/**
 * Solo router tests (P8b): exercise the in-process API surface against a real
 * schema DB. The router normally uses CapSqliteDb (device SQLite); in tests we
 * inject the in-memory test Db via the singleton so the full flow — bootstrap,
 * account, category, transaction, budget, summary — is verified against the
 * exact production schema.
 */

// The router builds services with getSoloDb(); tests swap the module-level
// singleton through the service factories' DI. We test the DOMAIN FLOW here
// (same services the router calls) plus the router's dispatch logic against
// a fake Db registry where possible.

describe("solo flow (P8b) — bootstrap → account → category → transaction → budget → summary", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {});

  it("bootstrap creates a device user, then manual entry flows work", async () => {
    const solo = createSoloBootstrapService(db);
    const { user, recoveryCode } = await solo.bootstrap({ displayName: "My Phone", pin: "1234" });

    expect(user.username).toMatch(/^device-/);
    expect(recoveryCode).toBeTruthy();
    expect(await solo.hasPin()).toBe(true);

    // account
    const accounts = await import("@/server/domain/accounts");
    const accSvc = accounts.createAccountsService(db);
    const account = await accSvc.createManual(user.id, {
      name: "Checking",
      type: "depository",
      currentBalanceCents: 100_000,
    });
    expect(account.id).toBeTruthy();

    // category
    const cats = await import("@/server/domain/categories");
    const catSvc = cats.createCategoriesService(db);
    const cat = await catSvc.create(user.id, { name: "Groceries", color: "#10B981" });
    expect(cat.name).toBe("Groceries");

    // transaction (expense = negative cents)
    const txns = await import("@/server/domain/transactions");
    const txnSvc = txns.createTransactionsService(db);
    const txn = await txnSvc.createManual(user.id, {
      accountId: account.id,
      amountCents: -5230,
      date: new Date().toISOString().slice(0, 10),
      name: "Whole Foods",
      userCategoryId: cat.id,
    });
    expect(txn.amount_cents).toBe(-5230);

    const list = await txnSvc.list(user.id, { limit: 50, offset: 0 });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].name).toBe("Whole Foods");

    // budget
    const budgets = await import("@/server/domain/budgets");
    const bSvc = budgets.createBudgetsService(db);
    const budget = await bSvc.create(user.id, {
      name: "Food",
      amountCents: 50_000,
      period: "monthly",
      categoryIds: [cat.id],
    });
    expect(budget.id).toBeTruthy();

    // summary
    const summary = await import("@/server/domain/summary");
    const sSvc = summary.createSummaryService(db);
    const s = await sSvc.get(user.id);
    expect(s.totalBalanceCents).toBe(100_000);
  });

  it("device PIN lock/unlock flows work end-to-end", async () => {
    const solo = createSoloBootstrapService(db);
    await solo.bootstrap({ pin: "4321" });
    const user = (await solo.getDeviceUser())!;

    const deviceLock = await import("@/server/domain/device-lock");
    const lock = deviceLock.createDeviceLockService(db);

    expect((await lock.state(user.id)).configured).toBe(true);
    await lock.unlock(user.id, "4321");
    await expect(lock.unlock(user.id, "0000")).rejects.toThrow();
  });

  it("recovery code resets the PIN", async () => {
    const solo = createSoloBootstrapService(db);
    const { recoveryCode } = await solo.bootstrap({ pin: "1111" });
    await solo.resetPin(recoveryCode, "2222");
    expect(await solo.verifyRecoveryCode(recoveryCode)).toBe(true);
    await solo.unlock("2222");
  });

  it("transactions.update handles category + exclude-from-budgets (issues #4/#5 — the solo PATCH route calls this)", async () => {
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({});

    const accounts = await import("@/server/domain/accounts");
    const account = await accounts
      .createAccountsService(db)
      .createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    const cats = await import("@/server/domain/categories");
    const catSvc = cats.createCategoriesService(db);
    const groceries = await catSvc.create(user.id, { name: "Groceries", color: "#10B981" });
    const dining = await catSvc.create(user.id, { name: "Dining", color: "#F59E0B" });
    const txns = await import("@/server/domain/transactions");
    const txnSvc = txns.createTransactionsService(db);
    const txn = await txnSvc.createManual(user.id, {
      accountId: account.id,
      amountCents: -5230,
      date: new Date().toISOString().slice(0, 10),
      name: "Whole Foods",
      userCategoryId: groceries.id,
    });

    // Default: included in budgets (exclude_from_budgets = 0).
    let got = (await txnSvc.list(user.id, { limit: 10, offset: 0 })).rows[0];
    expect(got.exclude_from_budgets).toBe(0);

    // Issue #4: toggling "exclude" actually persists.
    await txnSvc.update(user.id, txn.id, { excludeFromBudgets: true });
    got = (await txnSvc.list(user.id, { limit: 10, offset: 0 })).rows[0];
    expect(got.exclude_from_budgets).toBe(1);

    // Issue #5: changing the category actually updates it.
    await txnSvc.update(user.id, txn.id, { userCategoryId: dining.id });
    got = (await txnSvc.list(user.id, { limit: 10, offset: 0 })).rows[0];
    expect(got.user_category_id).toBe(dining.id);
  });
});
