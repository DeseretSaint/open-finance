import { afterEach, describe, expect, it, vi } from "vitest";

const base: Record<string, string | undefined> = {
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  AUTH_SECRET: "abcdef0123456789abcdef0123456789",
  NODE_ENV: "test",
};

function toEnv(o: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return o as unknown as NodeJS.ProcessEnv;
}

/** env.ts evaluates at module load; re-import after setting process.env. */
async function loadEnv(overrides: Record<string, string | undefined>) {
  process.env = toEnv({ ...base, ...overrides });
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.env as unknown as Record<string, unknown>;
}

afterEach(() => {
  vi.resetModules();
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

  it("throws when required keys are missing", async () => {
    process.env = toEnv({ AUTH_SECRET: base.AUTH_SECRET, NODE_ENV: "test" });
    vi.resetModules();
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("rejects short encryption keys", async () => {
    process.env = toEnv({ ...base, ENCRYPTION_KEY: "" });
    vi.resetModules();
    await expect(import("@/lib/env")).rejects.toThrow();
  });
});
