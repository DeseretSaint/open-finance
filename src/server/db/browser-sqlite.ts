"use client";

/**
 * BrowserSqliteDb — plain-browser solo Db implementation (PWA / GitHub Pages).
 *
 * Implements the shared Db interface over sql.js (pure WebAssembly SQLite) so
 * the SAME SQL from src/server/domain runs in a normal phone/desktop browser
 * with zero query changes and NO native layer. This is what lets the solo app
 * run as a Ghostway-style web app: open the URL, it works standalone.
 *
 * Why sql.js and not wa-sqlite: wa-sqlite's persistent OPFS VFS needs
 * SharedArrayBuffer, which requires COOP/COEP headers that GitHub Pages does
 * not send. sql.js needs no special headers and runs in every modern browser.
 *
 * Persistence: sql.js is in-memory. After each write we (debounced) export the
 * whole database to a Uint8Array and store it in IndexedDB; on open we load it
 * back. A personal-finance DB is small, so whole-file export is fine. We also
 * flush synchronously on transaction commit and on page hide/unload.
 *
 * TRANSACTION MODEL: mirrors CapSqliteDb — standalone statements autocommit;
 * db.transaction(fn) is the single explicit transaction layer (BEGIN/COMMIT).
 */
import type { Db } from "@/server/db/types";
import { splitStatements } from "@/server/db/cap-sqlite";

// sql.js ships a UMD build that bundlers can consume. The wasm binary is
// served from public/sql-wasm.wasm (copied in by scripts/build-mobile.mjs) and
// located via locateFile so it works under any basePath (GitHub Pages subpath).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlJsModule = any;

const IDB_NAME = "open-finance-solo";
const IDB_STORE = "db";
const IDB_KEY = "sqlite";
const SAVE_DEBOUNCE_MS = 400;

// Cross-tab sync: every successful IndexedDB save is announced on this channel
// so other open tabs reload the bytes from IDB instead of clobbering each other.
// Without this, two tabs each keep an in-memory copy and the LAST one to flush
// silently overwrites the other tab's writes (data-integrity bug).
const SYNC_CHANNEL = "open-finance-solo-db";

let sqlJsPromise: Promise<SqlJsModule> | null = null;

// Monotonic logical clock shared across all instances in this tab. Incremented
// on every save we perform and on every remote save we accept, so we can tell
// whether an incoming update is newer than what we last saw (and drop echoes).
let syncSeq = 0;
const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * Pure decision: should this tab adopt a remote DB update?
 * Adopt only when the message is from ANOTHER tab, is strictly newer than the
 * last seq we saw, and we have NO pending local writes (a pending debounce
 * means our in-memory copy is ahead of what's in IDB — keep ours, it flushes
 * soon and would otherwise be discarded).
 */
export function syncShouldAdopt(
  msg: { tabId?: string; seq?: number } | null,
  tabId: string,
  lastSeq: number,
  hasPendingWrite: boolean
): boolean {
  if (!msg) return false;
  if (msg.tabId === tabId) return false;
  if (typeof msg.seq !== "number" || msg.seq <= lastSeq) return false;
  if (hasPendingWrite) return false;
  return true;
}

