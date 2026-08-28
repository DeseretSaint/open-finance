"use strict";
// Migration runner: applies migrations/00N_*.sql in order, tracked via
// the _migrations table (+ PRAGMA user_version for compatibility).
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function runMigrations(db, dir = __dirname) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  db.pragma("journal_mode = WAL");
  // Enforce FK constraints during migration application too (matches the
  // SqliteDb adapter); no migration inserts child rows without parents.
  db.pragma("foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
  );

  const applied = new Set(
    db.prepare("SELECT version FROM _migrations").all().map((r) => r.version)
  );

  let count = 0;
  for (const f of files) {
    const version = parseInt(f, 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString()
      );
    })();
    db.pragma(`user_version = ${version}`);
    count++;
  }

  const current = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM _migrations").get().v;
  return { applied: count, current };
}

module.exports = { runMigrations };

if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH || "./data/open-finance.db";
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const r = runMigrations(db);
  console.log(`migrations applied: ${r.applied}, current version: ${r.current} (${dbPath})`);
  db.close();
}
