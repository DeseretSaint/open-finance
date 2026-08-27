// Accent palette + WCAG-AA contrast machinery.
// The 8 presets carry hand-verified pairs (asserted in tests/contrast.test.ts);
// user-picked custom colors get the same guarantees computed at runtime.

export const ACCENTS = [
  "#10B981", // emerald (default)
  "#4F46E5", // indigo
  "#F59E0B", // amber
  "#EF4444", // red
  "#7C3AED", // violet
  "#06B6D4", // cyan
  "#EC4899", // pink
  "#0EA5E9", // sky
] as const;

export type Accent = (typeof ACCENTS)[number];

// Pre-2026-08 presets swapped for AA-compliant variants; migrate stored
// selections so existing installs keep the same hue family.
export const LEGACY_ACCENTS: Record<string, string> = {
  "#6366F1": "#4F46E5", // old indigo (white-on-it was 4.47:1)
  "#8B5CF6": "#7C3AED", // old violet (white-on-it was 4.23:1)
};

const AA = 4.5;
const LIGHT_TEXT_BG = "#ffffff"; // light-mode surfaces
const DARK_TEXT_BG = "#1c1917"; // dark-mode surface

// ── WCAG 2.1 math ────────────────────────────────────────────────────────
export function luminance(hex: string): number {
  const [r, g, b] = hex
    .replace("#", "")
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `t` fraction of color `a` with (1-t) of `b`. */
export function mix(a: string, b: string, t: number): string {
  const px = (h: string) => h.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16));
  const A = px(a);
  const B = px(b);
  return (
    "#" +
    A.map((v, i) =>
      Math.round(v * t + B[i] * (1 - t))
        .toString(16)
        .padStart(2, "0"),
    ).join("")
  );
}

// ── Verified preset pairs (tests assert every one) ──────────────────────
// Foreground text on SOLID accent backgrounds (primary buttons, ::selection).
const PRESET_FOREGROUNDS: Record<Accent, string> = {
  "#10B981": "#0c0a09",
  "#4F46E5": "#ffffff",
  "#F59E0B": "#0c0a09",
  "#EF4444": "#0c0a09",
  "#7C3AED": "#ffffff",
  "#06B6D4": "#0c0a09",
  "#EC4899": "#0c0a09",
  "#0EA5E9": "#0c0a09",
};
// Accent used AS TEXT on light surfaces (links, active nav labels).
const PRESET_TEXT_LIGHT: Record<Accent, string> = {
  "#10B981": "#047857",
  "#4F46E5": "#4F46E5",
  "#F59E0B": "#b45309",
  "#EF4444": "#b91c1c",
  "#7C3AED": "#7C3AED",
  "#06B6D4": "#0e7490",
  "#EC4899": "#be185d",
  "#0EA5E9": "#0369a1",
};
// Accent used AS TEXT on dark surfaces.
const PRESET_TEXT_DARK: Record<Accent, string> = {
  "#10B981": "#34d399",
  "#4F46E5": "#818cf8",
  "#F59E0B": "#fbbf24",
  "#EF4444": "#f87171",
  "#7C3AED": "#a78bfa",
  "#06B6D4": "#22d3ee",
  "#EC4899": "#f472b6",
  "#0EA5E9": "#38bdf8",
};

// ── Runtime resolvers (presets use the table; custom colors compute) ────
/** Foreground for text on a solid accent background. Always ≥ AA: the
 * better of white/near-black is ≥ sqrt(19.7) ≈ 4.44, and the pure-black
 * fallback covers the mid-tone edge (product of ratios = 21 → ≥ 4.58). */
export function accentForeground(accent: string): string {
  // SAFETY: accent arrives as an arbitrary string; table lookup is keyed only by Accent presets.
  const preset = PRESET_FOREGROUNDS[accent as Accent];
  if (preset) return preset;
  const rw = contrastRatio("#ffffff", accent);
  const rd = contrastRatio("#0c0a09", accent);
  if (Math.max(rw, rd) >= AA) return rw >= rd ? "#ffffff" : "#0c0a09";
  return contrastRatio("#000000", accent) >= rw ? "#000000" : "#ffffff";
}

/** Accent variant readable AS TEXT on the given mode's surfaces. Presets
 * use the verified table; custom colors are nudged toward black (light) or
 * white (dark) in 5% steps until they clear AA. */
export function accentText(accent: string, dark: boolean): string {
  // SAFETY: accent arrives as an arbitrary string; dark/light text tables keyed only by Accent presets.
  const preset = dark ? PRESET_TEXT_DARK[accent as Accent] : PRESET_TEXT_LIGHT[accent as Accent];
  if (preset) return preset;
  const bg = dark ? DARK_TEXT_BG : LIGHT_TEXT_BG;
  const toward = dark ? "#ffffff" : "#000000";
  if (contrastRatio(accent, bg) >= AA) return accent;
  for (let t = 0.95; t >= 0; t -= 0.05) {
    const c = mix(accent, toward, t);
    if (contrastRatio(c, bg) >= AA) return c;
  }
  return toward; // unreachable: pure black/white always clears AA on these bgs
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Resolve a stored accent: migrate legacy presets, keep any valid custom
 * hex, fall back to emerald for garbage. */
export function normalizeAccent(stored: string | null): string {
  if (!stored) return "#10B981";
  if (LEGACY_ACCENTS[stored]) return LEGACY_ACCENTS[stored];
  return HEX_RE.test(stored) ? stored : "#10B981";
}
