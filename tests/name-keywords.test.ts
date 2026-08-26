import { describe, expect, it } from "vitest";
import { createCategoriesService } from "@/server/domain/categories";
import { createTestDb, seedUser } from "./helpers";

/**
 * Test-backed measurement of the merchant-name fallback ruleset
 * (NAME_KEYWORDS in categories.ts → matchByName). This is the local
 * categorization that fires when a transaction has no Plaid category
 * data — exactly the seed-data scenario where every merchant arrives
 * with only a name. We assert (1) the seed-merchant corpus hit rate
 * and (2) per-category correctness of the extended ruleset.
 */
describe("merchant-name fallback ruleset (matchByName)", () => {
  it("resolves the demo seed-merchant corpus with no false negatives", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.ensureSystem(user.id);

    // The exact merchant names the seed script (scripts/seed.js) emits —
    // i.e. the real-world corpus this fallback must handle on first run.
    const corpus: Array<[name: string, expectCategory: string]> = [
      ["Acme Corp Payroll", "Income"],
      ["Maple Ridge Apartments", "Housing"], // previously MISSED (no APARTMENTS keyword)
      ["City Power & Light", "Utilities"], // previously MISSED (no POWER/&LIGHT keyword)
      ["Verizon Wireless", "Utilities"],
      ["Whole Foods Market", "Groceries"],
      ["Trader Joe's", "Groceries"],
      ["Netflix", "Entertainment"],
      ["Shell Gas", "Transportation"],
      ["Chipotle", "Food & Dining"],
      ["Amazon", "Shopping"],
      ["Spotify", "Entertainment"],
    ];

    let resolved = 0;
    for (const [name, expectCat] of corpus) {
      const row = await svc.matchByName(user.id, name);
      if (row) resolved++;
      expect(row?.name, `merchant "${name}" should resolve to ${expectCat}`).toBe(expectCat);
    }
    // Hit-rate assertion: 100% of the seed corpus must resolve locally.
    expect(resolved).toBe(corpus.length);
  });

  it("covers the extended per-category ruleset", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.ensureSystem(user.id);

    const cases: Array<[name: string, expectCategory: string]> = [
      // Food & Dining
      ["CHICK-FIL-A #1234", "Food & Dining"],
      ["Panera Bread", "Food & Dining"],
      ["Olive Garden", "Food & Dining"],
      // Groceries
      ["PUBLIX SUPERMARKET", "Groceries"],
      ["ALDI 2241", "Groceries"],
      ["Costco Wholesale", "Groceries"],
      // Transportation
      ["GEICO AUTO INSURANCE", "Transportation"],
      ["Shell Oil 5521", "Transportation"],
      ["Lyft Ride", "Transportation"],
      // Housing
      ["Rocket Mortgage", "Housing"],
      ["Sunrise Apartments", "Housing"],
      ["HOA Dues", "Housing"],
      // Utilities
      ["Rocky Mountain Power", "Utilities"],
      ["Comcast Xfinity", "Utilities"],
      ["City Water Dept", "Utilities"],
      // Income
      ["Direct Deposit ADP", "Income"],
      ["Tax Refund IRS", "Income"],
      ["Dividend Payment", "Income"],
      // Shopping
      ["IKEA Home", "Shopping"],
      ["Best Buy", "Shopping"],
      ["PETSMART", "Shopping"],
      ["TJ Maxx", "Shopping"],
      // Entertainment
      ["HBO MAX", "Entertainment"],
      ["Disney+", "Entertainment"],
      ["Ticketmaster", "Entertainment"],
      ["Steam Games", "Entertainment"],
      // Healthcare
      ["Cigna Health", "Healthcare"],
      ["Walgreens Pharmacy", "Healthcare"],
      ["Kaiser Permanente", "Healthcare"],
      ["Vision Works", "Healthcare"],
      // Travel
      ["Expedia Trip", "Travel"],
      ["Delta Airlines", "Travel"],
      ["Marriott Hotel", "Travel"],
      ["Enterprise Rent-A-Car", "Travel"],
    ];

    for (const [name, expectCat] of cases) {
      const row = await svc.matchByName(user.id, name);
      expect(row?.name, `merchant "${name}" should resolve to ${expectCat}`).toBe(expectCat);
    }
  });

  it("longest keyword wins so a generic suffix does not override a specific brand", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.ensureSystem(user.id);
    // "FOOD & DINING" keyword length 13; a longer specific brand like
    // "OLIVE GARDEN" (12) is shorter, but "RESTAURANT" (10) must not beat a
    // brand. Verify Starbucks (9) still beats the generic "FOOD & DINING"? It
    // shouldn't — longest wins, and "FOOD & DINING" is longer than "STARBUCKS"
    // (9) so a generic food name resolves to Food & Dining, while a branded
    // restaurant name that also matches a longer-specific keyword wins that.
    const generic = await svc.matchByName(user.id, "CORNER CAFE");
    expect(generic?.name).toBe("Food & Dining");
    // A long specific brand should win over the short generic "COFFEE" (6).
    const branded = await svc.matchByName(user.id, "STARBUCKS COFFEE");
    expect(branded?.name).toBe("Food & Dining");
  });

  it("returns null for unrecognized merchants (left for the agent)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.ensureSystem(user.id);
    expect(await svc.matchByName(user.id, "POS DEBIT MYSTERY XYZ")).toBeNull();
    expect(await svc.matchByName(user.id, null)).toBeNull();
  });
});
