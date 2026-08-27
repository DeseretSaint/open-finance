/**
 * Db registry — lets the SAME domain services run with either the server's
 * better-sqlite3 SqliteDb or the phone's CapSqliteDb (P8b solo), without the
 * services importing either implementation.
 *
 * - Server: adapter.ts registers the SqliteDb provider at module load.
 * - Solo webview: solo-router.ts registers the CapSqliteDb provider.
 *
 * Domain services call getDb() and never import better-sqlite3, so the webview
 * bundle stays free of the native module.
 */
import type { Db } from "@/server/db/types";

export type { Db } from "@/server/db/types";

type DbProvider = () => Db;

let provider: DbProvider | null = null;

export function registerDbProvider(p: DbProvider): void {
  provider = p;
}

export function getDb(): Db {
  if (!provider) {
    throw new Error("No Db provider registered — import @/server/db/adapter (server) or the solo router (webview).");
  }
  return provider();
}


