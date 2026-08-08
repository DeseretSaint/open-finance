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

/**
 * Merchant-name → category-name keyword map for the name fallback in
 * matchByName(). Keyword is matched case-insensitively as a substring of the
 * transaction name; the LONGEST matching keyword wins (so "STARBUCKS COFFEE"
 * beats a generic "COFFEE"). Target names match the seeded system categories
 * (case-insensitive), so a user-renamed system category still resolves.
 */
const NAME_KEYWORDS: Array<[keyword: string, categoryName: string]> = [
  // Food & dining
  ["STARBUCKS", "Food & Dining"],
  ["MCDONALD", "Food & Dining"],
  ["WENDY", "Food & Dining"],
  ["TACO BELL", "Food & Dining"],
  ["CHIPOTLE", "Food & Dining"],
  ["SUBWAY", "Food & Dining"],
  ["DOMINO", "Food & Dining"],
  ["PIZZA HUT", "Food & Dining"],
  ["KFC", "Food & Dining"],
  ["BURGER KING", "Food & Dining"],
  ["IN-N-OUT", "Food & Dining"],
  ["DUNKIN", "Food & Dining"],
  ["DOORDASH", "Food & Dining"],
  ["UBER EATS", "Food & Dining"],
  ["GRUBHUB", "Food & Dining"],
  ["RESTAURANT", "Food & Dining"],
  ["CAFE", "Food & Dining"],
  ["COFFEE", "Food & Dining"],
  ["PIZZA", "Food & Dining"],
  ["SUSHI", "Food & Dining"],
  ["MEXICAN", "Food & Dining"],
  ["CHINESE", "Food & Dining"],
  ["THAI", "Food & Dining"],
  ["GRILL", "Food & Dining"],
  ["BURGER", "Food & Dining"],
  // Groceries
  ["WALMART", "Groceries"],
  ["KROGER", "Groceries"],
  ["ALDI", "Groceries"],
  ["TRADER JOE", "Groceries"],
  ["COSTCO", "Groceries"],
  ["SAFEWAY", "Groceries"],
  ["WHOLE FOODS", "Groceries"],
  ["SPROUTS", "Groceries"],
  ["GROCERY", "Groceries"],
  // Transportation (fuel, rideshare, transit)
  ["CHEVRON", "Transportation"],
  ["SHELL OIL", "Transportation"],
  ["SHELL", "Transportation"],
  ["EXXON", "Transportation"],
  ["MOBIL", "Transportation"],
  ["76", "Transportation"],
  ["ARCO", "Transportation"],
  ["CIRCLE K", "Transportation"],
  ["MAVERIK", "Transportation"],
  ["UBER", "Transportation"],
  ["LYFT", "Transportation"],
  ["GAS STATION", "Transportation"],
  ["FUEL", "Transportation"],
  ["GAS", "Transportation"],
  ["TOLL", "Transportation"],
  ["PARKING", "Transportation"],
  ["GARAGE", "Transportation"],
  // Housing
  ["RENT", "Housing"],
  ["MORTGAGE", "Housing"],
  ["APARTMENT", "Housing"],
  ["LANDLORD", "Housing"],
  ["PROPERTY MANAGEMENT", "Housing"],
  ["HOA", "Housing"],
  // Utilities
  ["COMCAST", "Utilities"],
  ["XFINITY", "Utilities"],
  ["VERIZON", "Utilities"],
  ["AT&T", "Utilities"],
  ["T-MOBILE", "Utilities"],
  ["SPECTRUM", "Utilities"],
  ["ELECTRIC", "Utilities"],
  ["POWER CO", "Utilities"],
  ["UTILITY", "Utilities"],
  ["INTERNET", "Utilities"],
  ["WATER", "Utilities"],
  ["GAS BILL", "Utilities"],
  ["PG&E", "Utilities"],
  // Income
  ["PAYCHECK", "Income"],
  ["PAYROLL", "Income"],
  ["DIRECT DEPOSIT", "Income"],
  ["SALARY", "Income"],
  ["WAGES", "Income"],
  ["DEPOSIT", "Income"],
  // Shopping
  ["AMAZON", "Shopping"],
  ["EBAY", "Shopping"],
  ["TARGET", "Shopping"],
  ["BEST BUY", "Shopping"],
  ["NORDSTROM", "Shopping"],
  ["MACY", "Shopping"],
  ["H&M", "Shopping"],
  ["HOMEDEPOT", "Shopping"],
  ["HOME DEPOT", "Shopping"],
  ["LOWE", "Shopping"],
  ["SHOPPING", "Shopping"],
  ["APPLE STORE", "Shopping"],
  ["APPLE.COM", "Shopping"],
  // Entertainment
  ["NETFLIX", "Entertainment"],
  ["HULU", "Entertainment"],
  ["SPOTIFY", "Entertainment"],
  ["DISNEY", "Entertainment"],
  ["AMC", "Entertainment"],
  ["CINEMARK", "Entertainment"],
  ["MOVIE", "Entertainment"],
  ["THEATER", "Entertainment"],
  ["PLAYSTATION", "Entertainment"],
  ["XBOX", "Entertainment"],
  ["STEAM", "Entertainment"],
  ["YOUTUBE", "Entertainment"],
  ["CONCERT", "Entertainment"],
  ["ENTERTAINMENT", "Entertainment"],
  // Healthcare
  ["WALGREENS", "Healthcare"],
  ["CVS", "Healthcare"],
  ["PHARMACY", "Healthcare"],
  ["DOCTOR", "Healthcare"],
  ["DENTAL", "Healthcare"],
  ["DENTIST", "Healthcare"],
  ["HOSPITAL", "Healthcare"],
  ["URGENT CARE", "Healthcare"],
  ["CLINIC", "Healthcare"],
  ["MEDICAL", "Healthcare"],
  // Travel
  ["AIRLINE", "Travel"],
  ["DELTA", "Travel"],
  ["UNITED AIRLINES", "Travel"],
  ["SOUTHWEST", "Travel"],
  ["AMERICAN AIRLINES", "Travel"],
  ["HOTEL", "Travel"],
  ["AIRBNB", "Travel"],
  ["MARRIOTT", "Travel"],
  ["HILTON", "Travel"],
  ["TRAVEL", "Travel"],
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

    /**
     * Name-keyword fallback: when a transaction has no Plaid category data
     * (or none of the user's patterns match), fall back to well-known merchant
     * keywords so local categorization still resolves the obvious ones instead
     * of silently punting everything to "the agent". Maps keyword → target
     * category NAME, then resolves that to the user's category row (so a
     * renamed system category still matches). Longest keyword wins.
     */
    async matchByName(userId: string, name: string | null): Promise<CategoryRow | null> {
      if (!name) return null;
      const upper = name.toUpperCase();
      let bestName: string | null = null;
      let bestLen = -1;
      for (const [keyword, categoryName] of NAME_KEYWORDS) {
        if (upper.includes(keyword) && keyword.length > bestLen) {
          bestName = categoryName;
          bestLen = keyword.length;
        }
      }
      if (!bestName) return null;
      const row = await db.get<CategoryRow>(
        "SELECT * FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND enabled = 1",
        userId,
        bestName
      );
      return row ?? null;
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
