import Database from "better-sqlite3";
import { env } from "@/lib/env";
import type { Db, DbRow } from "@/server/db/types";
import { registerDbProvider } from "@/server/db/registry";

export type { Db, DbRow } from "@/server/db/types";

/** Async adapter over better-sqlite3 (sync internals, async surface so the
 *  same interface can be implemented with cap-sqlite on Android). */
export class SqliteDb implements Db {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
  }

  async all<T = DbRow>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  async get<T = DbRow>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const r = this.db.prepare(sql).run(...(params as never[]));
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Execute raw multi-statement SQL (schema application). Not on the Db interface. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

let _db: SqliteDb | null = null;

/** Singleton bound to DATABASE_PATH (test code should use createDb instead). */
export function getDb(): Db {
  if (!_db) _db = new SqliteDb(env.DATABASE_PATH);
  return _db;
}

// Register the server Db provider for the shared registry (domain services use
// getDb() from @/server/db/registry; the solo webview registers CapSqliteDb).
registerDbProvider(getDb);

/** Close + drop the singleton (used by backup/restore to swap the DB file). */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Access the underlying SqliteDb instance for file-level ops (backup/restore). */
export function getSqliteDb(): SqliteDb {
  const db = getDb() as SqliteDb;
  return db;
}

/** Create an isolated instance (used by tests and the migration runner). */
export function createDb(path: string): SqliteDb {
  return new SqliteDb(path);
}
