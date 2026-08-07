/**
 * Server-only env bootstrap. NEVER imported from client code — it uses
 * node:fs / node:path, which the browser bundle can't include.
 *
 * Open Finance must boot even when the operator hasn't hand-provisioned
 * ENCRYPTION_KEY / AUTH_SECRET (the previous hard-throw at module load bricked
 * the whole app for anyone running `pnpm start` without a .env). If either key
 * is missing we generate a stable random value and persist it to
 * `data/.env.keys` so restarts don't invalidate existing encrypted data or
 * sessions. `src/lib/env` still validates without throwing; this only fills in
 * the gap at server start.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/lib/env";

export function bootstrapServerEnv(): void {
  if (typeof process === "undefined" || !process.env) return;

  const KEY_FILE = join(process.cwd(), "data", ".env.keys");

  const existing: Record<string, string> = {};
  try {
    if (existsSync(KEY_FILE)) {
      const text = readFileSync(KEY_FILE, "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) existing[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* ignore read errors — we'll just (re)generate */
  }

  const ensure = (name: "ENCRYPTION_KEY" | "AUTH_SECRET") => {
    const fromEnv = process.env[name];
    const fromFile = existing[name];
    const value = fromEnv && fromEnv.length > 0 ? fromEnv : fromFile && fromFile.length > 0 ? fromFile : randomBytes(32).toString("base64");
    process.env[name] = value;
    if (!fromEnv || fromEnv.length === 0) existing[name] = value;
  };

  ensure("ENCRYPTION_KEY");
  ensure("AUTH_SECRET");

  // Reflect onto the live env object (captured at module load) too.
  env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "";
  env.AUTH_SECRET = process.env.AUTH_SECRET ?? "";

  try {
    if (!existsSync(KEY_FILE)) {
      mkdirSync(join(process.cwd(), "data"), { recursive: true });
      const out = [
        "# Auto-generated Open Finance secrets — do not commit.",
        `ENCRYPTION_KEY=${existing.ENCRYPTION_KEY}`,
        `AUTH_SECRET=${existing.AUTH_SECRET}`,
        "",
      ].join("\n");
      writeFileSync(KEY_FILE, out, { mode: 0o600 });
      console.log("[env] Generated missing ENCRYPTION_KEY / AUTH_SECRET and saved to data/.env.keys");
    }
  } catch (e) {
    console.warn("[env] Could not persist generated keys (continuing in-memory):", e);
  }
}
