import { createCategoriesService } from "./categories";
import { createTransactionsService } from "./transactions";
import type { Db } from "@/server/db/types";

/**
 * App-side smart categorization ("Apply" on the backlog): assigns a user
 * category to every uncategorized transaction whose Plaid category path /
 * personal-finance category matches one of the user's category patterns
 * (longest-pattern match, same logic the agent's set_transaction_category
 * would use). Gray-area transactions (no match) are left alone.
 *
 * backlogMonths 0 = moving-forward mode: no history window, categorize what
 * has come in so far. Otherwise only transactions within the window.
 */
export async function autoCategorize(
  db: Db,
  userId: string,
  backlogMonths: number
): Promise<{ categorized: number; remaining: number; backlogMonths: number }> {
  const txns = createTransactionsService(db);
  const cats = createCategoriesService(db);

  const filters: { categoryId: null; from?: string; limit: number; offset: number } = {
    categoryId: null,
    limit: 500,
    offset: 0,
  };
  if (backlogMonths > 0) {
    const since = new Date();
    since.setMonth(since.getMonth() - backlogMonths);
    filters.from = since.toISOString().slice(0, 10);
  }
  const { rows } = await txns.list(userId, filters);
  const uncategorized = rows.filter((t) => !t.user_category_id);

  let categorized = 0;
  for (const t of uncategorized) {
    const match = await cats.match(userId, t.category_path, t.personal_finance_category);
    if (match) {
      await txns.update(userId, t.id, { userCategoryId: match.id });
      categorized++;
    }
  }
  return { categorized, remaining: uncategorized.length - categorized, backlogMonths };
}
