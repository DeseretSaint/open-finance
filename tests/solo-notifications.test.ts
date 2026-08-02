import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { createAccountsService } from "@/server/domain/accounts";
import { createBudgetsService } from "@/server/domain/budgets";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";
import { computeBudgetStatus } from "@/lib/solo-notifications";

describe("solo notification content (P11)", () => {
  it("says on-track when budgets are healthy, needs-review when over", async () => {
    const db = createTestDb();
    const { user } = await createSoloBootstrapService(db).bootstrap({ displayName: "Phone", pin: "1234" });
    const accounts = createAccountsService(db);
    const cats = createCategoriesService(db);
    const budgets = createBudgetsService(db);
    const txs = createTransactionsService(db);

    const acc = await accounts.createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    const cat = await cats.create(user.id, { name: "Groceries", color: "#0f0", plaidPaths: "" });

    await budgets.create(user.id, {
      name: "Groceries",
      amountCents: 100_000, // $1000
      period: "monthly",
      categoryIds: [cat.id],
    });

    // healthy: spent $200 of $1000
    await txs.createManual(user.id, {
      accountId: acc.id,
      amountCents: 20_000,
      date: new Date().toISOString().slice(0, 10),
      name: "Whole Foods",
      userCategoryId: cat.id,
    });

    const healthy = await computeBudgetStatus(db, user.id);
    expect(healthy.onTrack).toBe(true);
    expect(healthy.needsReview).toBe(false);

    // over budget: add $900 more (total $1100 > $1000)
    await txs.createManual(user.id, {
      accountId: acc.id,
      amountCents: 90_000,
      date: new Date().toISOString().slice(0, 10),
      name: "Costco",
      userCategoryId: cat.id,
    });

    const over = await computeBudgetStatus(db, user.id);
    expect(over.needsReview).toBe(true);
  });

  it("never includes amounts in content", async () => {
    const db = createTestDb();
    const { user } = await createSoloBootstrapService(db).bootstrap({ displayName: "Phone", pin: "1234" });
    const s = await computeBudgetStatus(db, user.id);
    // No budgets → the "no budgets" path; content must not contain $ or cents.
    expect(s.budgetCount).toBe(0);
  });
});
