#!/usr/bin/env node
"use strict";
/**
 * Generate src/server/db/migrations-bundle.ts from migrations/*.sql.
 * Run: node scripts/gen-migrations-bundle.mjs [--check]
 * --check exits non-zero if the committed bundle is stale (CI gate).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const OUT = path.join(__dirname, "..", "src", "server", "db", "migrations-bundle.ts");

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function build() {
  const files = listMigrations();

  const entries = files.map((f) => {
    const version = parseInt(f, 10);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    return `  {\n    version: ${version},\n    sql: ${JSON.stringify(sql)},\n  }`;
  });

  const header = `"use client";

/**
 * Migration bundle (P8b solo) — GENERATED FILE, DO NOT EDIT.
 * Run \`node scripts/gen-migrations-bundle.mjs\` after changing migrations/.
 * The phone has no filesystem access to migrations/*.sql at runtime, so the
 * schema SQL is embedded here at build time. CapSqliteDb.migrate() splits on
 * ';' — the schema has no triggers, so that is safe.
 */

export const SOLO_MIGRATIONS: { version: number; sql: string }[] = [
${entries.join(",\n")}
];
`;

  return header;
}

const content = build();
const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;

if (process.argv.includes("--check")) {
  if (existing !== content) {
    console.error("migrations-bundle.ts is stale — run node scripts/gen-migrations-bundle.mjs");
    process.exit(1);
  }
  console.log("migrations-bundle.ts is up to date.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, content);
console.log(`wrote ${OUT} (${listMigrations().length} migrations)`);
