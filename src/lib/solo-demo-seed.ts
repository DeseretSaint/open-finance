import type { Db } from "@/server/db/types";
import { createAccountsService } from "@/server/domain/accounts";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";
import { createBudgetsService } from "@/server/domain/budgets";
import { createPlanningService } from "@/server/domain/planning";

/**
 * Solo demo seed (P8b) — mirrors the server demo entirely on-device.
 *
 * AMOUNT SIGN CONVENTION (matches the domain everywhere, bank-app style):
 * positive = money IN (income), negative = money OUT (expense). The UI
 * colors from this: expenses red (negative), income green (positive).
 *
 * v3 (2026-08): convention flip — income POSITIVE, expenses NEGATIVE (the
 * bank-app convention; matches migration 005). Granular budgets:
 * (one per category: rent, groceries, dining, transport, utilities, fun
 * money, investing, savings) instead of a single lump sum — the AI agent's
 * budget tools (MCP create/update/delete_budget) then have meaningful
 * per-category levers.
 *
 * Version marker: app_state `demo.seed.version`. Existing demo installs from
 * v1 (inverted data) get their demo rows wiped and re-seeded when the marker
 * is missing/older — see seedSoloDemo().
 */

const SEED_VERSION = 3;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Wipe every row the demo creates for this user (idempotent re-seed). */
async function wipeDemoRows(db: Db, userId: string): Promise<void> {
  const demoAccountNames = ["Everyday Checking", "Cashback Card"];
  const placeholders = demoAccountNames.map(() => "?").join(",");
  await db.run(
    `DELETE FROM transactions WHERE account_id IN
       (SELECT id FROM accounts WHERE user_id = ? AND name IN (${placeholders}))`,
    userId,
    ...demoAccountNames
  );
  await db.run(
    `DELETE FROM balance_history WHERE account_id IN
       (SELECT id FROM accounts WHERE user_id = ? AND name IN (${placeholders}))`,
    userId,
    ...demoAccountNames
  );
  await db.run("DELETE FROM budget_categories WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ?)", userId);
  await db.run("DELETE FROM budgets WHERE user_id = ?", userId);
  await db.run("DELETE FROM bills WHERE user_id = ?", userId);
  await db.run("DELETE FROM debts WHERE user_id = ?", userId);
  await db.run("DELETE FROM goals WHERE user_id = ?", userId);
  await db.run("DELETE FROM categories WHERE user_id = ? AND is_system = 0", userId);
  await db.run(
    `DELETE FROM accounts WHERE user_id = ? AND name IN (${placeholders})`,
    userId,
    ...demoAccountNames
  );
}

export async function seedSoloDemo(db: Db, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const today = todayISO();

  // Re-seed check: wipe + reseed when the stored seed version is older.
  const verRow = await db.get<{ value: string }>(
    "SELECT value FROM app_state WHERE key = 'demo.seed.version'"
  );
  const storedVersion = verRow ? parseInt(verRow.value, 10) : 0;
  if (storedVersion >= SEED_VERSION) {
    // Fresh marker + sentinel account exists → already seeded with v2 data.
    const existing = await db.get<{ id: string }>(
      "SELECT id FROM accounts WHERE user_id = ? AND name = ?",
      userId,
      "Everyday Checking"
    );
    if (existing) return;
  } else {
    // Old or missing seed (or v1 inverted data) → clean slate.
    await wipeDemoRows(db, userId);
  }

  const accounts = createAccountsService(db);
  const categories = createCategoriesService(db);
  const transactions = createTransactionsService(db);
  const budgets = createBudgetsService(db);
  const planning = createPlanningService(db);

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

  const catNames = [
    "Rent",
    "Groceries",
    "Dining Out",
    "Transport",
    "Utilities",
    "Fun Money",
    "Investing",
    "Savings",
  ];
  const colors = ["#8B5CF6", "#10B981", "#F59E0B", "#06B6D4", "#6366F1", "#EF4444", "#22C55E", "#F97316"];
  const catIds = new Map<string, string>();
  for (let i = 0; i < catNames.length; i++) {
    const c = await categories.create(userId, { name: catNames[i], color: colors[i] });
    catIds.set(catNames[i], c.id);
  }

  // ~90 days of transactions. SIGN CONVENTION: income = positive (money
  // in), expenses = negative (money out). Rent on checking; card
  // purchases on credit.
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
    if (dayOffset % 30 === 0) {
      // Paycheck = income = POSITIVE (money in).
      await transactions.createManual(userId, {
        accountId: checking.id,
        amountCents: 2_800_00,
        date,
        name: "Paycheck",
        userCategoryId: null,
      });
      // Rent = expense = NEGATIVE (money out).
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

  // Granular budgets — one per category (the AI agent adjusts these via MCP).
  const budgetSpecs: Array<[string, number, string[]]> = [
    ["Rent", 1_650_00, ["Rent"]],
    ["Groceries", 600_00, ["Groceries"]],
    ["Dining Out", 200_00, ["Dining Out"]],
    ["Transport", 220_00, ["Transport"]],
    ["Utilities", 180_00, ["Utilities"]],
    ["Fun Money", 150_00, ["Fun Money"]],
    ["Investing", 400_00, ["Investing"]],
    ["Savings", 300_00, ["Savings"]],
  ];
  for (const [name, amountCents, cNames] of budgetSpecs) {
    await budgets.create(userId, {
      name,
      amountCents,
      period: "monthly",
      categoryIds: cNames.map((n) => catIds.get(n)!),
    });
  }

  await planning.createBill(userId, {
    name: "Internet",
    amountCents: 79_99,
    dueDay: 18,
    accountId: checking.id,
  });
  await planning.createDebt(userId, {
    name: "Cashback Card",
    principalCents: 842_19,
    aprBps: 2_499, // 24.99%
    minPaymentCents: 30_00,
    accountId: credit.id,
  });
  await planning.createGoal(userId, {
    name: "Emergency fund",
    targetCents: 10_000_00,
    monthlyContributionCents: 300_00,
  });

  // Mark the seed version so re-entry doesn't duplicate or revert.
  await db.run(
    `INSERT INTO app_state (key, value, updated_at) VALUES ('demo.seed.version', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    String(SEED_VERSION),
    now
  );
}
