import { afterEach, describe, expect, it } from "vitest";
import { isSoloCandidate, resolveMobileMode } from "@/lib/mobile-mode";

type GlobalWithCap = typeof globalThis & {
  Capacitor?: { isNativePlatform?: () => boolean };
};

const g = globalThis as GlobalWithCap;

function setNative(native: boolean) {
  g.Capacitor = { isNativePlatform: () => native };
}

afterEach(() => {
  delete (g as Record<string, unknown>).Capacitor;
});

describe("mobile mode detection (P8b)", () => {
  it("plain web (no Capacitor) is always connected", async () => {
    delete (g as Record<string, unknown>).Capacitor;
    expect(await resolveMobileMode("https://my-hub.example.com", null)).toBe("connected");
    expect(isSoloCandidate("https://my-hub.example.com")).toBe(false);
  });

  it("native without a stored hub URL → solo", async () => {
    setNative(true);
    expect(await resolveMobileMode("capacitor://localhost", null)).toBe("solo");
    expect(isSoloCandidate("capacitor://localhost")).toBe(true);
  });

  it("native bundled app on http(s)://localhost → solo (the P8b webview default)", async () => {
    setNative(true);
    expect(await resolveMobileMode("https://localhost", null)).toBe("solo");
    expect(isSoloCandidate("https://localhost")).toBe(true);
    expect(isSoloCandidate("http://localhost")).toBe(true);
    expect(isSoloCandidate("http://127.0.0.1")).toBe(true);
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
