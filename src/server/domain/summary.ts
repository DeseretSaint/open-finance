import { getDb, type Db } from "@/server/db/adapter";
import { monthBounds } from "@/server/domain/budgets";
import { createBudgetsService } from "@/server/domain/budgets";
import { withAllowlist, type AllowlistCtx } from "@/server/db/allowlist";

/** Dashboard one-call briefing. */
export interface Summary {
  totalBalanceCents: number;
  byType: Record<string, number>;
  monthIncomeCents: number;
  monthExpenseCents: number;
  monthNetCents: number;
  budgetOverview: Array<{ id: string; name: string; spentCents: number; amountCents: number; pct: number }>;
  recentTransactions: Array<{
    id: string;
    accountName: string;
    amountCents: number;
    date: string;
    name: string;
    categoryName: string | null;
    categoryColor: string | null;
  }>;
}

export function createSummaryService(db: Db = getDb()) {
  return {
    /**
     * @param allowlist BYOA account allowlist (null = all accounts). Every
     * account-derived figure flows through withAllowlist — the single choke point.
     */
    async get(
      userId: string,
      referenceDate: string = new Date().toISOString().slice(0, 10),
      allowlist?: AllowlistCtx | null
    ): Promise<Summary> {
      const { start, end } = monthBounds(referenceDate);
      const allowAccounts = withAllowlist(allowlist ?? null, "id");
      const allowTxns = withAllowlist(allowlist ?? null, "a.id");

      const totals = await db.all<{ type: string | null; balance: number }>(
        `SELECT type, COALESCE(SUM(current_balance_cents), 0) AS balance
           FROM accounts WHERE user_id = ?${allowAccounts.clause} GROUP BY type`,
        userId,
        ...allowAccounts.params
      );
      const byType: Record<string, number> = {};
      let totalBalanceCents = 0;
      for (const t of totals) {
        byType[t.type ?? "other"] = t.balance;
        totalBalanceCents += t.balance;
      }

      const month = await db.get<{ income: number; expense: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS expense
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE a.user_id = ? AND t.date >= ? AND t.date < ? AND t.pending = 0 AND t.exclude_from_budgets = 0
            ${allowTxns.clause}`,
        userId,
        start,
        end,
        ...allowTxns.params
      );
      const monthIncomeCents = month?.income ?? 0;
      const monthExpenseCents = month?.expense ?? 0;

      const budgets = await createBudgetsService(db).list(userId, referenceDate);
      const budgetOverview = budgets.map((b) => ({
        id: b.id,
        name: b.name,
        spentCents: b.spentCents,
        amountCents: b.amount_cents,
        pct: b.pct,
      }));

      const recent = await db.all<Summary["recentTransactions"][number]>(
        `SELECT t.id, a.name AS accountName, t.amount_cents AS amountCents, t.date,
                t.name, c.name AS categoryName, c.color AS categoryColor
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.user_category_id
          WHERE a.user_id = ?${allowTxns.clause}
          ORDER BY t.date DESC, t.created_at DESC
          LIMIT 8`,
        userId,
        ...allowTxns.params
      );

      return {
        totalBalanceCents,
        byType,
        monthIncomeCents,
        monthExpenseCents,
        monthNetCents: monthIncomeCents - monthExpenseCents,
        budgetOverview,
        recentTransactions: recent,
      };
    },
  };
}

export type SummaryService = ReturnType<typeof createSummaryService>;
