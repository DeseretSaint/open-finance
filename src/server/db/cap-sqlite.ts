// CapSqliteDb — phone-solo Db implementation (P8b).
// Implements the shared Db interface over @capacitor-community/sqlite so the
// SAME SQL from src/server/domain runs on Android with zero query changes.
// The Next server keeps better-sqlite3 (SqliteDb); this adapter is used only
// when the webview runs in solo mode on a device (see src/lib/mobile-mode.ts).
import type { Db } from "@/server/db/types";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);

export class CapSqliteDb implements Db {
  private dbName = "open-finance";
  private conn: Awaited<ReturnType<SQLiteConnection["createConnection"]>> | null = null;

  private async connection() {
    if (this.conn) return this.conn;
    await sqlite.checkConnectionsConsistency();
    // v8 API: retrieveConnection(database, readonly) returns the connection
    // directly; it throws if the connection does not exist yet.
    try {
      this.conn = await sqlite.retrieveConnection(this.dbName, false);
    } catch {
      this.conn = await sqlite.createConnection(this.dbName, false, "no-encryption", 1, false);
      await this.conn.open();
    }
    return this.conn;
  }

  /**
   * Apply pending migrations (version-tracked via _migrations, mirroring
   * migrations/up.js). Idempotent: already-applied versions are skipped, so a
   * re-run on an existing solo DB is a no-op. Splits each file on ';' — the
   * schema has no triggers/views (asserted in tests/migrations-bundle.test.ts).
   */
  async migrate(migrations: { version: number; sql: string }[]): Promise<{ applied: number; current: number }> {
    const conn = await this.connection();
    await conn.execute(
      "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    );
    const rows = await conn.query("SELECT version FROM _migrations");
    const applied = new Set((rows.values ?? []).map((r) => Number((r as { version: number }).version)));

    let count = 0;
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      if (applied.has(m.version)) continue;
      await conn.beginTransaction();
      try {
        for (const stmt of m.sql.split(";")) {
          const trimmed = stmt.trim();
          if (!trimmed) continue;
          await conn.execute(trimmed);
        }
        await conn.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [
          m.version,
          new Date().toISOString(),
        ]);
        await conn.commitTransaction();
      } catch (e) {
        await conn.rollbackTransaction();
        throw e;
      }
      count++;
    }
    await sqlite.saveToStore(this.dbName);
    const currentRows = await conn.query("SELECT COALESCE(MAX(version), 0) AS v FROM _migrations");
    const current = Number((currentRows.values?.[0] as { v: number } | undefined)?.v ?? 0);
    return { applied: count, current };
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
    return { changes: r.changes?.changes ?? 0, lastInsertRowid: Number(r.changes?.lastId ?? 0) };
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
