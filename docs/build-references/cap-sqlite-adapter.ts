// cap-sqlite-adapter.ts — reference snippet for P8b (phone-solo).
// Implements the shared Db interface over @capacitor-community/sqlite so the
// SAME SQL runs on Android. Copy from here, don't invent.
import type { Db } from "@/server/db/adapter";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);

export class CapSqliteDb implements Db {
  private dbName = "open-finance";

  private async conn() {
    const ret = await sqlite.checkConnectionsConsistency();
    const conn = ret.result
      ? await sqlite.retrieveConnection(this.dbName)
      : await sqlite.createConnection(this.dbName, false, "no-encryption", 1, false);
    return conn;
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const conn = await this.conn();
    const r = await conn.query(sql, params as string[]);
    return (r.values ?? []) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows[0];
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const conn = await this.conn();
    const r = await conn.run(sql, params as string[]);
    return { changes: r.changes ?? 0, lastInsertRowid: Number(r.lastId ?? 0) };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const conn = await this.conn();
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
