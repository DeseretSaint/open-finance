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
export interface CategorizeResult {
  /** Transactions that already had a user category (skipped). */
  alreadyCategorized: number;
  /** Uncategorized transactions within the window that we confidently matched. */
  categorized: number;
  /** Uncategorized transactions we left for the agent (no confident match). */
  leftForAgent: number;
  /** Total uncategorized in the window (categorized + leftForAgent). */
  totalUncategorized: number;
  /** Total transactions in the window (alreadyCategorized + totalUncategorized). The progress denominator. */
  total: number;
  /** Categorized + alreadyCategorized — i.e. how many are properly assigned when done. */
  done: number;
  backlogMonths: number;
}

/**
 * App-side smart categorization ("Apply" on the backlog): assigns a user
 * category to every uncategorized transaction whose Plaid category path /
 * personal-finance category matches one of the user's category patterns
 * (longest-pattern match, same logic the agent's set_transaction_category
 * would use). Gray-area transactions (no match) are left alone.
 *
 * backlogMonths 0 = moving-forward mode: no history window, categorize what
 * has come in so far. Otherwise only transactions within the window.
 *
 * Returns a status breakdown (categorized vs total) so the UI can render a
 * progress bar.
 */
export async function autoCategorize(
  db: Db,
  userId: string,
  backlogMonths: number
): Promise<CategorizeResult> {
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
  const alreadyCategorized = rows.length - uncategorized.length;

  let categorized = 0;
  let leftForAgent = 0;
  for (const t of uncategorized) {
    const match = await cats.match(userId, t.category_path, t.personal_finance_category);
    if (match) {
      await txns.update(userId, t.id, { userCategoryId: match.id });
      categorized++;
    } else {
      leftForAgent++;
    }
  }
  const total = rows.length;
  const done = alreadyCategorized + categorized;
  return {
    alreadyCategorized,
    categorized,
    leftForAgent,
    totalUncategorized: uncategorized.length,
    total,
    done,
    backlogMonths,
  };
}
