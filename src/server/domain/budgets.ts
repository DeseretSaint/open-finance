import { randomUUID } from "@/lib/uuid";
import { apiErrors } from "@/lib/api-error";
import { getDb, type Db } from "@/server/db/registry";
import { todayISO, addMonthsISO } from "@/server/domain/dates";

export interface BudgetRow {
  id: string;
  user_id: string;
  name: string;
  amount_cents: number;
  period: string;
  created_at: string;
}

export interface BudgetWithProgress extends BudgetRow {
  categoryIds: string[];
  categoryNames: string[];
  spentCents: number;
  remainingCents: number;
  pct: number; // 0..1+ (over budget > 1)
}

/** View frame for budget progress: a named period or a custom date range. */
export type BudgetFrame =
  | { kind: "period" } // each budget's own period (weekly/monthly/yearly)
  | { kind: "week" }
  | { kind: "month" }
  | { kind: "quarter" }
  | { kind: "year" }
  | { kind: "custom"; start: string; end: string }; // [start, end)

function now(): string {
  return new Date().toISOString();
}

/** Calendar-month bounds for a reference date. */
export function monthBounds(dateISO: string = todayISO()): { start: string; end: string } {
  const start = dateISO.slice(0, 8) + "01";
  const end = addMonthsISO(start, 1); // exclusive upper bound
  return { start, end };
}

