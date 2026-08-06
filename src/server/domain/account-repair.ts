import type { Db } from "@/server/db/registry";

/**
 * One-time/idempotent repair for account data:
 *  1. Linked credit/loan balances are stored positive by Plaid sync; the app
 *     convention is negative = owed. Normalize the sign so they render red.
 *  2. Real (non-demo) accounts may still hold demo-origin rows from devices
 *     upgraded before demo data purging existed. Remove exactly the seeded
 *     demo dataset — sentinel names/amounts — without touching user data.
 */

const DEMO_ACCOUNT_NAMES = ["Everyday Checking", "Cashback Card"];
const DEMO_CATEGORY_NAMES = ["Rent", "Groceries", "Dining Out", "Transport", "Utilities", "Fun Money", "Investing", "Savings"];
const DEMO_BUDGETS: Array<[string, number]> = [
  ["Rent", 1_650_00],
  ["Groceries", 600_00],
  ["Dining Out", 200_00],
  ["Transport", 220_00],
  ["Utilities", 180_00],
  ["Fun Money", 150_00],
  ["Investing", 400_00],
  ["Savings", 300_00],
];
const DEMO_BILLS: Array<[string, number]> = [["Internet", 79_99]];
const DEMO_DEBTS: Array<[string, number]> = [["Cashback Card", 842_19]];
const DEMO_GOALS: Array<[string, number]> = [["Emergency fund", 10_000_00]];

export async function repairAccountRows(db: Db, userId: string): Promise<void> {
  const user = await db.get<{ is_demo: number }>("SELECT is_demo FROM users WHERE id = ?", userId);
  if (!user) return;

  await db.transaction(async () => {
    // 1. Linked liability balances: Plaid reports positive owed amounts.
    await db.run(
      `UPDATE accounts
          SET current_balance_cents = -current_balance_cents,
              available_balance_cents = CASE WHEN available_balance_cents IS NULL THEN NULL ELSE -available_balance_cents END
        WHERE user_id = ? AND item_id IS NOT NULL AND type IN ('credit', 'loan')
          AND current_balance_cents > 0`,
      userId
    );

    if (user.is_demo === 1) return;

    // 2. Purge demo-origin rows (sentinel names/amounts) from real accounts.
    const accountPlaceholders = DEMO_ACCOUNT_NAMES.map(() => "?").join(",");
    await db.run(
      `DELETE FROM transactions WHERE account_id IN
         (SELECT id FROM accounts WHERE user_id = ? AND item_id IS NULL AND name IN (${accountPlaceholders}))`,
      userId,
      ...DEMO_ACCOUNT_NAMES
    );
    await db.run(
      `DELETE FROM balance_history WHERE account_id IN
         (SELECT id FROM accounts WHERE user_id = ? AND item_id IS NULL AND name IN (${accountPlaceholders}))`,
      userId,
      ...DEMO_ACCOUNT_NAMES
    );
    await db.run(
      `DELETE FROM accounts WHERE user_id = ? AND item_id IS NULL AND name IN (${accountPlaceholders})`,
      userId,
      ...DEMO_ACCOUNT_NAMES
    );

    for (const [name, amount] of DEMO_BUDGETS) {
      await db.run("DELETE FROM budget_categories WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ? AND name = ? AND amount_cents = ?)", userId, name, amount);
      await db.run("DELETE FROM budgets WHERE user_id = ? AND name = ? AND amount_cents = ?", userId, name, amount);
    }
    for (const [name, amount] of DEMO_BILLS) {
      await db.run("DELETE FROM bills WHERE user_id = ? AND name = ? AND amount_cents = ?", userId, name, amount);
    }
    for (const [name, amount] of DEMO_DEBTS) {
      await db.run("DELETE FROM debts WHERE user_id = ? AND name = ? AND principal_cents = ?", userId, name, amount);
    }
    for (const [name, amount] of DEMO_GOALS) {
      await db.run("DELETE FROM goals WHERE user_id = ? AND name = ? AND target_cents = ?", userId, name, amount);
    }

    const categoryPlaceholders = DEMO_CATEGORY_NAMES.map(() => "?").join(",");
    await db.run(
      `DELETE FROM categories
        WHERE user_id = ? AND is_system = 0 AND name IN (${categoryPlaceholders})
          AND id NOT IN (SELECT DISTINCT user_category_id FROM transactions WHERE user_id = ? AND user_category_id IS NOT NULL)`,
      userId,
      ...DEMO_CATEGORY_NAMES,
      userId
    );
  });
}
