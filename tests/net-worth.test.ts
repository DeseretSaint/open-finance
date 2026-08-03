import { describe, expect, it } from "vitest";
import { createSummaryService } from "@/server/domain/summary";
import { createAccountsService } from "@/server/domain/accounts";
import { createTestDb, seedUser, seedManualAccount } from "./helpers";

describe("net worth inclusion (P24)", () => {
  it("investment accounts excluded from net worth stay in the accounts list", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);

    const checking = await seedManualAccount(db, user.id, "Checking", "depository");
    await db.run("UPDATE accounts SET current_balance_cents = 500000 WHERE id = ?", checking);

    // Investment account (e.g. Robinhood), excluded from day-to-day net worth.
    const investment = await svc.createManual(user.id, {
      name: "Robinhood",
      type: "investment",
      currentBalanceCents: 10_000_000,
    });
    await svc.setNetWorthInclusion(user.id, investment.id, false);

    // Still visible in the accounts list.
    const list = await svc.list(user.id);
    expect(list.map((a) => a.name)).toContain("Robinhood");
    expect(list.find((a) => a.id === investment.id)?.include_in_net_worth).toBe(0);

    // Net worth excludes it.
    const summary = await createSummaryService(db).get(user.id);
    expect(summary.totalBalanceCents).toBe(500000);
    expect(summary.byType.investment ?? 0).toBe(0);
  });

  it("toggling inclusion back on restores the account in net worth", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);
    const investment = await svc.createManual(user.id, {
      name: "Robinhood",
      type: "investment",
      currentBalanceCents: 250_000,
    });
    await svc.setNetWorthInclusion(user.id, investment.id, false);
    expect((await createSummaryService(db).get(user.id)).totalBalanceCents).toBe(0);
    await svc.setNetWorthInclusion(user.id, investment.id, true);
    expect((await createSummaryService(db).get(user.id)).totalBalanceCents).toBe(250000);
  });
});
