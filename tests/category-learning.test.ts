import { describe, expect, it } from "vitest";
import { createTestDb, seedUser } from "./helpers";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";
import { createAccountsService } from "@/server/domain/accounts";

describe("per-user category learning (manual recategorization → repeat-merchant suggestion)", () => {
  it("records a manual recategorization and suggests it for a repeat merchant (case/space-insensitive key)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await createAccountsService(db).createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    const cats = createCategoriesService(db);
    await cats.ensureSystem(user.id);
    const travel = await cats.create(user.id, { name: "My Travel", color: "#000000", plaidPaths: "" });
    const txns = createTransactionsService(db);
    const today = new Date().toISOString().slice(0, 10);

    const t = await txns.createManual(user.id, { accountId: acc.id, amountCents: -5000, date: today, name: "Delta Airlines" });
    await txns.update(user.id, t.id, { userCategoryId: travel.id });

    // learned key is normalized: case + surrounding/collapsed whitespace ignored
    expect((await cats.matchLearned(user.id, "DELTA AIRLINES"))?.id).toBe(travel.id);
    expect((await cats.matchLearned(user.id, " delta airlines "))?.id).toBe(travel.id);

    // a fresh identical-merchant charge is auto-suggested from the learning
    const t2 = await txns.createManual(user.id, { accountId: acc.id, amountCents: -5000, date: today, name: "Delta Airlines" });
    expect((await cats.matchLearned(user.id, t2.name))?.id).toBe(travel.id);
  });

  it("learned mapping wins over the global NAME_KEYWORDS fallback", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const cats = createCategoriesService(db);
    await cats.ensureSystem(user.id);
    const food = (await cats.list(user.id)).find((c) => c.name === "Food & Dining");
    // STARBUCKS would normally fall back to Food & Dining via NAME_KEYWORDS.
    expect((await cats.matchByName(user.id, "Starbucks"))?.id).toBe(food?.id);

    const client = await cats.create(user.id, { name: "Client Meetings", color: "#000000", plaidPaths: "" });
    await cats.recordLearning(user.id, "Starbucks", client.id);
    expect((await cats.matchLearned(user.id, "Starbucks"))?.id).toBe(client.id);
  });

  it("reinforces count on repeat teaching and skips disabled categories", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const cats = createCategoriesService(db);
    await cats.ensureSystem(user.id);
    const a = await cats.create(user.id, { name: "CatA", color: "#000000", plaidPaths: "" });
    await cats.recordLearning(user.id, "Foo Bar", a.id);
    await cats.recordLearning(user.id, "Foo Bar", a.id);
    const row = await db.get<{ count: number }>(
      "SELECT count FROM category_learnings WHERE user_id = ? AND merchant_key = ?",
      user.id,
      "foo bar"
    );
    expect(row?.count).toBe(2);

    // disabling the learned category removes the suggestion
    await db.run("UPDATE categories SET enabled = 0 WHERE id = ?", a.id);
    expect(await cats.matchLearned(user.id, "Foo Bar")).toBeNull();
  });

  it("autoCategorize applies learned mapping above Plaid path + keyword fallback", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await createAccountsService(db).createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    const cats = createCategoriesService(db);
    await cats.ensureSystem(user.id);
    const travel = await cats.create(user.id, { name: "Airfare", color: "#000000", plaidPaths: "" });
    const txns = createTransactionsService(db);
    const today = new Date().toISOString().slice(0, 10);

    // Teach: this merchant is Travel (overriding whatever Plaid/fallback says).
    const t1 = await txns.createManual(user.id, { accountId: acc.id, amountCents: -5000, date: today, name: "Delta Airlines" });
    await db.run("UPDATE transactions SET category_path = ? WHERE id = ?", "Travel", t1.id);
    await txns.update(user.id, t1.id, { userCategoryId: travel.id });

    // A repeat charge with NO category data should pick up the learned Travel.
    const t2 = await txns.createManual(user.id, { accountId: acc.id, amountCents: -5000, date: today, name: "Delta Airlines" });
    const res = await import("@/server/domain/categorizer").then((m) => m.autoCategorize(db, user.id, 0));
    expect(res.categorized).toBe(1);
    const list = await txns.list(user.id, { limit: 10, offset: 0 });
    expect(list.rows.find((t) => t.id === t2.id)?.user_category_id).toBe(travel.id);
  });
});
