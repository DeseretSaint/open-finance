import { randomUUID } from "@/lib/uuid";
import { apiErrors } from "@/lib/api-error";
import { getDb, type Db } from "@/server/db/registry";

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  plaid_paths: string | null;
  is_system: number;
  enabled: number;
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

const SYSTEM_COLORS = [
  "#10B981", "#6366F1", "#F59E0B", "#EF4444", "#8B5CF6",
  "#06B6D4", "#84CC16", "#EC4899", "#F97316", "#14B8A6",
];

export function createCategoriesService(db: Db = getDb()) {
  return {
    async list(userId: string): Promise<CategoryRow[]> {
      return db.all<CategoryRow>(
        "SELECT * FROM categories WHERE user_id = ? AND enabled = 1 ORDER BY name COLLATE NOCASE",
        userId
      );
    },

    async listAll(userId: string): Promise<CategoryRow[]> {
      return db.all<CategoryRow>(
        "SELECT * FROM categories WHERE user_id = ? ORDER BY enabled DESC, name COLLATE NOCASE",
        userId
      );
    },

    async get(userId: string, id: string): Promise<CategoryRow> {
      const row = await db.get<CategoryRow>("SELECT * FROM categories WHERE id = ? AND user_id = ?", id, userId);
      if (!row) throw apiErrors.notFound("Category");
      return row;
    },

    async create(
      userId: string,
      input: { name: string; color?: string | null; plaidPaths?: string | null }
    ): Promise<CategoryRow> {
      const name = input.name.trim().slice(0, 50);
      if (!name) throw apiErrors.badRequest("Category name cannot be empty.");
      const existing = await db.get("SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE", userId, name);
      if (existing) throw apiErrors.conflict("A category with that name already exists.");
      const id = randomUUID();
      await db.run(
        "INSERT INTO categories (id, user_id, name, color, plaid_paths, is_system, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
        id,
        userId,
        name,
        input.color?.trim() || null,
        input.plaidPaths?.trim() || null,
        now()
      );
      return this.get(userId, id);
    },

    async update(
      userId: string,
      id: string,
      input: { name?: string; color?: string | null; plaidPaths?: string | null; enabled?: boolean }
    ): Promise<CategoryRow> {
      const row = await db.get<CategoryRow>("SELECT * FROM categories WHERE id = ? AND user_id = ?", id, userId);
      if (!row) throw apiErrors.notFound("Category");
      const name = input.name !== undefined ? input.name.trim().slice(0, 50) : row.name;
      if (!name) throw apiErrors.badRequest("Category name cannot be empty.");
      const dup = await db.get(
        "SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?",
        userId,
        name,
        id
      );
      if (dup) throw apiErrors.conflict("A category with that name already exists.");
      await db.run(
        "UPDATE categories SET name = ?, color = ?, plaid_paths = ?, enabled = ? WHERE id = ?",
        name,
        input.color !== undefined ? input.color?.trim() || null : row.color,
        input.plaidPaths !== undefined ? input.plaidPaths?.trim() || null : row.plaid_paths,
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : row.enabled,
        id
      );
      return this.get(userId, id);
    },

    async remove(userId: string, id: string): Promise<void> {
      const row = await this.get(userId, id);
      if (row.is_system) throw apiErrors.forbidden("System categories cannot be deleted.");
      await db.run("DELETE FROM categories WHERE id = ? AND user_id = ?", id, userId);
    },

    /** Normalize Plaid's personal_finance_category (e.g. "FOOD_AND_DRINK" or
     *  "food_and_drink") into the app's title-case path style ("Food and Drink")
     *  so it matches the seeded system category paths. Plaid's native proxy
     *  returns the `.primary` value as UPPER_CASE_WITH_UNDERSCORES; the web
     *  client uses `.detailed`. Both should map to "Food and Drink". */
    normalizePfc(raw: string | null): string | null {
      if (!raw) return null;
      return raw
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    },

    /** Longest-pattern match: plaid_paths is a newline-separated list of
     *  hierarchy patterns ("Food and Drink" or "Food and Drink|Restaurants"); a
     *  transaction matches when its (normalized) personal-finance category or
     *  legacy path starts with that prefix. Longest matching pattern wins.
     *  Matching is case-insensitive so Plaid's "FOOD_AND_DRINK" → "Food and
     *  Drink" matches the seeded system paths. */
    async match(
      userId: string,
      categoryPath: string | null,
      personalFinanceCategory: string | null
    ): Promise<CategoryRow | null> {
      if (!categoryPath && !personalFinanceCategory) return null;
      const cats = await this.list(userId);
      const pfc = this.normalizePfc(personalFinanceCategory);
      const pathLc = categoryPath ? categoryPath.toLowerCase() : null;
      let best: CategoryRow | null = null;
      let bestLen = -1;
      for (const c of cats) {
        if (!c.plaid_paths) continue;
        const paths = c.plaid_paths.split("\n").map((p) => p.trim()).filter(Boolean);
        for (const p of paths) {
          const pl = p.toLowerCase();
          const hit =
            (pfc !== null && pfc.toLowerCase().startsWith(pl)) ||
            (pathLc !== null && pathLc.startsWith(pl));
          if (hit && p.length > bestLen) {
            best = c;
            bestLen = p.length;
          }
        }
      }
      return best;
    },

    /** Seed the standard system categories (idempotent). */
    async ensureSystem(userId: string): Promise<void> {
      const defaults: Array<{ name: string; paths: string }> = [
        { name: "Food & Dining", paths: "Food and Drink\nFood and Drink|Restaurants" },
        { name: "Groceries", paths: "Food and Drink|Groceries" },
        { name: "Transportation", paths: "Transportation" },
        { name: "Housing", paths: "Home|Rent" },
        { name: "Utilities", paths: "Utilities|Bills and Utilities" },
        { name: "Income", paths: "Income|Paycheck" },
        { name: "Shopping", paths: "Shopping" },
        { name: "Entertainment", paths: "Entertainment" },
        { name: "Healthcare", paths: "Medical|Healthcare" },
        { name: "Travel", paths: "Travel" },
      ];
      const existing = await this.list(userId);
      const have = new Set(existing.map((c) => c.name));
      for (let i = 0; i < defaults.length; i++) {
        const d = defaults[i];
        if (have.has(d.name)) continue;
        await db.run(
          "INSERT INTO categories (id, user_id, name, color, plaid_paths, is_system, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
          randomUUID(),
          userId,
          d.name,
          SYSTEM_COLORS[i % SYSTEM_COLORS.length],
          d.paths,
          now()
        );
      }
    },
  };
}

export type CategoriesService = ReturnType<typeof createCategoriesService>;
