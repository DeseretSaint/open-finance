import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  accentForeground,
  accentText,
  contrastRatio,
  mix,
  normalizeAccent,
} from "@/lib/accents";

// Blend an alpha-soft background onto a solid base (matches rgb(... / a) usage).
function blend(fg: string, bg: string, alpha: number): string {
  return mix(fg, bg, alpha);
}

const AA = 4.5;
const WHITE = "#ffffff";
const DARK_SURFACE = "#1c1917";
const DARK_MUTED = "#292524";
const LIGHT_BG = "#fafaf9";
const LIGHT_SURFACE_MUTED = "#f5f5f4";

describe("accent contrast (WCAG AA)", () => {
  it("every preset accent gets a ≥4.5:1 foreground on solid accent", () => {
    for (const a of ACCENTS) {
      expect(contrastRatio(accentForeground(a), a), `foreground on ${a}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("accent-as-text passes AA on light surfaces", () => {
    for (const a of ACCENTS) {
      const t = accentText(a, false);
      expect(contrastRatio(t, WHITE), `${a} on white`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(t, LIGHT_BG), `${a} on background`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("accent-as-text passes AA on dark surfaces", () => {
    for (const a of ACCENTS) {
      const t = accentText(a, true);
      expect(contrastRatio(t, DARK_SURFACE), `${a} on surface`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(t, DARK_MUTED), `${a} on surface-muted`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("custom (color-picker) accents also clear AA in both roles", () => {
    // Mid-tone custom colors are the hard case — the pure-black fallback
    // in accentForeground exists exactly for them.
    for (const c of ["#808080", "#777777", "#888888", "#123456", "#c0ffee", "#a1b2c3"]) {
      expect(contrastRatio(accentForeground(c), c), `foreground on ${c}`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(accentText(c, false), WHITE), `${c} text on white`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(accentText(c, true), DARK_SURFACE), `${c} text on dark`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("legacy presets migrate to same-hue AA variants", () => {
    expect(normalizeAccent("#6366F1")).toBe("#4F46E5");
    expect(normalizeAccent("#8B5CF6")).toBe("#7C3AED");
    expect(normalizeAccent(null)).toBe("#10B981");
    expect(normalizeAccent("#bogus")).toBe("#10B981");
    expect(normalizeAccent("#10B981")).toBe("#10B981");
    expect(normalizeAccent("#c0ffee")).toBe("#c0ffee"); // valid custom kept
  });
});

describe("status token contrast (WCAG AA)", () => {
  // Soft backgrounds are rgb(token / alpha) over the surface — blend to test.
  it("light-mode status text passes on its soft background and plain surfaces", () => {
    const cases: Array<[fg: string, softBase: string, alpha: number]> = [
      ["#166534", "#16a34a", 0.12], // success
      ["#92400e", "#d97706", 0.12], // warning
      ["#b91c1c", "#dc2626", 0.1], // danger
    ];
    for (const [fg, base, alpha] of cases) {
      expect(contrastRatio(fg, blend(base, WHITE, alpha)), `${fg} on soft`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(fg, WHITE), `${fg} on white`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(fg, LIGHT_SURFACE_MUTED), `${fg} on surface-muted`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("dark-mode status text passes on dark surfaces", () => {
    const cases: Array<[fg: string, softBase: string, alpha: number]> = [
      ["#4ade80", "#16a34a", 0.12], // success
      ["#f59e0b", "#d97706", 0.1], // warning
      ["#f87171", "#dc2626", 0.1], // danger
    ];
    for (const [fg, base, alpha] of cases) {
      expect(contrastRatio(fg, DARK_SURFACE), `${fg} on surface`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(fg, DARK_MUTED), `${fg} on surface-muted`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(fg, blend(base, DARK_SURFACE, alpha)), `${fg} on soft`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("danger-button foreground passes on the danger background in both modes", () => {
    expect(contrastRatio("#ffffff", "#b91c1c")).toBeGreaterThanOrEqual(AA); // light danger bg
    expect(contrastRatio("#450a0a", "#f87171")).toBeGreaterThanOrEqual(AA); // dark danger bg
  });

  it("text-muted passes AA on light surfaces", () => {
    expect(contrastRatio("#6f6a65", LIGHT_SURFACE_MUTED)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#6f6a65", WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#6f6a65", LIGHT_BG)).toBeGreaterThanOrEqual(AA);
  });
});
