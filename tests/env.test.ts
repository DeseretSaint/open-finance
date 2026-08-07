import { afterEach, describe, expect, it, vi } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

const base: Record<string, string | undefined> = {
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  AUTH_SECRET: "abcdef0123456789abcdef0123456789",
  NODE_ENV: "test",
};

function toEnv(o: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return cleaned as unknown as NodeJS.ProcessEnv;
}

/** env.ts evaluates at module load; re-import after setting process.env. */
async function loadEnv(overrides: Record<string, string | undefined>) {
  process.env = toEnv({ ...base, ...overrides });
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.env as unknown as Record<string, string>;
}

afterEach(() => {
  vi.resetModules();
  // bootstrapServerEnv may have written a generated key file; don't leave it.
  try {
    unlinkSync(join(process.cwd(), "data", ".env.keys"));
  } catch {
    /* not present — fine */
  }
});

describe("env", () => {
  it("loads a valid environment with defaults", async () => {
    const e = await loadEnv({});
    expect(e.ENCRYPTION_KEY).toBe(base.ENCRYPTION_KEY);
    expect(e.BIND_ADDRESS).toBe("127.0.0.1");
    expect(e.DEMO_MODE).toBe(false);
    expect(e.DATABASE_PATH).toBe("./data/open-finance.db");
  });

  it("parses DEMO_MODE=true", async () => {
    const e = await loadEnv({ DEMO_MODE: "true" });
    expect(e.DEMO_MODE).toBe(true);
  });

  it("auto-generates missing keys via server bootstrap instead of throwing", async () => {
    // Clear both required keys; bootstrapServerEnv must NOT throw and must
    // generate non-empty keys so the app can boot (the old hard-throw used to
    // brick every route).
    process.env = toEnv({ NODE_ENV: "test" });
    vi.resetModules();
    const { bootstrapServerEnv } = await import("@/server/env-bootstrap");
    bootstrapServerEnv();
    expect(typeof process.env.ENCRYPTION_KEY).toBe("string");
    expect((process.env.ENCRYPTION_KEY ?? "").length).toBeGreaterThan(0);
    expect(typeof process.env.AUTH_SECRET).toBe("string");
    expect((process.env.AUTH_SECRET ?? "").length).toBeGreaterThan(0);
  });

  it("accepts an empty/short encryption key without throwing", async () => {
    // The old behavior rejected short keys at module load. Now we degrade
    // gracefully (encryption still works, just weaker) rather than 500-ing.
    process.env = toEnv({ ...base, ENCRYPTION_KEY: "" });
    vi.resetModules();
    const mod = await import("@/lib/env");
    expect(mod.env).toBeTruthy();
  });
});
