import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  MAX_BACKUP_BYTES,
  assertBackupSize,
  createBackupService,
  decryptBackup,
  encryptBackup,
} from "@/server/domain/backup";
import { createDb, getSqliteDb, type Db } from "@/server/db/adapter";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/sessions";
import { detectHub, preferredHubUrl } from "@/server/detect/detect";
import { seedUser } from "./helpers";
import { POST as restorePost } from "@/app/api/backup/restore/route";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `of-test-${randomUUID()}.db`);
}

async function fileDb(p: string): Promise<Db> {
  // Production DBs are created by the migration runner (tracks _migrations), so
  // restores can bring older backups up to date without re-running applied SQL.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3") as new (p: string) => {
    pragma(s: string): void;
    exec(s: string): void;
    close(): void;
  };
  const { runMigrations } = require("../migrations/up.js") as {
    runMigrations: (db: { pragma(s: string): void; exec(s: string): void }, dir?: string) => unknown;
  };
  const raw = new Database(p);
  try {
    runMigrations(raw as Parameters<typeof runMigrations>[0]);
  } finally {
    raw.close();
  }
  return createDb(p);
}

describe("backup", () => {
  it("round-trips a database through the encrypted envelope", async () => {
    const p = tmpDbPath();
    const db = await fileDb(p);
    const user = await seedUser(db);
    await db.run("INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, 'Test', 10000, 'monthly', ?)", randomUUID(), user.id, new Date().toISOString());
    (db as unknown as { close(): void }).close();

    const envelope = encryptBackup(p);
    const plain = decryptBackup(envelope);
    expect(plain.subarray(0, 16).toString()).toBe("SQLite format 3\u0000");
    // plaintext == original file bytes
    expect(plain.equals(fs.readFileSync(p))).toBe(true);
    fs.rmSync(p, { force: true });
  });

  it("rejects tampered envelopes (wrong key / corruption)", async () => {
    const p = tmpDbPath();
    const db = await fileDb(p);
    (db as unknown as { close(): void }).close();
    const envelope = encryptBackup(p);
    envelope[envelope.length - 1] ^= 0xff; // corrupt one ciphertext byte
    expect(() => decryptBackup(envelope)).toThrow();
    fs.rmSync(p, { force: true });
  });

  it("rejects non-backup input", () => {
    expect(() => decryptBackup(Buffer.from("garbage data here"))).toThrow();
  });

  it("restore requires password confirmation and swaps the DB file", async () => {
    const p = tmpDbPath();
    const db = await fileDb(p);
    const user = await seedUser(db);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword("correct-horse-battery"), user.id);
    await db.run("INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, 'Before', 1, 'monthly', ?)", randomUUID(), user.id, new Date().toISOString());

    // Build a "backup" with different content (a 'Restored' budget)
    const backupPath = tmpDbPath();
    const bdb = await fileDb(backupPath);
    const buser = await seedUser(bdb, "restore-src");
    await bdb.run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword("irrelevant"), buser.id);
    await bdb.run("INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, 'Restored', 999, 'monthly', ?)", randomUUID(), buser.id, new Date().toISOString());
    (bdb as unknown as { close(): void }).close();
    const envelope = encryptBackup(backupPath);

    const svc = createBackupService(db, p);
    // wrong password → forbidden
    await expect(svc.restoreBackup(user.id, envelope, "nope")).rejects.toThrow();
    // right password → swaps file (service closes live handles itself)
    const result = await svc.restoreBackup(user.id, envelope, "correct-horse-battery");
    expect(result.restored).toBe(true);
    expect(result.preRestoreBackupPath).toBeTruthy();
    expect(fs.existsSync(result.preRestoreBackupPath!)).toBe(true);

    // the live file now contains the restored data
    const reopened = createDb(p);
    const row = await reopened.get<{ name: string }>("SELECT name FROM budgets WHERE name = 'Restored'");
    expect(row?.name).toBe("Restored");
    reopened.close();
    fs.rmSync(p, { force: true });
    fs.rmSync(backupPath, { force: true });
  });
});

describe("backup upload size cap", () => {
  it("assertBackupSize rejects oversized declared Content-Length and file sizes", () => {
    // oversized declared content-length → 413
    expect(() => assertBackupSize(String(MAX_BACKUP_BYTES + 1), null)).toThrow(/too large/i);
    // oversized parsed file size → 413
    expect(() => assertBackupSize(null, MAX_BACKUP_BYTES + 1)).toThrow(/too large/i);
    // exactly at the cap → allowed
    expect(() => assertBackupSize(String(MAX_BACKUP_BYTES), MAX_BACKUP_BYTES)).not.toThrow();
    // absent / non-numeric header + small file → allowed
    expect(() => assertBackupSize(null, 1024)).not.toThrow();
    expect(() => assertBackupSize("garbage", 1024)).not.toThrow();
    // the error is the 413 ApiError
    try {
      assertBackupSize(null, MAX_BACKUP_BYTES + 1);
      expect.unreachable();
    } catch (e) {
      expect((e as { status: number }).status).toBe(413);
    }
  });

  it("restore route returns 413 for an oversized upload before touching the DB", async () => {
    // Migrate the singleton (what the route uses via getDb()).
    const dir = path.join(process.cwd(), "migrations");
    const sqls = fs
      .readdirSync(dir)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    const sqlite = getSqliteDb();
    for (const sql of sqls) sqlite.exec(sql);

    const user = await seedUser(sqlite, "restore-size");
    await sqlite.run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword("size-check-pass"), user.id);
    const { token } = await createSession(user.id, "1h", "size-test", sqlite);
    const cookie = `of_session=${token}`;

    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(64)]), "big.ofbak");
    fd.append("password", "size-check-pass");

    // Declared Content-Length over the cap → 413 before buffering/decrypting.
    const res = await restorePost(
      new NextRequest("http://localhost/api/backup/restore", {
        method: "POST",
        headers: { cookie, "x-of-request": "1", "content-length": String(MAX_BACKUP_BYTES + 1) },
        body: fd,
      })
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");

    // Same request under the cap passes the size guard (reaches password check).
    const fd2 = new FormData();
    fd2.append("file", new Blob([new Uint8Array(64)]), "small.ofbak");
    fd2.append("password", "wrong-password");
    const res2 = await restorePost(
      new NextRequest("http://localhost/api/backup/restore", {
        method: "POST",
        headers: { cookie, "x-of-request": "1" },
        body: fd2,
      })
    );
    // 64 bytes is not a valid envelope → password check runs first (403 wrong
    // password) — either way it is NOT 413, proving the guard let it through.
    expect(res2.status).not.toBe(413);

    // Still auth + CSRF gated: no CSRF header → 403 before any size logic.
    const fd3 = new FormData();
    fd3.append("file", new Blob([new Uint8Array(64)]), "x.ofbak");
    fd3.append("password", "size-check-pass");
    const res3 = await restorePost(
      new NextRequest("http://localhost/api/backup/restore", {
        method: "POST",
        headers: { cookie, "content-length": String(MAX_BACKUP_BYTES + 1) },
        body: fd3,
      })
    );
    expect(res3.status).toBe(403);
  });
});

describe("hub detect", () => {
  it("returns a usable preferred URL", async () => {
    const r = await detectHub();
    expect(Array.isArray(r.lanIps)).toBe(true);
    expect(r.tailscale === null || typeof r.tailscale.ip === "string").toBe(true);
    const url = preferredHubUrl(r);
    expect(url.startsWith("http://")).toBe(true);
  });
});
