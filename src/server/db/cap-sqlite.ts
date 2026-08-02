// CapSqliteDb — phone-solo Db implementation (P8b).
// Implements the shared Db interface over @capacitor-community/sqlite so the
// SAME SQL from src/server/domain runs on Android with zero query changes.
// The Next server keeps better-sqlite3 (SqliteDb); this adapter is used only
// when the webview runs in solo mode on a device (see src/lib/mobile-mode.ts).
//
// TRANSACTION MODEL (critical, learned the hard way):
// cap-sqlite's Connection.run() and Connection.execute() both default to
// transaction=true — they wrap themselves in a BEGIN/COMMIT. That breaks two
// patterns used by the domain layer:
//   - db.transaction(fn) (bootstrap, budgets.create, …) calls
//     conn.beginTransaction() and then db.run(...) inside fn → the inner
//     run's own BEGIN throws "Already in transaction" and rolls back the
//     outer transaction (the v1.4/v1.5 on-device bugs).
// So: run/execute are ALWAYS called with transaction=false here. Standalone
// statements autocommit; db.transaction(fn) is the single transaction layer.
import type { Db } from "@/server/db/types";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);

/**
 * Split a migration file's SQL into individual statements, respecting `--`
 * line comments. The naive `sql.split(";")` breaks when a comment contains a
 * semicolon (migration 005's prose had one) — the comment text then becomes
 * part of the next statement and SQLite throws "near ...: syntax error".
 * This strips `-- ...` comments line-by-line first, then splits on `;`.
 * The migration schema is plain DDL (no triggers/views/strings — asserted in
 * tests/migrations-bundle.test.ts), so a line-based strip is safe.
 */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
  return withoutComments.split(";");
}

export class CapSqliteDb implements Db {
  private dbName = "open-finance";
  private conn: Awaited<ReturnType<SQLiteConnection["createConnection"]>> | null = null;

  private async connection() {
    if (this.conn) return this.conn;
    // Defensive: on first run there are no connections yet — the consistency
    // check can throw on some native versions; it's advisory, not required.
    try {
      await sqlite.checkConnectionsConsistency();
    } catch {
      // ignore — we handle missing connections below
    }
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
   *
   * Each statement runs with transaction=false (autocommit) — never nested
   * inside an outer transaction. If a statement fails because its table
   * already exists (partial/upgraded DB), we tolerate it and continue.
   *
   * Self-healing: if a migration version is recorded but its tables are
   * actually missing (e.g. a previous build rolled the DDL back), the version
   * is re-applied — recorded versions are only trusted when a sentinel table
   * from that migration exists.
   */
  async migrate(migrations: { version: number; sql: string }[]): Promise<{ applied: number; current: number }> {
    const conn = await this.connection();
    await conn.execute("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)", false);
    const rows = await conn.query("SELECT version FROM _migrations");
    const applied = new Set((rows.values ?? []).map((r) => Number((r as { version: number }).version)));

    // Sentinel tables per migration — used to re-apply versions whose DDL was
    // rolled back by a broken build. Map version → first table it creates.
    // IMPORTANT: only CREATE TABLE migrations get a sentinel. ALTER/UPDATE-only
    // migrations (003 onboarding, 004 notifications, 005 sign flip) have no
    // table to check, so a recorded version is ALWAYS trusted — re-applying
    // them would throw "duplicate column" / double-flip signs.
    const sentinels: Record<number, string> = {};
    for (const m of migrations) {
      const create = m.sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z_]+)/i);
      if (create) sentinels[m.version] = create[1];
    }

    let count = 0;
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      const sentinel = sentinels[m.version];

      // Recorded versions are trusted — UNLESS the migration creates tables
      // and its sentinel table is actually missing (previous build rolled the
      // DDL back). Migrations without a sentinel (ALTER/UPDATE) are trusted
      // unconditionally once recorded: there is no existence check, and
      // re-running them corrupts the schema (duplicate columns, flipped signs).
      if (applied.has(m.version)) {
        let reallyApplied = true;
        if (sentinel) {
          const check = await conn.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            [sentinel]
          );
          reallyApplied = (check.values ?? []).length > 0;
        }
        if (reallyApplied) continue;
        // Version recorded but DDL missing (broken previous build) — re-apply.
        await conn.run("DELETE FROM _migrations WHERE version = ?", [m.version], false);
      }

      for (const stmt of splitStatements(m.sql)) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;
        try {
          await conn.execute(trimmed, false);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/already exists|duplicate column/i.test(msg)) {
            // Schema from this migration already present (upgraded/partial DB
            // or a previous buggy build deleted the version record). The
            // migration's intent is satisfied — tolerate and continue.
            continue;
          }
          throw e;
        }
      }
      await conn.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ], false);
      count++;
    }
    try {
      await sqlite.saveToStore(this.dbName);
    } catch {
      // saveToStore is a persistence hint; the DB is already usable in-memory.
    }
    const currentRows = await conn.query("SELECT COALESCE(MAX(version), 0) AS v FROM _migrations");
    const current = Number((currentRows.values?.[0] as { v: number } | undefined)?.v ?? 0);
    return { applied: count, current };
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const conn = await this.connection();
    // cap-sqlite v8 accepts (string|number|null)[] directly — do NOT String()
    // params (String(null) === "null" corrupts nullable columns).
    const values = params.map((p) => (p === undefined ? null : p));
    const r = await conn.query(sql, values);
    return (r.values ?? []) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows[0];
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const conn = await this.connection();
    const values = params.map((p) => (p === undefined ? null : p));
    // transaction=false: autocommit when standalone, joins the outer
    // transaction when called inside db.transaction(fn).
    const r = await conn.run(sql, values, false);
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
      try {
        await conn.rollbackTransaction();
      } catch {
        // no active transaction — nothing to roll back
      }
      throw e;
    }
  }
}
