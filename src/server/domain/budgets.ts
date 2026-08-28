import { randomUUID } from "@/lib/uuid";
import { apiErrors } from "@/lib/api-error";
import { getDb, type Db } from "@/server/db/registry";
import { todayISO, addMonthsISO } from "@/server/domain/dates";
import type { TransactionRow } from "@/server/domain/transactions";

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
  /** The budget's limit, prorated to the requested view frame when frame ≠ "period". Equals amount_cents for "period". */
  frameAmountCents: number;
  pct: number; // 0..1+ (over budget > 1), against frameAmountCents
}

/** View frame for budget progress: a named period or a custom date range. */
export type BudgetFrame =
  | { kind: "period" } // each budget's own period (weekly/monthly/yearly)
  | { kind: "week" }
  | { kind: "month" }
  | { kind: "quarter" }
  | { kind: "year" }
  | { kind: "30d" } // rolling past 30 days
  | { kind: "custom"; start: string; end: string }; // [start, end)

function now(): string {
  return new Date().toISOString();
}

/** Whole-day count in [start, end) (exclusive end), used to prorate limits. */
function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end + "T00:00:00").getTime();
  return Math.max(0, Math.round((e - s) / (24 * 3600 * 1000)));
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

/** Rolling past-30-days bounds for a reference date (exclusive end = reference day). */
export function last30DaysBounds(referenceDate: string = todayISO()): { start: string; end: string } {
  const d = new Date(referenceDate + "T00:00:00");
  const start = new Date(d);
  start.setDate(d.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: new Date(d.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10) };
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
    case "30d":
      return last30DaysBounds(referenceDate);
    case "custom":
      return { start: frame.start, end: frame.end };
    default:
      return monthBounds(referenceDate);
  }
}

/** Shared WHERE-clause for a budget's expense rows (used by spendCents + transactions). */
async function spendFilter(
  db: Db,
  userId: string,
  budgetId: string,
  start: string,
  end: string,
  includePending: boolean
): Promise<{ clause: string; params: unknown[] }> {
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

  const pendingClause = includePending ? "" : " AND t.pending = 0";
  return {
    clause: `a.user_id = ? AND a.deleted_at IS NULL AND t.date >= ? AND t.date < ?
             AND t.exclude_from_budgets = 0 AND t.is_transfer = 0 AND t.amount_cents < 0${pendingClause}
             AND ${categoryClause}`,
    params,
  };
}

/** Reject category ids that are not the user's own categories. Without this,
 *  budget_categories rows dangle (SQLite FKs are unenforced) and the list JOIN
 *  leaks another user's category names into this budget. Also dedupes — the
 *  (budget_id, category_id) PK makes duplicate ids a hard insert error. */
async function assertOwnCategories(db: Db, userId: string, categoryIds: string[]): Promise<string[]> {
  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return ids;
  const found = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM categories WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    userId,
    ...ids
  );
  if ((found?.n ?? 0) !== ids.length) {
    throw apiErrors.badRequest("One or more categories do not exist.");
  }
  return ids;
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
      frame: BudgetFrame = { kind: "period" },
      includePending = true
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
        const periodWindow = periodBounds(b.period, referenceDate);
        const { start, end } =
          frame.kind === "period" ? periodWindow : frameBounds(frame, referenceDate);
        const spent = await this.spendCents(userId, b.id, start, end, includePending);
        // When viewing a frame other than the budget's own period, prorate the
        // limit to that window so "spent vs limit" is honest (a monthly budget
        // viewed over a week shouldn't show a $500 limit with $20 spent as if
        // you're on track). frame = "period" keeps the full period limit.
        let frameAmountCents = b.amount_cents;
        if (frame.kind !== "period") {
          const periodDays = daysBetween(periodWindow.start, periodWindow.end);
          const frameDays = daysBetween(start, end);
          if (periodDays > 0) {
            frameAmountCents = Math.round((b.amount_cents * frameDays) / periodDays);
          }
        }
        result.push({
          ...b,
          categoryIds: cats.map((c) => c.category_id),
          categoryNames: cats.map((c) => c.name),
          spentCents: spent,
          frameAmountCents,
          remainingCents: frameAmountCents - spent,
          pct: frameAmountCents > 0 ? spent / frameAmountCents : spent > 0 ? 1 : 0,
        });
      }
      return result;
    },

    /**
     * Spend for a budget in [start, end): posted, non-excluded expenses on the
     * budget's categories. A budget with no categories tracks "Uncategorized"
     * (user_category_id IS NULL) — the fallback for manual/uncategorized rows.
     */
    async spendCents(userId: string, budgetId: string, start: string, end: string, includePending = true): Promise<number> {
      const { clause, params } = await spendFilter(db, userId, budgetId, start, end, includePending);
      const row = await db.get<{ s: number }>(
        `SELECT COALESCE(SUM(-t.amount_cents), 0) AS s
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
         WHERE ${clause}`,
        ...params
      );
      return row?.s ?? 0;
    },

    /**
     * The actual transactions behind a budget's spend — same filter as
     * spendCents, but returns the rows so the UI can show "where the money
     * went" when a budget card is expanded.
     */
    async transactions(
      userId: string,
      budgetId: string,
      referenceDate: string = todayISO(),
      frame: BudgetFrame = { kind: "period" },
      includePending = true
    ): Promise<TransactionRow[]> {
      const budget = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ? AND user_id = ?", budgetId, userId);
      if (!budget) throw apiErrors.notFound("Budget");
      const { start, end } =
        frame.kind === "period" ? periodBounds(budget.period, referenceDate) : frameBounds(frame, referenceDate);
      const { clause, params } = await spendFilter(db, userId, budgetId, start, end, includePending);
      return db.all<TransactionRow>(
        `SELECT t.*, a.name AS account_name, c.name AS category_name, c.color AS category_color
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.user_category_id
          WHERE ${clause}
          ORDER BY t.date DESC, t.created_at DESC
          LIMIT 100`,
        ...params
      );
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
      const categoryIds = await assertOwnCategories(db, userId, input.categoryIds ?? []);
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
      for (const catId of categoryIds) {
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
      // Validate BEFORE touching budget_categories so a bad id can't wipe the
      // existing category set mid-flight.
      const categoryIds = input.categoryIds
        ? await assertOwnCategories(db, userId, input.categoryIds)
        : null;
      await db.run(
        "UPDATE budgets SET name = ?, amount_cents = ?, period = ? WHERE id = ?",
        name,
        amountCents,
        period,
        id
      );
      if (categoryIds) {
        await db.run("DELETE FROM budget_categories WHERE budget_id = ?", id);
        for (const catId of categoryIds) {
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
