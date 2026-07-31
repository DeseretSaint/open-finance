// cap-sqlite-adapter.ts — P8b phone-solo (v1.1 asset), complete.
// Implements the shared Db interface over @capacitor-community/sqlite so the
// SAME SQL from src/server/domain runs on Android with zero query changes.
// Install: pnpm add @capacitor-community/sqlite && npx cap sync android.
// Bundled only in the mobile build; the Next server keeps better-sqlite3.
import type { Db } from "@/server/db/adapter";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);

export class CapSqliteDb implements Db {
  private dbName = "open-finance";
  private conn: Awaited<ReturnType<SQLiteConnection["createConnection"]>> | null = null;

  private async connection() {
    if (this.conn) return this.conn;
    await sqlite.checkConnectionsConsistency();
    const ret = await sqlite.retrieveConnection(this.dbName);
    this.conn = ret.result
      ? ret.connection
      : await sqlite.createConnection(this.dbName, false, "no-encryption", 1, false);
    return this.conn;
  }

  /** Apply migrations/001_init.sql (split on ';' — the schema has no triggers). */
  async migrate(sql: string): Promise<void> {
    const conn = await this.connection();
    for (const stmt of sql.split(";")) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      await conn.execute(trimmed);
    }
    await conn.setVersion("1");
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const conn = await this.connection();
    const r = await conn.query(sql, params.map(String));
    return (r.values ?? []) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows[0];
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const conn = await this.connection();
    const r = await conn.run(sql, params.map(String));
    return { changes: r.changes ?? 0, lastInsertRowid: Number(r.lastId ?? 0) };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const conn = await this.connection();
    await conn.beginTransaction();
    try {
      const result = await fn();
      await conn.commitTransaction();
      return result;
    } catch (e) {
      await conn.rollbackTransaction();
      throw e;
    }
  }
}
