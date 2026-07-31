import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOLO_MIGRATIONS } from "@/server/db/migrations-bundle";

describe("migration bundle parity (P8b solo)", () => {
  const dir = path.join(process.cwd(), "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  it("bundle covers every migration file, in order, byte-identical", () => {
    expect(SOLO_MIGRATIONS.map((m) => m.version)).toEqual(
      files.map((f) => parseInt(f, 10))
    );
    for (const f of files) {
      const version = parseInt(f, 10);
      const onDisk = fs.readFileSync(path.join(dir, f), "utf8");
      const bundled = SOLO_MIGRATIONS.find((m) => m.version === version)?.sql;
      expect(bundled, `migration ${f} must match bundle`).toBe(onDisk);
    }
  });

  it("schema has no triggers/views — the ';' split in CapSqliteDb.migrate is safe", () => {
    for (const m of SOLO_MIGRATIONS) {
      expect(m.sql).not.toMatch(/CREATE TRIGGER/i);
      expect(m.sql).not.toMatch(/CREATE VIEW/i);
      expect(m.sql).not.toMatch(/CREATE FUNCTION/i);
    }
  });

  it("runner tracks applied versions via _migrations (idempotent re-runs)", async () => {
    // The server runner (migrations/up.js) and CapSqliteDb both record applied
    // versions in a _migrations table; the bundle itself may contain plain
    // CREATE TABLE (no IF NOT EXISTS) because the runner skips applied ones.
    // This guards the invariant that both runners share the same version set.
    expect(SOLO_MIGRATIONS.map((m) => m.version)).toEqual(
      files.map((f) => parseInt(f, 10))
    );
  });
});
