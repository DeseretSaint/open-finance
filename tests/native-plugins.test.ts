import { describe, expect, it } from "vitest";
import { ensureNativePlugins } from "@/lib/native-plugins";

describe("ensureNativePlugins (PlaidProxy/Keystore bridge)", () => {
  it("no-ops on plain web (no Capacitor bridge) without touching window", () => {
    const w = {} as unknown as Record<string, unknown>;
    (globalThis as unknown as { window: unknown }).window = w;
    ensureNativePlugins();
    expect(w.PlaidProxy).toBeUndefined();
    expect(w.Keystore).toBeUndefined();
  });

  it("bridges both plugins onto window when the native bridge exists", () => {
    const fakeCap = {
      registerPlugin: (name: string) => ({ __name: name }),
    };
    const w = { Capacitor: fakeCap } as unknown as Record<string, unknown>;
    (globalThis as unknown as { window: unknown }).window = w;
    ensureNativePlugins();
    expect((w.PlaidProxy as { __name: string }).__name).toBe("PlaidProxy");
    expect((w.Keystore as { __name: string }).__name).toBe("Keystore");
    // Idempotent — second call does not re-register or clobber.
    ensureNativePlugins();
    expect((w.PlaidProxy as { __name: string }).__name).toBe("PlaidProxy");
  });
});
