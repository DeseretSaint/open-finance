import { getDb, type Db } from "@/server/db/registry";
import { addMonthsISO, monthlyEquivalent, monthsBetween, todayISO } from "@/server/domain/dates";
import { createPlanningService } from "@/server/domain/planning";

/**
 * 12-month projection per master plan §8.
 *
 * baseline = current total balance · income = avg of last 3 full months inflows
 * (category "Income") · bills = monthly equivalents (variable bills use last
 * paid amount; one-time bills land on their date) · debts = min payment monthly
 * · goals = (target−current)÷months when target+date set, capped and toggleable.
 *
 * Flags: danger when projected balance < 0; warning when balance < 1 month of
 * average expenses. Emergency-fund insight = 3× average monthly expenses.
 * Always labeled `estimate: true, assumes: "all things constant"`.
 */

export interface ProjectionPoint {
  month: string; // YYYY-MM
  balanceCents: number;
  flag: "danger" | "warning" | "ok";
}

export interface Projection {
  estimate: true;
  assumes: "all things constant";
  months: number;
  baselineCents: number;
  monthlyIncomeCents: number;
  monthlyBillsCents: number;
  monthlyDebtCents: number;
  monthlyGoalCents: number;
  avgMonthlyExpensesCents: number;
  emergencyFund: { recommendedCents: number; monthsCovered: number | null };
  points: ProjectionPoint[];
  dangerMonths: string[];
  warningMonths: string[];
}

export function createProjectionService(db: Db = getDb()) {
  return {
    /**
     * @param months how many months to project (default 12)
     * @param includeGoals include auto-contribution toward dated goals (default true, toggleable)
     */
    async project(userId: string, months = 12, includeGoals = true): Promise<Projection> {
      const today = todayISO();
      const currentMonthStart = today.slice(0, 8) + "01";
      const planning = createPlanningService(db);

      // Baseline: current total balance across all accounts (allowlist-aware from P7).
      const total = await db.get<{ s: number }>(
        "SELECT COALESCE(SUM(CASE WHEN type IN ('credit', 'loan') THEN -ABS(COALESCE(current_balance_cents, 0)) ELSE COALESCE(current_balance_cents, 0) END), 0) AS s FROM accounts WHERE user_id = ? AND hidden = 0 AND deleted_at IS NULL AND include_in_net_worth = 1",
        userId
      );
      const baselineCents = total?.s ?? 0;

      // Income: average of the last 3 FULL months' inflows in the "Income" category.
      const incomeRanges: Array<{ start: string; end: string }> = [];
      for (let i = 1; i <= 3; i++) {
        const start = addMonthsISO(currentMonthStart, -i);
        incomeRanges.push({ start, end: addMonthsISO(start, 1) });
      }
      let incomeSum = 0;
      for (const r of incomeRanges) {
        const row = await db.get<{ s: number }>(
          `SELECT COALESCE(SUM(t.amount_cents), 0) AS s
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             LEFT JOIN categories c ON c.id = t.user_category_id
            WHERE a.user_id = ? AND a.deleted_at IS NULL AND t.is_transfer = 0 AND t.amount_cents > 0 AND t.date >= ? AND t.date < ?
              AND t.pending = 0 AND c.name = 'Income'`,
          userId,
          r.start,
          r.end
        );
        incomeSum += row?.s ?? 0;
      }
      const monthlyIncomeCents = Math.round(incomeSum / 3);

      // Bills: monthly equivalents; variable bills use last paid amount; inactive skipped.
      const bills = await planning.listBills(userId);
      let monthlyBillsCents = 0;
      const oneTimeBills: Array<{ date: string; amountCents: number }> = [];
      for (const b of bills) {
        if (!b.active) continue;
        const amount = b.last_paid_amount_cents ?? b.amount_cents;
        if (b.frequency === "one-time") {
          if (b.next_due_date) oneTimeBills.push({ date: b.next_due_date, amountCents: amount });
          continue;
        }
        monthlyBillsCents += Math.round(amount * monthlyEquivalent(b.frequency));
      }

      // Debts: minimum payment each month (0 if none set).
      const debts = await planning.listDebts(userId);
      const monthlyDebtCents = debts.reduce((s, d) => s + d.min_payment_cents, 0);

      // Goals: dated + below target → (target−current)÷months, capped at the
      // remaining monthly surplus, toggleable.
      let monthlyGoalCents = 0;
      if (includeGoals) {
        const surplus = Math.max(0, monthlyIncomeCents - monthlyBillsCents - monthlyDebtCents);
        const goals = await planning.listGoals(userId);
        for (const g of goals) {
          if (!g.target_date || g.current_cents >= g.target_cents) continue;
          const monthsLeft = Math.max(0, monthsBetween(today, g.target_date));
          if (monthsLeft <= 0) continue;
          const needed = Math.ceil((g.target_cents - g.current_cents) / monthsLeft);
          monthlyGoalCents += Math.min(needed, surplus);
        }
      }

      const avgMonthlyExpensesCents = monthlyBillsCents + monthlyDebtCents + monthlyGoalCents;
      const emergencyFundRecommended = avgMonthlyExpensesCents * 3;
      const monthsCovered = avgMonthlyExpensesCents > 0 ? Math.round(baselineCents / avgMonthlyExpensesCents) : null;

      // Month-over-month projection.
      const points: ProjectionPoint[] = [];
      const dangerMonths: string[] = [];
      const warningMonths: string[] = [];
      let balance = baselineCents;
      for (let i = 1; i <= months; i++) {
        const month = addMonthsISO(currentMonthStart, i).slice(0, 7);
        let outflow = monthlyBillsCents + monthlyDebtCents + monthlyGoalCents;
        // one-time bills land on their exact month
        for (const ot of oneTimeBills) {
          if (ot.date.startsWith(month)) outflow += ot.amountCents;
        }
        balance = balance + monthlyIncomeCents - outflow;
        const flag: ProjectionPoint["flag"] = balance < 0 ? "danger" : balance < avgMonthlyExpensesCents ? "warning" : "ok";
        points.push({ month, balanceCents: balance, flag });
        if (flag === "danger") dangerMonths.push(month);
        else if (flag === "warning") warningMonths.push(month);
      }

      return {
        estimate: true,
        assumes: "all things constant",
        months,
        baselineCents,
        monthlyIncomeCents,
        monthlyBillsCents,
        monthlyDebtCents,
        monthlyGoalCents,
        avgMonthlyExpensesCents,
        emergencyFund: { recommendedCents: emergencyFundRecommended, monthsCovered },
        points,
        dangerMonths,
        warningMonths,
      };
    },
  };
}

export type ProjectionService = ReturnType<typeof createProjectionService>;
