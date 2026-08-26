import { describe, expect, it } from "vitest";
import { createCsvImportService } from "@/server/domain/csv-import";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

describe("csv import (bank statement files)", () => {
  it("parses a generic Date, Description, Amount layout (negative = expense)", async () => {
    const db = createTestDb();
    await seedUser(db);
    const svc = createCsvImportService(db);
    const { rows } = svc.parseCsv(
      "Date,Description,Amount\n" +
        "2026-01-15,STARBUCKS,6.45\n" +
        "2026-01-16,PAYROLL,2500.00\n" +
        "2026-01-17,Netflix,-15.99\n"
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ date: "2026-01-15", name: "STARBUCKS", amountCents: 645 });
    expect(rows[1]).toEqual({ date: "2026-01-16", name: "PAYROLL", amountCents: 250000 });
    expect(rows[2]).toEqual({ date: "2026-01-17", name: "Netflix", amountCents: -1599 });
  });

  it("parses Debit/Credit pairs (debit = expense, credit = income)", async () => {
    const db = createTestDb();
    const svc = createCsvImportService(db);
    const { rows } = svc.parseCsv(
      "Date,Description,Debit,Credit\n" +
        "01/15/2026,Grocery Store,45.67,\n" +
        "01/16/2026,Deposit,,1200.00\n"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ date: "2026-01-15", name: "Grocery Store", amountCents: -4567 });
    expect(rows[1]).toEqual({ date: "2026-01-16", name: "Deposit", amountCents: 120000 });
  });

  it("dedupes on re-import (same account, date, amount, name)", async () => {
    const db = createTestDb();
    const userId = (await seedUser(db)).id;
    const accountId = await seedManualAccount(db, userId);
    const svc = createCsvImportService(db);
    const csv =
      "Date,Description,Amount\n" +
      "2026-01-15,STARBUCKS,6.45\n" +
      "2026-01-16,AMAZON,23.10\n";

    const first = await svc.importCsv(userId, accountId, csv);
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);

    const second = await svc.importCsv(userId, accountId, csv);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);

    const rows = await db.all<{ c: number }>("SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?", accountId);
    expect(rows[0].c).toBe(2);
  });

  it("categorizes obvious merchants on import via the name-keyword fallback", async () => {
    const db = createTestDb();
    const userId = (await seedUser(db)).id;
    const accountId = await seedManualAccount(db, userId);
    const svc = createCsvImportService(db);
    await svc.importCsv(
      userId,
      accountId,
      "Date,Description,Amount\n2026-01-15,STARBUCKS,6.45\n2026-01-16,SOMETHING_UNKNOWN,9.99\n"
    );
    const rows = await db.all<{ name: string; user_category_id: string | null }>(
      "SELECT name, user_category_id FROM transactions WHERE account_id = ?",
      accountId
    );
    const starbucks = rows.find((r) => r.name === "STARBUCKS");
    const unknown = rows.find((r) => r.name === "SOMETHING_UNKNOWN");
    expect(starbucks?.user_category_id).toBeTruthy();
    expect(unknown?.user_category_id).toBeNull();
  });

  it("rejects a CSV with no recognizable columns", async () => {
    const db = createTestDb();
    const svc = createCsvImportService(db);
    expect(() => svc.parseCsv("Foo,Bar,Baz\n1,2,3\n")).toThrow();
  });
});
