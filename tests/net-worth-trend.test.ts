import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createReportsService } from "@/server/domain/reports";
import { createAccountsService } from "@/server/domain/accounts";
import { createTestDb, seedUser } from "./helpers";
import { addDaysISO, todayISO } from "@/server/domain/dates";
import type { AllowlistCtx } from "@/server/db/allowlist";

async function seedHistory(
  db: ReturnType<typeof createTestDb>,
  accountId: string,
  date: string,
  balanceCents: number
) {
  await db.run(
    `INSERT INTO balance_history (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
    randomUUID(),
    accountId,
    date,
    balanceCents
  );
}

describe("netWorthTrend (P24 / balance_history)", () => {
  it("returns daily points with carry-forward; credit/loan land in liabilities, 'other' counts as asset", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);
    const check = await svc.createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 100_000 });
    const other = await svc.createManual(user.id, { name: "Other", type: "other", currentBalanceCents: 300_000 });
    const card = await svc.createManual(user.id, { name: "Card", type: "credit", currentBalanceCents: 25_000 });

    const t0 = addDaysISO(todayISO(), -2);
    const t1 = addDaysISO(todayISO(), -1);
    const t2 = todayISO();
    // depository rises over 3 days; credit + other flat
    for (const [acc, bal] of [
      [check.id, [90_000, 95_000, 100_000]],
      [other.id, [300_000, 300_000, 300_000]],
      [card.id, [-25_000, -25_000, -25_000]],
    ] as const) {
      await seedHistory(db, acc, t0, bal[0]);
      await seedHistory(db, acc, t1, bal[1]);
      await seedHistory(db, acc, t2, bal[2]);
    }

    const trend = await createReportsService(db).netWorthTrend(user.id, 12);
    expect(trend.length).toBe(3);
    expect(trend[0].date).toBe(t0);
    expect(trend[2].date).toBe(t2);
    // last day: assets = 100000 + 300000 (other included), liabilities = 25000
    const last = trend[2];
    expect(last.assetsCents).toBe(400_000);
    expect(last.liabilitiesCents).toBe(25_000);
    expect(last.netCents).toBe(375_000);
    // trend rises with the depository balance
    expect(trend[2].netCents).toBeGreaterThan(trend[0].netCents);
  });

  it("carries forward the last known balance for accounts missing days", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);
    const acc = await svc.createManual(user.id, { name: "A", type: "depository", currentBalanceCents: 50_000 });

    const open = addDaysISO(todayISO(), -5);
    await seedHistory(db, acc.id, open, 50_000); // only one point; rest carry forward

    const trend = await createReportsService(db).netWorthTrend(user.id, 12);
    expect(trend[0].date).toBe(open);
    expect(trend.length).toBe(6); // open .. today
    expect(new Set(trend.map((p) => p.netCents)).size).toBe(1); // flat carry-forward
    expect(trend.every((p) => p.netCents === 50_000)).toBe(true);
  });

  it("returns [] when the user has no balance history yet", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);
    // No balance supplied → createManual writes no balance_history point → still empty.
    await svc.createManual(user.id, { name: "A", type: "depository" });
    expect(await createReportsService(db).netWorthTrend(user.id, 12)).toEqual([]);
  });

  it("respects agent allowlist scoping (only permitted accounts counted)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);
    const a1 = await svc.createManual(user.id, { name: "A1", type: "depository", currentBalanceCents: 100_000 });
    const a2 = await svc.createManual(user.id, { name: "A2", type: "depository", currentBalanceCents: 50_000 });
    const t = todayISO();
    await seedHistory(db, a1.id, t, 100_000);
    await seedHistory(db, a2.id, t, 50_000);

    const allow: AllowlistCtx = { accountIds: [a1.id] };
    const trend = await createReportsService(db).netWorthTrend(user.id, 12, allow);
    expect(trend[trend.length - 1].assetsCents).toBe(100_000); // a2 excluded
    expect(trend[trend.length - 1].netCents).toBe(100_000);
  });

  it("excludes hidden and include_in_net_worth=0 accounts from the trend", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAccountsService(db);
    const shown = await svc.createManual(user.id, { name: "Shown", type: "depository", currentBalanceCents: 100_000 });
    const hidden = await svc.createManual(user.id, { name: "Hidden", type: "depository", currentBalanceCents: 999_000 });
    const t = todayISO();
    await seedHistory(db, shown.id, t, 100_000);
    await seedHistory(db, hidden.id, t, 999_000);
    await svc.setNetWorthInclusion(user.id, hidden.id, false);

    const trend = await createReportsService(db).netWorthTrend(user.id, 12);
    expect(trend[trend.length - 1].assetsCents).toBe(100_000);
  });
});
