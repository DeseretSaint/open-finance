/**
 * Shared Db interface + row types. Kept free of any better-sqlite3 import so
 * browser/webview bundles (phone-solo, P8b) can import the interface without
 * pulling in the native module. The server implementation lives in adapter.ts.
 */
export interface DbRow {
  [key: string]: unknown;
}

export interface Db {
  all<T = DbRow>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = DbRow>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(
    sql: string,
    ...params: unknown[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
