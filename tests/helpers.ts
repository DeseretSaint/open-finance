import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { createDb, SqliteDb, type Db } from "@/server/db/adapter";

/** In-memory DB with the real schema applied (all migrations, like production). */
export function createTestDb(): Db {
  const db = createDb(":memory:");
  const files = fs
    .readdirSync(path.join(process.cwd(), "migrations"))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const f of files) {
    const sql = fs.readFileSync(path.join(process.cwd(), "migrations", f), "utf8");
    (db as SqliteDb).exec(sql);
  }
  return db;
}

export interface TestUser {
  id: string;
  username: string;
}

export async function seedUser(db: Db, username = "tester"): Promise<TestUser> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.run(
    "INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    username,
    "Tester",
    "stub-hash",
    now,
    now
  );
  await db.run("INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)", id, now);
  return { id, username };
}

export async function seedManualAccount(
  db: Db,
  userId: string,
  name = "Checking",
  type = "depository"
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.run(
    "INSERT INTO accounts (id, user_id, item_id, name, type, subtype, mask, currency, created_at) VALUES (?, ?, NULL, ?, ?, NULL, NULL, 'USD', ?)",
    id,
    userId,
    name,
    type,
    now
  );
  return id;
}
