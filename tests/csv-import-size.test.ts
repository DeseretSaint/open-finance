import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { MAX_CSV_BYTES, assertCsvSize, createCsvImportService } from "@/server/domain/csv-import";
import { getSqliteDb, type Db } from "@/server/db/adapter";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/sessions";
import { seedUser, seedManualAccount } from "./helpers";
import { POST as csvPost } from "@/app/api/import/csv/route";

describe("csv-import upload size cap", () => {
  it("assertCsvSize rejects oversized declared Content-Length and body lengths", () => {
    // oversized declared content-length → 413
    expect(() => assertCsvSize(String(MAX_CSV_BYTES + 1), null)).toThrow(/too large/i);
    // oversized parsed body length → 413
    expect(() => assertCsvSize(null, MAX_CSV_BYTES + 1)).toThrow(/too large/i);
    // exactly at the cap → allowed
    expect(() => assertCsvSize(String(MAX_CSV_BYTES), MAX_CSV_BYTES)).not.toThrow();
    // absent / non-numeric header + small body → allowed
    expect(() => assertCsvSize(null, 1024)).not.toThrow();
    expect(() => assertCsvSize("garbage", 1024)).not.toThrow();
    // the error is the 413 ApiError
    try {
      assertCsvSize(null, MAX_CSV_BYTES + 1);
      expect.unreachable();
    } catch (e) {
      expect((e as { status: number }).status).toBe(413);
    }
  });

  it("parseCsv still parses a normal-size CSV (cap does not affect parsing)", () => {
    const csv = "Date,Description,Amount\n2026-01-01,Coffee,-3.50\n2026-01-02,Salary,1200.00\n";
    const svc = createCsvImportService({} as Db);
    const { rows } = svc.parseCsv(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ name: "Coffee", amountCents: -350 });
    expect(rows[1]).toMatchObject({ name: "Salary", amountCents: 120000 });
  });
});

describe("csv import route size + authz gates", () => {
  async function setup(): Promise<{ db: Db; cookie: string; accountId: string }> {
    const dir = path.join(process.cwd(), "migrations");
    const sqls = fs
      .readdirSync(dir)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    const sqlite = getSqliteDb();
    // The singleton DB persists across tests in the same worker — only migrate
    // once (re-running migrations throws "table already exists"). Querying
    // sqlite_master for a missing table returns empty (not an error).
    const alreadyMigrated = await sqlite.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    );
    if (!alreadyMigrated) {
      for (const sql of sqls) sqlite.exec(sql);
    }

    const user = await seedUser(sqlite, `csv-size-${randomUUID()}`);
    await sqlite.run(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      await hashPassword("csv-size-pass"),
      user.id
    );
    const accountId = await seedManualAccount(sqlite, user.id, "Checking");
    const { token } = await createSession(user.id, "1h", "csv-size-test", sqlite);
    return { db: sqlite, cookie: `of_session=${token}`, accountId };
  }

  it("returns 413 for an oversized CSV before buffering/parsing", async () => {
    const { cookie } = await setup();
    const big = "Date,Description,Amount\n" + "2026-01-01,Coffee,-3.50\n".repeat(2_000_000);
    const res = await csvPost(
      new NextRequest("http://localhost/api/import/csv", {
        method: "POST",
        headers: { cookie, "x-of-request": "1", "content-length": String(big.length) },
        body: big,
      })
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
  });

  it("imports a small valid CSV successfully (cap does not block legitimate use)", async () => {
    const { cookie, accountId } = await setup();
    const csv = "Date,Description,Amount\n2026-01-01,Coffee,-3.50\n2026-01-02,Salary,1200.00\n";
    const res = await csvPost(
      new NextRequest("http://localhost/api/import/csv", {
        method: "POST",
        headers: { cookie, "x-of-request": "1" },
        body: JSON.stringify({ accountId, contents: csv }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; skipped: number; totalParsed: number };
    expect(body.totalParsed).toBe(2);
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(0);
  });

  it("still requires CSRF — no x-of-request header → 403 before any size logic", async () => {
    const { cookie } = await setup();
    const csv = "Date,Description,Amount\n2026-01-01,Coffee,-3.50\n";
    const res = await csvPost(
      new NextRequest("http://localhost/api/import/csv", {
        method: "POST",
        headers: { cookie, "content-length": String(csv.length) },
        body: JSON.stringify({ accountId: randomUUID(), contents: csv }),
      })
    );
    expect(res.status).toBe(403);
  });
});
