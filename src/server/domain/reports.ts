import { getDb, type Db } from "@/server/db/registry";
import { addMonthsISO, todayISO } from "@/server/domain/dates";
import { withAllowlist, type AllowlistCtx } from "@/server/db/allowlist";

/**
 * Reports — aggregates derived from transactions. Every query is user-scoped
 * through accounts.user_id and, for agent calls, flows through withAllowlist.
 * Amount convention: positive = expense, negative = income.
 */
export function createReportsService(db: Db = getDb()) {
  return {
    async spendingByCategory(
      userId: string,
      from: string,
      to: string,
      allowlist?: AllowlistCtx | null
    ): Promise<Array<{ categoryId: string | null; categoryName: string; color: string | null; spentCents: number }>> {
      const allow = withAllowlist(allowlist ?? null, "a.id");
      return db.all(
        `SELECT t.user_category_id AS categoryId, COALESCE(c.name, 'Uncategorized') AS categoryName,
                c.color AS color, COALESCE(SUM(-t.amount_cents), 0) AS spentCents
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
          LEFT JOIN categories c ON c.id = t.user_category_id
         WHERE a.user_id = ? AND t.date >= ? AND t.date < ?
           AND t.pending = 0 AND t.exclude_from_budgets = 0 AND t.amount_cents < 0
            ${allow.clause}
          GROUP BY t.user_category_id, c.name, c.color
          ORDER BY spentCents DESC`,
        userId,
        from,
        to,
        ...allow.params
      );
    },

    /** One row per month (oldest → newest) for the last `months` calendar months. */
    async cashflow(userId: string, months: number, allowlist?: AllowlistCtx | null): Promise<Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }>> {
      const allow = withAllowlist(allowlist ?? null, "a.id");
      const end = addMonthsISO(todayISO().slice(0, 8) + "01", 1);
      const rows = await db.all<{ month: string; incomeCents: number; expenseCents: number }>(
        `SELECT substr(t.date, 1, 7) AS month,
                SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END) AS incomeCents,
                SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END) AS expenseCents
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = ? AND t.date < ? AND t.pending = 0 AND t.exclude_from_budgets = 0
           ${allow.clause}
         GROUP BY substr(t.date, 1, 7)
         ORDER BY month ASC`,
        userId,
        end,
        ...allow.params
      );
      // Fill missing months with zeroes.
      const byMonth = new Map(rows.map((r) => [r.month, r]));
      const out: Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }> = [];
      for (let i = months - 1; i >= 0; i--) {
        const month = addMonthsISO(end, -(i + 1)).slice(0, 7);
        const r = byMonth.get(month);
        const income = r?.incomeCents ?? 0;
        const expense = r?.expenseCents ?? 0;
        out.push({ month, incomeCents: income, expenseCents: expense, netCents: income - expense });
      }
      return out;
    },

    async netWorth(userId: string, allowlist?: AllowlistCtx | null): Promise<{
      assetsCents: number;
      liabilitiesCents: number;
      netCents: number;
      byType: Record<string, number>;
    }> {
      const allow = withAllowlist(allowlist ?? null, "id");
      const rows = await db.all<{ type: string | null; balance: number }>(
        `SELECT type, COALESCE(SUM(current_balance_cents), 0) AS balance
           FROM accounts WHERE user_id = ?${allow.clause} GROUP BY type`,
        userId,
        ...allow.params
      );
      let assets = 0;
      let liabilities = 0;
      const byType: Record<string, number> = {};
      for (const r of rows) {
        const t = r.type ?? "other";
        byType[t] = r.balance;
        if (t === "depository" || t === "investment") assets += r.balance;
        else if (t === "credit" || t === "loan") liabilities += r.balance;
      }
      // credit/loan balances are stored negative (owed); liabilities shown positive.
      const liabilityTotal = -liabilities;
      return {
        assetsCents: assets,
        liabilitiesCents: liabilityTotal > 0 ? liabilityTotal : 0,
        netCents: assets + liabilities,
        byType,
      };
    },

    /** Monthly total expenses for the last `months` months (for spending trend chart). */
    async spendingTrend(userId: string, months: number, allowlist?: AllowlistCtx | null): Promise<Array<{ month: string; spentCents: number }>> {
      const flow = await this.cashflow(userId, months, allowlist);
      return flow.map((f) => ({ month: f.month, spentCents: f.expenseCents }));
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
