"use client";

/**
 * Solo demo seeder — mirrors scripts/seed.js but runs IN the webview against
 * CapSqliteDb via the same domain services the app uses (so it works on any
 * Db implementation). Seeds: a checking account, a credit card, 6 categories,
 * ~3 months of transactions, a budget, a bill, a debt and a goal.
 */

import type { Db } from "@/server/db/types";
import { createAccountsService } from "@/server/domain/accounts";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";
import { createBudgetsService } from "@/server/domain/budgets";
import { createPlanningService } from "@/server/domain/planning";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function seedSoloDemo(db: Db, userId: string): Promise<void> {
  const accounts = createAccountsService(db);
  const categories = createCategoriesService(db);
  const transactions = createTransactionsService(db);
  const budgets = createBudgetsService(db);
  const planning = createPlanningService(db);

  const today = new Date().toISOString().slice(0, 10);

  // Idempotent: if the demo checking account already exists, skip.
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE user_id = ? AND name = ?",
    userId,
    "Everyday Checking"
  );
  if (existing) return;

  const checking = await accounts.createManual(userId, {
    name: "Everyday Checking",
    type: "depository",
    currentBalanceCents: 3_412_55,
    availableBalanceCents: 3_412_55,
  });
  const credit = await accounts.createManual(userId, {
    name: "Cashback Card",
    type: "credit",
    currentBalanceCents: -842_19,
    availableBalanceCents: -842_19,
  });

  const catNames = ["Groceries", "Rent", "Utilities", "Dining Out", "Transport", "Fun Money"];
  const catIds = new Map<string, string>();
  const colors = ["#10B981", "#6366F1", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"];
  for (let i = 0; i < catNames.length; i++) {
    const c = await categories.create(userId, { name: catNames[i], color: colors[i] });
    catIds.set(catNames[i], c.id);
  }

  // ~90 days of transactions, recurring weekly/monthly. Income + rent on
  // checking; card purchases on credit.
  const weeklyChecking: Array<[string, string, number]> = [
    ["Groceries — WinCo", catIds.get("Groceries")!, -148_23],
    ["Electric bill", catIds.get("Utilities")!, -84_12],
  ];
  const weeklyCredit: Array<[string, string, number]> = [
    ["Netflix", catIds.get("Fun Money")!, -15_49],
    ["Taco Tuesday", catIds.get("Dining Out")!, -32_50],
    ["Gas", catIds.get("Transport")!, -48_00],
    ["Streaming + music", catIds.get("Fun Money")!, -19_99],
  ];

  for (let dayOffset = -90; dayOffset <= 0; dayOffset += 7) {
    const date = addDays(today, dayOffset);
    // Monthly paycheck (last 3 months) + monthly rent.
    if (dayOffset % 30 === 0) {
      await transactions.createManual(userId, {
        accountId: checking.id,
        amountCents: 2_800_00,
        date,
        name: "Paycheck",
        userCategoryId: null,
      });
      await transactions.createManual(userId, {
        accountId: checking.id,
        amountCents: -1_650_00,
        date,
        name: "Rent",
        userCategoryId: catIds.get("Rent")!,
      });
    }
    for (const [name, catId, amountCents] of weeklyChecking) {
      await transactions.createManual(userId, {
        accountId: checking.id,
        amountCents,
        date,
        name,
        userCategoryId: catId,
      });
    }
    for (const [name, catId, amountCents] of weeklyCredit) {
      await transactions.createManual(userId, {
        accountId: credit.id,
        amountCents,
        date,
        name,
        userCategoryId: catId,
      });
    }
  }

  await budgets.create(userId, {
    name: "Monthly essentials",
    amountCents: 3_000_00,
    period: "monthly",
    categoryIds: [catIds.get("Groceries")!, catIds.get("Utilities")!, catIds.get("Transport")!],
  });

  await planning.createBill(userId, {
    name: "Internet",
    amountCents: 79_99,
    dueDay: 18,
    accountId: checking.id,
    categoryId: catIds.get("Utilities")!,
  });
  await planning.createDebt(userId, {
    name: "Credit card",
    principalCents: 842_19,
    aprBps: 24_99 * 100,
    minPaymentCents: 35_00,
    accountId: credit.id,
  });
  await planning.createGoal(userId, {
    name: "Emergency fund",
    targetCents: 10_000_00,
    currentCents: 3_412_55,
    monthlyContributionCents: 500_00,
  });
}
