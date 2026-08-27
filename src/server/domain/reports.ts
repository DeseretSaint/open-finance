import { getDb, type Db } from "@/server/db/registry";
import { addDaysISO, addMonthsISO, todayISO } from "@/server/domain/dates";
import { withAllowlist, type AllowlistCtx } from "@/server/db/allowlist";
import { markLinkedTransfers } from "@/server/domain/transfers";

/**
 * Reports — aggregates derived from transactions. Every query is user-scoped
 * through accounts.user_id and, for agent calls, flows through withAllowlist.
 * Amount convention: positive = income, negative = expense.
 */
export function createReportsService(db: Db = getDb()) {
  return {
    async spendingByCategory(
      userId: string,
      from: string,
      to: string,
      allowlist?: AllowlistCtx | null,
      includeExcluded = false,
      includePending = true
    ): Promise<Array<{ categoryId: string | null; categoryName: string; color: string | null; spentCents: number }>> {
      await markLinkedTransfers(db, userId);
      const allow = withAllowlist(allowlist ?? null, "a.id");
      const accountHistoryClause = includeExcluded ? "" : " AND a.deleted_at IS NULL";
      const pendingClause = includePending ? "" : " AND t.pending = 0";
      return db.all(
        `SELECT t.user_category_id AS categoryId, COALESCE(c.name, 'Uncategorized') AS categoryName,
                c.color AS color, COALESCE(SUM(-t.amount_cents), 0) AS spentCents
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
          LEFT JOIN categories c ON c.id = t.user_category_id
         WHERE a.user_id = ?${accountHistoryClause} AND t.date >= ? AND t.date < ?
           AND t.exclude_from_budgets = 0 AND t.is_transfer = 0 AND t.amount_cents < 0${pendingClause}
            ${allow.clause}
          GROUP BY t.user_category_id, c.name, c.color
          ORDER BY spentCents DESC`,
        userId,
        from,
        to,
        ...allow.params
      );
    },

    /** One row per month (oldest → newest) for a bounded calendar window. */
    async cashflow(userId: string, months: number, allowlist?: AllowlistCtx | null, from?: string, to?: string, includeExcluded = false, includePending = true): Promise<Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }>> {
      await markLinkedTransfers(db, userId);
      const allow = withAllowlist(allowlist ?? null, "a.id");
      const accountHistoryClause = includeExcluded ? "" : " AND a.deleted_at IS NULL";
      const pendingClause = includePending ? "" : " AND t.pending = 0";
      const end = to ?? addMonthsISO(todayISO().slice(0, 8) + "01", 1);
      const start = from ?? addMonthsISO(end, -months);
      const rows = await db.all<{ month: string; incomeCents: number; expenseCents: number }>(
        `SELECT substr(t.date, 1, 7) AS month,
                SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END) AS incomeCents,
                SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END) AS expenseCents
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = ?${accountHistoryClause} AND t.date >= ? AND t.date < ? AND t.exclude_from_budgets = 0 AND t.is_transfer = 0${pendingClause}
           ${allow.clause}
         GROUP BY substr(t.date, 1, 7)
         ORDER BY month ASC`,
        userId,
        start,
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

    async netWorth(userId: string, allowlist?: AllowlistCtx | null, includeExcluded = false, includePending = true): Promise<{
      assetsCents: number;
      liabilitiesCents: number;
      netCents: number;
      byType: Record<string, number>;
    }> {
      const allow = withAllowlist(allowlist ?? null, "id");
      const accountHistoryClause = includeExcluded ? "" : " AND deleted_at IS NULL";
      const pendingClause = includePending
        ? " + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = accounts.id AND t.pending = 1 AND t.exclude_from_budgets = 0 AND t.is_transfer = 0), 0)"
        : "";
      const rows = await db.all<{ type: string | null; balance: number }>(
        `SELECT type,
                  COALESCE(SUM(CASE WHEN type IN ('credit', 'loan') THEN -ABS(COALESCE(current_balance_cents, 0))
                                   ELSE COALESCE(current_balance_cents, 0) END${pendingClause}), 0) AS balance
          FROM accounts WHERE user_id = ? AND hidden = 0${accountHistoryClause} AND include_in_net_worth = 1${allow.clause} GROUP BY type`,
        userId,
        ...allow.params
      );
      let assets = 0;
      let liabilities = 0;
      const byType: Record<string, number> = {};
      for (const r of rows) {
        const t = r.type ?? "other";
        // Accumulate: NULL-type and 'other'-type rows are distinct GROUP BY
        // groups that both map to the "other" bucket.
        byType[t] = (byType[t] ?? 0) + r.balance;
        // credit/loan are liabilities; every other type (depository, investment,
        // 'other', NULL) counts as an asset — matches the SQL ELSE branch above
        // and summary.totalBalanceCents, so dashboard total = reports net worth.
        if (t === "credit" || t === "loan") liabilities += r.balance;
        else assets += r.balance;
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

    /**
     * Net-worth time series from balance_history (one point per account per day,
     * written by Plaid sync / solo sync / manual + demo seed). Produces one row
     * per calendar day across the last `months` months ending today; accounts
     * missing a day carry forward their last known balance. Credit/loan points are
     * stored negative in balance_history, so they land in liabilities automatically.
     * Only include_in_net_worth=1 & non-hidden accounts are summed (deleted excluded
     * unless includeExcluded). Returns [] when the user has no history yet.
     */
    async netWorthTrend(
      userId: string,
      months: number,
      allowlist?: AllowlistCtx | null,
      includeExcluded = false
    ): Promise<Array<{ date: string; netCents: number; assetsCents: number; liabilitiesCents: number }>> {
      const allow = withAllowlist(allowlist ?? null, "a.id");
      const accountHistoryClause = includeExcluded ? "" : " AND a.deleted_at IS NULL";
      const rows = await db.all<{ account_id: string; type: string | null; date: string; balance_cents: number }>(
        `SELECT bh.account_id AS account_id, a.type AS type, bh.date AS date, bh.balance_cents AS balance_cents
           FROM balance_history bh
           JOIN accounts a ON a.id = bh.account_id
          WHERE a.user_id = ? AND a.hidden = 0 AND a.include_in_net_worth = 1${accountHistoryClause}${allow.clause}`,
        userId,
        ...allow.params
      );
      // Group per account, sorted ascending by date.
      const byAccount = new Map<string, Array<{ date: string; balance: number; isLiab: boolean }>>();
      for (const r of rows) {
        const isLiab = r.type === "credit" || r.type === "loan";
        const arr = byAccount.get(r.account_id) ?? [];
        arr.push({ date: r.date, balance: r.balance_cents, isLiab });
        byAccount.set(r.account_id, arr);
      }
      for (const arr of byAccount.values()) arr.sort((x, y) => (x.date < y.date ? -1 : 1));

      const end = todayISO();
      const start = addMonthsISO(end.slice(0, 8) + "01", -months);
      const out: Array<{ date: string; netCents: number; assetsCents: number; liabilitiesCents: number }> = [];
      for (let d = start; d <= end; d = addDaysISO(d, 1)) {
        let assets = 0;
        let liabilities = 0;
        let known = false;
        for (const arr of byAccount.values()) {
          // last point on or before d (carry-forward)
          let bal: number | null = null;
          for (const p of arr) {
            if (p.date <= d) bal = p.balance;
            else break;
          }
          if (bal == null) continue; // account not yet open on this day
          known = true;
          if (arr[0]?.isLiab) liabilities += -bal; // stored negative → positive owed
          else assets += bal;
        }
        if (!known) continue; // no history yet → no point
        out.push({ date: d, netCents: assets - liabilities, assetsCents: assets, liabilitiesCents: liabilities });
      }
      return out;
    },

    /** Monthly total expenses for the last `months` months (for spending trend chart). */
    async spendingTrend(userId: string, months: number, allowlist?: AllowlistCtx | null, includePending = true): Promise<Array<{ month: string; spentCents: number }>> {
      const flow = await this.cashflow(userId, months, allowlist, undefined, undefined, false, includePending);
      return flow.map((f) => ({ month: f.month, spentCents: f.expenseCents }));
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
