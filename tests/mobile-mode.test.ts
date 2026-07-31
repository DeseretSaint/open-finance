import { afterEach, describe, expect, it } from "vitest";
import { isSoloCandidate, resolveMobileMode } from "@/lib/mobile-mode";

type GlobalWithCap = typeof globalThis & {
  Capacitor?: { isNativePlatform?: () => boolean };
  Keystore?: { getHubUrl: (opts: unknown) => Promise<{ url: string | null }> };
};

function setNative(native: boolean) {
  (globalThis as GlobalWithCap).Capacitor = native
    ? { isNativePlatform: () => true }
    : { isNativePlatform: () => false };
}

afterEach(() => {
  delete (globalThis as GlobalWithCap).Capacitor;
  delete (globalThis as GlobalWithCap).Keystore;
});

describe("mobile mode detection (P8b)", () => {
  it("plain web (no Capacitor) is always connected", async () => {
    delete (globalThis as GlobalWithCap).Capacitor;
    expect(await resolveMobileMode("https://my-hub.example.com", null)).toBe("connected");
    expect(isSoloCandidate("https://my-hub.example.com")).toBe(false);
  });

  it("native without a stored hub URL → solo", async () => {
    setNative(true);
    expect(await resolveMobileMode("capacitor://localhost", null)).toBe("solo");
    expect(isSoloCandidate("capacitor://localhost")).toBe(true);
  });

  it("native pointed at a stored hub URL → connected", async () => {
    setNative(true);
    expect(
      await resolveMobileMode("http://100.101.147.65:3000", "http://100.101.147.65:3000")
    ).toBe("connected");
    // http origin on native is not a solo candidate
    expect(isSoloCandidate("http://100.101.147.65:3000")).toBe(false);
  });

  it("native with a mismatched stored hub URL → solo", async () => {
    setNative(true);
    expect(
      await resolveMobileMode("capacitor://localhost", "http://100.101.147.65:3000")
    ).toBe("solo");
  });
});
