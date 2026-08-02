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

function now(): string {
  return new Date().toISOString();
}

/** Calendar-month bounds for a reference date. */
export function monthBounds(dateISO: string = todayISO()): { start: string; end: string } {
  const start = dateISO.slice(0, 8) + "01";
  const end = addMonthsISO(start, 1); // exclusive upper bound
  return { start, end };
}

export function createBudgetsService(db: Db = getDb()) {
  return {
    async list(userId: string, referenceDate: string = todayISO()): Promise<BudgetWithProgress[]> {
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
            WHERE bc.budget_id = ?`,
          b.id
        );
        const { start, end } = monthBounds(referenceDate);
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
         WHERE a.user_id = ? AND t.date >= ? AND t.date < ?
           AND t.pending = 0 AND t.exclude_from_budgets = 0 AND t.amount_cents < 0
           AND ${categoryClause}`,
        ...params
      );
      return row?.s ?? 0;
    },

    async create(
      userId: string,
      input: { name: string; amountCents: number; period?: string; categoryIds?: string[] }
    ): Promise<BudgetWithProgress> {
      const name = input.name.trim().slice(0, 60);
      if (!name) throw apiErrors.badRequest("Budget name cannot be empty.");
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw apiErrors.badRequest("Budget amount must be a positive whole number of cents.");
      }
      const period = input.period ?? "monthly";
      if (!["weekly", "monthly", "yearly"].includes(period)) {
        throw apiErrors.badRequest("Period must be weekly, monthly, or yearly.");
      }
      const id = randomUUID();
      await db.transaction(async () => {
        await db.run(
          "INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          id,
          userId,
          name,
          input.amountCents,
          period,
          now()
        );
        for (const catId of input.categoryIds ?? []) {
          const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ?", catId, userId);
          if (!cat) throw apiErrors.badRequest("One of the selected categories does not exist.");
          await db.run(
            "INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)",
            id,
            catId
          );
        }
      });
      const list = await this.list(userId);
      return list.find((b) => b.id === id) as BudgetWithProgress;
    },

    async update(
      userId: string,
      id: string,
      input: { name?: string; amountCents?: number; period?: string; categoryIds?: string[] }
    ): Promise<BudgetWithProgress> {
      const existing = await db.get<BudgetRow>("SELECT * FROM budgets WHERE id = ? AND user_id = ?", id, userId);
      if (!existing) throw apiErrors.notFound("Budget");
      const name = input.name !== undefined ? input.name.trim().slice(0, 60) : existing.name;
      if (!name) throw apiErrors.badRequest("Budget name cannot be empty.");
      const amount = input.amountCents !== undefined ? input.amountCents : existing.amount_cents;
      if (!Number.isInteger(amount) || amount <= 0) throw apiErrors.badRequest("Budget amount must be positive cents.");
      const period = input.period ?? existing.period;

      await db.transaction(async () => {
        await db.run(
          "UPDATE budgets SET name = ?, amount_cents = ?, period = ? WHERE id = ?",
          name,
          amount,
          period,
          id
        );
        if (input.categoryIds !== undefined) {
          for (const catId of input.categoryIds) {
            const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ?", catId, userId);
            if (!cat) throw apiErrors.badRequest("One of the selected categories does not exist.");
          }
          await db.run("DELETE FROM budget_categories WHERE budget_id = ?", id);
          for (const catId of input.categoryIds) {
            await db.run("INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)", id, catId);
          }
        }
      });
      const list = await this.list(userId);
      return list.find((b) => b.id === id) as BudgetWithProgress;
    },

    async remove(userId: string, id: string): Promise<void> {
      await db.transaction(async () => {
        await db.run("DELETE FROM budget_categories WHERE budget_id = ?", id);
        await db.run("DELETE FROM budgets WHERE id = ? AND user_id = ?", id, userId);
      });
    },
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
