import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createBudgetsService, weekBounds, quarterBounds, yearBounds, periodBounds } from "@/server/domain/budgets";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

describe("budget time frames (P14)", () => {
  it("weekBounds starts on Monday and spans 7 days", () => {
    // 2026-08-05 is a Wednesday
    const w = weekBounds("2026-08-05");
    expect(w.start).toBe("2026-08-03"); // Monday
    expect(w.end).toBe("2026-08-10"); // next Monday (exclusive)
  });

  it("quarterBounds groups into calendar quarters", () => {
    expect(quarterBounds("2026-02-15")).toEqual({ start: "2026-01-01", end: "2026-04-01" });
    expect(quarterBounds("2026-05-15")).toEqual({ start: "2026-04-01", end: "2026-07-01" });
    expect(quarterBounds("2026-12-01")).toEqual({ start: "2026-10-01", end: "2027-01-01" });
  });

  it("yearBounds spans the calendar year", () => {
    expect(yearBounds("2026-06-15")).toEqual({ start: "2026-01-01", end: "2027-01-01" });
  });

  it("periodBounds maps weekly/monthly/yearly", () => {
    expect(periodBounds("weekly", "2026-08-05").start).toBe("2026-08-03");
    expect(periodBounds("monthly", "2026-08-05")).toEqual({ start: "2026-08-01", end: "2026-09-01" });
    expect(periodBounds("yearly", "2026-08-05")).toEqual({ start: "2026-01-01", end: "2027-01-01" });
  });

  it("list respects a weekly frame for all budgets", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createBudgetsService(db);
    await svc.create(user.id, { name: "Food", amountCents: 10000 });

    // expense on 2026-08-05 (Wednesday, week of Aug 3–10)
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, -4000, '2026-08-05', 'Lunch', 'manual', ?)`,
      randomUUID(),
      acc,
      new Date().toISOString()
    );
    // expense the week before — outside the week frame
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, -9999, '2026-07-29', 'Old', 'manual', ?)`,
      randomUUID(),
      acc,
      new Date().toISOString()
    );

    const rows = await svc.list(user.id, "2026-08-05", { kind: "week" });
    expect(rows).toHaveLength(1);
    expect(rows[0].spentCents).toBe(4000);
  });

  it("list with period frame uses each budget's own period", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createBudgetsService(db);
    await svc.create(user.id, { name: "Weekly food", amountCents: 5000, period: "weekly" });
    await svc.create(user.id, { name: "Monthly rent", amountCents: 150000, period: "monthly" });

    // expense on 2026-08-05 — inside BOTH the current week and current month
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at)
       VALUES (?, ?, -3000, '2026-08-05', 'Lunch', 'manual', ?)`,
      randomUUID(),
      acc,
      new Date().toISOString()
    );

    const rows = await svc.list(user.id, "2026-08-05", { kind: "period" });
    const weekly = rows.find((b) => b.name === "Weekly food")!;
    const monthly = rows.find((b) => b.name === "Monthly rent")!;
    expect(weekly.spentCents).toBe(3000);
    expect(monthly.spentCents).toBe(3000);
  });
});
