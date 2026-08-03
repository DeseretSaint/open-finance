import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createBackupService, decryptBackup, encryptBackup } from "@/server/domain/backup";
import { createDb, type Db } from "@/server/db/adapter";
import { hashPassword } from "@/server/auth/password";
import { detectHub, preferredHubUrl } from "@/server/detect/detect";
import { seedUser } from "./helpers";

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

describe("hub detect", () => {
  it("returns a usable preferred URL", async () => {
    const r = await detectHub();
    expect(Array.isArray(r.lanIps)).toBe(true);
    expect(r.tailscale === null || typeof r.tailscale.ip === "string").toBe(true);
    const url = preferredHubUrl(r);
    expect(url.startsWith("http://")).toBe(true);
  });
});