function wasmUrl(): string {
  // basePath is inlined at build time (empty for the APK/root builds).
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}/sql-wasm.wasm`;
}

async function loadSqlJs(): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      // Dynamic import keeps sql.js out of the server bundle entirely.
      // SAFETY: sql.js default export is the initSqlJs factory (UMD interop).
      const mod = await import("sql.js");
      // SAFETY: UMD interop boundary — the sql.js module object is either
      // { default: factory } or the factory itself; the ?? below handles both.
      const initSqlJs = (mod as unknown as { default?: unknown }).default ?? mod;
      // SAFETY: initSqlJs is the factory function exported by sql.js.
      const init = initSqlJs as (opts: { locateFile: (f: string) => string }) => Promise<SqlJsModule>;
      return init({ locateFile: (file: string) => (file.endsWith(".wasm") ? wasmUrl() : file) });
    })();
  }
  return sqlJsPromise;
}

// ---- IndexedDB persistence helpers (raw API, no dependency) ----

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function idbLoad(): Promise<Uint8Array | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        const v = req.result;
        // SAFETY: this store only ever holds our own DB exports (Uint8Array);
        // some browsers hand back the same bytes as an ArrayBuffer, so after
        // the instanceof check a truthy remainder is an ArrayBuffer by storage
        // invariant.
        resolve(v instanceof Uint8Array ? v : v ? new Uint8Array(v as ArrayBuffer) : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSave(bytes: Uint8Array): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB save failed"));
    });
  } catch {
    // Persistence is best-effort; the in-memory DB is still authoritative for
    // this session. A failed save just risks losing the latest writes on reload.
  }
}

// Lazily create the cross-tab BroadcastChannel (browser only). Returns null in
// non-browser contexts (SSR / node tests) so the sync path is a no-op.
let channelSingleton: BroadcastChannel | null | undefined = undefined;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (channelSingleton !== undefined) return channelSingleton;
  channelSingleton = new BroadcastChannel(SYNC_CHANNEL);
  return channelSingleton;
}

export class BrowserSqliteDb implements Db {
  // SAFETY: sql.js Database instance; typed any because sql.js ships no TS types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private SQL: SqlJsModule | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushListenersInstalled = false;

  private async connection() {
    if (this.db) return this.db;
    this.SQL = await loadSqlJs();
    const saved = await idbLoad();
    // SAFETY: new SQL.Database(existingBytes) restores a saved database.
    this.db = saved ? new this.SQL.Database(saved) : new this.SQL.Database();
    this.installFlushListeners();
    return this.db;
  }

  /** Flush pending writes to IndexedDB immediately (transaction commit, unload). */
  async flush(): Promise<void> {
    if (!this.db) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      // SAFETY: sql.js Database.export() serializes the database to a
      // Uint8Array (sql.js API contract).
      const bytes = this.db.export() as Uint8Array;
      await idbSave(bytes);
      // Announce the save so other tabs reload from IDB instead of clobbering us.
      syncSeq += 1;
      getChannel()?.postMessage({ tabId: TAB_ID, seq: syncSeq });
    } catch {
      // best-effort
    }
  }

  /** Schedule a debounced persistence pass after a write. */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  private installFlushListeners(): void {
    if (this.flushListenersInstalled) return;
    this.flushListenersInstalled = true;
    if (typeof window === "undefined") return;
    // Persist when the tab is hidden or the page is going away.
    window.addEventListener("pagehide", () => void this.flush());
    window.addEventListener("beforeunload", () => void this.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flush();
    });
    // Adopt other tabs' saves so two tabs don't clobber each other's writes.
    const ch = getChannel();
    if (ch) {
      ch.onmessage = (ev: MessageEvent) => {
        void this.onRemoteUpdate(ev.data);
      };
    }
  }

  /**
   * A different tab announced a DB save. Reload the bytes from IndexedDB into
   * memory — but only when we have NO pending local writes (a pending debounce
   * means our in-memory copy is ahead of what's persisted, and adopting now
   * would discard those writes; it flushes shortly). Echoes and stale seqs are
   * ignored via syncShouldAdopt + the shared syncSeq clock.
   */
  private async onRemoteUpdate(msg: { tabId?: string; seq?: number }): Promise<void> {
    if (!syncShouldAdopt(msg, TAB_ID, syncSeq, this.saveTimer !== null)) return;
    // SAFETY: syncShouldAdopt above verified typeof msg.seq === "number"
    // (and seq > lastSeq) before we get here.
    syncSeq = msg.seq as number;
    if (!this.db || !this.SQL) return;
    try {
      const bytes = await idbLoad();
      if (bytes) this.db = new this.SQL.Database(bytes);
    } catch {
      // best-effort
    }
  }

  /**
   * Apply pending migrations — same version-tracked, self-healing logic as
   * CapSqliteDb.migrate so a browser solo DB and a device solo DB stay
   * schema-identical. Idempotent.
   */
  async migrate(migrations: { version: number; sql: string }[]): Promise<{ applied: number; current: number }> {
    const db = await this.connection();
    db.run("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");

    // SAFETY: the query selects exactly one INTEGER column (version).
    const appliedRows = this.execRows("SELECT version FROM _migrations") as { version: number }[];
    const applied = new Set(appliedRows.map((r) => Number(r.version)));

    const sentinels: Record<number, string> = {};
    for (const m of migrations) {
      const create = m.sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z_]+)/i);
      if (create) sentinels[m.version] = create[1];
    }

    let count = 0;
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      const sentinel = sentinels[m.version];
      if (applied.has(m.version)) {
        let reallyApplied = true;
        if (sentinel) {
          const check = this.execRows(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            [sentinel]
          );
          reallyApplied = check.length > 0;
        }
        if (reallyApplied) continue;
        db.run("DELETE FROM _migrations WHERE version = ?", [m.version]);
      }

      for (const stmt of splitStatements(m.sql)) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;
        try {
          db.run(trimmed);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/already exists|duplicate column/i.test(msg)) continue;
          throw e;
        }
      }
      db.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ]);
      count++;
    }
    await this.flush();
    // SAFETY: the query selects exactly one aliased INTEGER column (v);
    // COALESCE guarantees one row.
    const cur = this.execRows("SELECT COALESCE(MAX(version), 0) AS v FROM _migrations") as { v: number }[];
    const current = Number(cur[0]?.v ?? 0);
    return { applied: count, current };
  }

  /** Run a query and return object rows (columns zipped with values). */
  // SAFETY: sql.js prepare/step/getAsObject returns plain row objects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private execRows(sql: string, params: unknown[] = []): any[] {
    const db = this.db;
    const stmt = db.prepare(sql);
    try {
      if (params.length) stmt.bind(params);
      const rows: unknown[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    await this.connection();
    const values = params.map((p) => (p === undefined ? null : p));
    // SAFETY: execRows returns plain sql.js row objects; T is the caller's
    // row contract at the Db-interface boundary (default Record<string, unknown>).
    return this.execRows(sql, values) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...params);
    return rows[0];
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const db = await this.connection();
    const values = params.map((p) => (p === undefined ? null : p));
    db.run(sql, values);
    const changes = typeof db.getRowsModified === "function" ? Number(db.getRowsModified()) : 0;
    // SAFETY: the query selects exactly one aliased INTEGER column (id).
    const lastRows = this.execRows("SELECT last_insert_rowid() AS id") as { id: number }[];
    const lastInsertRowid = Number(lastRows[0]?.id ?? 0);
    this.scheduleSave();
    return { changes, lastInsertRowid };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = await this.connection();
    db.run("BEGIN");
    try {
      const result = await fn();
      db.run("COMMIT");
      await this.flush();
      return result;
    } catch (e) {
      try {
        db.run("ROLLBACK");
      } catch {
        // no active transaction — nothing to roll back
      }
      throw e;
    }
  }
}