/** ISO week start (Monday) for a reference date. */
export function weekBounds(dateISO: string = todayISO()): { start: string; end: string } {
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diffToMonday = (day + 6) % 7; // days back to Monday
  const start = new Date(d);
  start.setDate(d.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Calendar quarter bounds for a reference date. */
export function quarterBounds(dateISO: string = todayISO()): { start: string; end: string } {
  const d = new Date(dateISO + "T00:00:00");
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1);
  const end = new Date(d.getFullYear(), q * 3 + 3, 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Calendar-year bounds for a reference date. */
export function yearBounds(dateISO: string = todayISO()): { start: string; end: string } {
  const d = new Date(dateISO + "T00:00:00");
  const start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d.getFullYear() + 1, 0, 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Bounds for a budget's own period relative to a reference date. */
export function periodBounds(period: string, referenceDate: string = todayISO()): { start: string; end: string } {
  switch (period) {
    case "weekly":
      return weekBounds(referenceDate);
    case "yearly":
      return yearBounds(referenceDate);
    default:
      return monthBounds(referenceDate);
  }
}

/** Bounds for a view frame relative to a reference date. */
export function frameBounds(frame: BudgetFrame, referenceDate: string = todayISO()): { start: string; end: string } {
  switch (frame.kind) {
    case "week":
      return weekBounds(referenceDate);
    case "quarter":
      return quarterBounds(referenceDate);
    case "year":
      return yearBounds(referenceDate);
    case "custom":
      return { start: frame.start, end: frame.end };
    default:
      return monthBounds(referenceDate);
  }
}

export function createBudgetsService(db: Db = getDb()) {
  return {
    /**
     * Budgets with spend/progress for a reference date.
     *
     * `frame` controls the time window:
     *  - "period" (default): each budget is measured over its own period —
     *    weekly budgets over the current week, monthly over the month, etc.
     *  - "week" | "month" | "quarter" | "year": ALL budgets measured over that
     *    single window (a monthly budget viewed quarterly shows the quarter's
     *    spend against its monthly cap — pct can exceed 1).
     *  - custom {start, end}: arbitrary range, same semantics as above.
     */
    async list(
      userId: string,
      referenceDate: string = todayISO(),
      frame: BudgetFrame = { kind: "period" }
    ): Promise<BudgetWithProgress[]> {
      const budgets = await db.all<BudgetRow>(
        "SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at DESC",
        userId
      );
      const result: BudgetWithProgress[] = [];
      for (const b of budgets) {
        const cats = await db.all<{ category_id: string; name: string }>(
          `SELECT bc.category_id, c.name
             FROM budget_categories bc
             JOIN categories c ON c.id = bc.category_id
            WHERE bc.budget_id = ? AND c.enabled = 1`,
          b.id
        );
        const { start, end } =
          frame.kind === "period" ? periodBounds(b.period, referenceDate) : frameBounds(frame, referenceDate);
        const spent = await this.spendCents(userId, b.id, start, end);
        result.push({
          ...b,
          categoryIds: cats.map((c) => c.category_id),
          categoryNames: cats.map((c) => c.name),
          spentCents: spent,
          remainingCents: b.amount_cents - spent,
          pct: b.amount_cents > 0 ? spent / b.amount_cents : spent > 0 ? 1 : 0,
        });
      }
      return result;
    },

    /**
     * Spend for a budget in [start, end): posted, non-excluded expenses on the
     * budget's categories. A budget with no categories tracks "Uncategorized"
     * (user_category_id IS NULL) — the fallback for manual/uncategorized rows.
     */
    async spendCents(userId: string, budgetId: string, start: string, end: string): Promise<number> {
      const budget = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ? AND user_id = ?", budgetId, userId);
      if (!budget) throw apiErrors.notFound("Budget");
      const cats = await db.all<{ category_id: string }>(
        "SELECT category_id FROM budget_categories WHERE budget_id = ?",
        budgetId
      );
      const catIds = cats.map((c) => c.category_id);

      let categoryClause: string;
      const params: unknown[] = [userId, start, end];
      if (catIds.length === 0) {
        categoryClause = "t.user_category_id IS NULL";
      } else {
        categoryClause = `t.user_category_id IN (${catIds.map(() => "?").join(", ")})`;
        params.push(...catIds);
      }

      const row = await db.get<{ s: number }>(
        `SELECT COALESCE(SUM(-t.amount_cents), 0) AS s
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = ? AND a.deleted_at IS NULL AND t.date >= ? AND t.date < ?
           AND t.pending = 0 AND t.exclude_from_budgets = 0 AND t.amount_cents < 0
           AND ${categoryClause}`,
        ...params
      );
      return row?.s ?? 0;
    },

    async create(
      userId: string,
      input: { name: string; amountCents: number; period?: string; categoryIds?: string[] }
    ): Promise<BudgetRow> {
      const period = input.period ?? "monthly";
      if (!["weekly", "monthly", "yearly"].includes(period)) {
        throw apiErrors.badRequest("period must be weekly, monthly, or yearly");
      }
      if (!input.name.trim()) throw apiErrors.badRequest("name is required");
      if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
        throw apiErrors.badRequest("amountCents must be a positive number");
      }
      const id = randomUUID();
      await db.run(
        "INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        userId,
        input.name.trim(),
        input.amountCents,
        period,
        now()
      );
      for (const catId of input.categoryIds ?? []) {
        await db.run(
          "INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)",
          id,
          catId
        );
      }
      const row = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ?", id);
      if (!row) throw apiErrors.internal();
      return row;
    },

    async update(
      userId: string,
      id: string,
      input: { name?: string; amountCents?: number; period?: string; categoryIds?: string[] }
    ): Promise<BudgetRow> {
      const existing = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ? AND user_id = ?", id, userId);
      if (!existing) throw apiErrors.notFound("Budget");
      const name = input.name?.trim() ?? existing.name;
      if (!name) throw apiErrors.badRequest("name cannot be empty");
      const amountCents = input.amountCents ?? existing.amount_cents;
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw apiErrors.badRequest("amountCents must be a positive number");
      }
      const period = input.period ?? existing.period;
      if (!["weekly", "monthly", "yearly"].includes(period)) {
        throw apiErrors.badRequest("period must be weekly, monthly, or yearly");
      }
      await db.run(
        "UPDATE budgets SET name = ?, amount_cents = ?, period = ? WHERE id = ?",
        name,
        amountCents,
        period,
        id
      );
      if (input.categoryIds) {
        await db.run("DELETE FROM budget_categories WHERE budget_id = ?", id);
        for (const catId of input.categoryIds) {
          await db.run("INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)", id, catId);
        }
      }
      const row = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ?", id);
      if (!row) throw apiErrors.internal();
      return row;
    },

    async remove(userId: string, id: string): Promise<void> {
      const existing = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ? AND user_id = ?", id, userId);
      if (!existing) throw apiErrors.notFound("Budget");
      await db.run("DELETE FROM budget_categories WHERE budget_id = ?", id);
      await db.run("DELETE FROM budgets WHERE id = ?", id);
    },
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
