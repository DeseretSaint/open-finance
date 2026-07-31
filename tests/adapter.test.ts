import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDb } from "@/server/db/adapter";

let tmpDir: string;
let db: SqliteDb;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "of-db-"));
  db = new SqliteDb(path.join(tmpDir, "test.db"));
  await db.run("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)");
});

afterEach(async () => {
  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SqliteDb adapter", () => {
  it("runs inserts and reads rows", async () => {
    await db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["a", 1]);
    const row = await db.get<{ id: string; n: number }>("SELECT * FROM t WHERE id = ?", ["a"]);
    expect(row?.n).toBe(1);
    const all = await db.all<{ id: string }>("SELECT id FROM t");
    expect(all).toHaveLength(1);
  });

  it("returns changes and lastInsertRowid", async () => {
    const info = await db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["b", 2]);
    expect(info.changes).toBe(1);
  });

  it("commits transactions atomically", async () => {
    await db.transaction(async () => {
      await db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["x", 1]);
      await db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["y", 2]);
    });
    const count = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t");
    expect(count?.c).toBe(2);
  });

  it("rolls back on error inside transaction", async () => {
    await expect(
      db.transaction(async () => {
        await db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["z", 1]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const count = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t");
    expect(count?.c).toBe(0);
  });
});
