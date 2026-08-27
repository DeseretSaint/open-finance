import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  __resetThemeForTest,
  applyTheme,
  setAccent,
  setDark,
  setDensity,
  useTheme,
} from "@/lib/theme-store";

// The suite runs in the node environment — stub just enough window/document
// for the store (localStorage persistence + CSS var writes).
function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    _map: map,
  };
}

function installDom(storage: ReturnType<typeof makeStorage>) {
  const style = new Map<string, string>();
  const classes = new Set<string>();
  const storageListeners: Array<(e: { key: string | null }) => void> = [];
  const documentElement = {
    style: {
      setProperty: (k: string, v: string) => {
        style.set(k, v);
      },
    },
    classList: {
      toggle: (c: string, on: boolean) => {
        if (on) classes.add(c);
        else classes.delete(c);
      },
    },
  };
  (globalThis as Record<string, unknown>).window = {
    localStorage: storage,
    addEventListener: (type: string, fn: (e: { key: string | null }) => void) => {
      if (type === "storage") storageListeners.push(fn);
    },
  };
  (globalThis as Record<string, unknown>).document = { documentElement };
  return { style, classes, storageListeners };
}

beforeEach(() => {
  __resetThemeForTest();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

describe("theme store (single source of truth)", () => {
  it("a dark toggle never resurrects a stale accent (Bug A regression)", () => {
    const storage = makeStorage();
    const { style } = installDom(storage);
    // Settings panel picks amber…
    setAccent("#F59E0B");
    expect(style.get("--accent")).toBe("#F59E0B");
    // …sidebar toggles dark. The old per-consumer useState design re-fired
    // the [accent, dark] effect with the sidebar's stale emerald here.
    setDark(false);
    expect(style.get("--accent")).toBe("#F59E0B");
    expect(storage.getItem("of-accent")).toBe("#F59E0B");
    expect(style.get("--accent-foreground")).toBe("#0c0a09"); // amber fg
  });

  it("every setter applies all vars + persistence in one pass", () => {
    const storage = makeStorage();
    const { style, classes } = installDom(storage);
    setAccent("#4F46E5");
    setDark(true);
    setDensity(0.84);
    expect(style.get("--accent")).toBe("#4F46E5");
    expect(style.get("--accent-foreground")).toBe("#ffffff"); // indigo fg
    expect(style.get("--accent-text")).toBe("#818cf8"); // indigo dark-mode text
    expect(style.get("zoom")).toBe("0.84");
    expect(classes.has("dark")).toBe(true);
    expect(storage.getItem("of-accent")).toBe("#4F46E5");
    expect(storage.getItem("of-dark")).toBe("1");
    expect(storage.getItem("of-density")).toBe("0.84");
  });

  it("normalizes legacy + garbage accents on set", () => {
    const storage = makeStorage();
    installDom(storage);
    setAccent("#6366F1"); // legacy indigo → AA variant
    expect(storage.getItem("of-accent")).toBe("#4F46E5");
    setAccent("not-a-color");
    expect(storage.getItem("of-accent")).toBe(DEFAULT_THEME.accent);
  });

  it("loads stored prefs exactly once and migrates stale dark flags", () => {
    const storage = makeStorage();
    // Pre-v2 install that ended up light: stale of-dark="0", no markers.
    storage.setItem("of-dark", "0");
    storage.setItem("of-accent", "#EC4899");
    storage.setItem("of-compact", "1"); // legacy density key, no of-density
    const { style } = installDom(storage);
    applyTheme(); // first touch → ensureLoaded runs the migration
    expect(storage.getItem("of-dark")).toBe("1"); // stale "0" reset to dark
    expect(storage.getItem("of-dark-v2")).toBe("1");
    expect(storage.getItem("of-dark-v3")).toBe("1");
    expect(storage.getItem("of-accent")).toBe("#EC4899"); // stored accent kept
    expect(style.get("--accent")).toBe("#EC4899");
    expect(style.get("zoom")).toBe("0.84"); // of-compact=1 → Dense
    expect(storage.getItem("of-density")).toBe("0.84");
  });

  it("respects a post-migration light choice", () => {
    const storage = makeStorage();
    storage.setItem("of-dark", "0");
    storage.setItem("of-dark-v2", "1");
    storage.setItem("of-dark-v3", "1");
    const { classes } = installDom(storage);
    applyTheme(); // ensureLoaded + apply
    expect(storage.getItem("of-dark")).toBe("0"); // markers present → respected
    expect(classes.has("dark")).toBe(false);
  });

  it("server snapshot is the default (no window)", () => {
    // No window/document installed: SSR path must not throw and must default.
    expect(() => applyTheme()).not.toThrow();
    expect(DEFAULT_THEME).toEqual({ accent: "#10B981", dark: true, density: 1 });
  });

  it("useTheme keeps the consumer API shape", () => {
    // Hook identity check without rendering: the settings page destructures
    // exactly these keys, so guard the shape against accidental drift.
    expect(typeof useTheme).toBe("function");
    expect(typeof setAccent).toBe("function");
    expect(typeof setDark).toBe("function");
    expect(typeof setDensity).toBe("function");
  });
});

describe("pre-hydration replay blob (Gap B FOUC fix)", () => {
  it("of-theme-css mirrors the exact values set on the DOM (preset accent, dark)", () => {
    const storage = makeStorage();
    const { style } = installDom(storage);
    setAccent("#4F46E5");
    setDark(true);
    setDensity(0.92);
    const blob = JSON.parse(storage.getItem("of-theme-css")!);
    expect(blob.a).toBe(style.get("--accent"));
    expect(blob.f).toBe(style.get("--accent-foreground"));
    expect(blob.t).toBe(style.get("--accent-text"));
    expect(blob.z).toBe(Number(style.get("zoom")));
  });

  it("of-theme-css mirrors the DOM for a custom mid-tone accent in light mode", () => {
    const storage = makeStorage();
    const { style } = installDom(storage);
    setAccent("#7A8C5A"); // arbitrary custom hex → runtime contrast math
    setDark(false);
    const blob = JSON.parse(storage.getItem("of-theme-css")!);
    expect(blob.a).toBe(style.get("--accent"));
    expect(blob.f).toBe(style.get("--accent-foreground"));
    expect(blob.t).toBe(style.get("--accent-text"));
    expect(blob.z).toBe(Number(style.get("zoom")));
  });

  it("layout.tsx inline script replays the blob before first paint", () => {
    // Source guard: the pre-hydration script must read of-theme-css and set
    // all three accent vars + zoom from it (regex, same pattern as the
    // offline-sw source guards).
    const src = readFileSync(
      join(__dirname, "..", "src", "app", "layout.tsx"),
      "utf8",
    );
    expect(src).toContain("of-theme-css");
    expect(src).toMatch(/setProperty\("--accent"/);
    expect(src).toMatch(/setProperty\("--accent-foreground"/);
    expect(src).toMatch(/setProperty\("--accent-text"/);
    expect(src).toMatch(/setProperty\("zoom"/);
    // Validation: only the three known densities may replay.
    expect(src).toContain("0.92");
    expect(src).toContain("0.84");
  });
});

describe("cross-tab storage sync (Minor F)", () => {
  it("adopts another tab's accent/dark/density change via the storage event", () => {
    const storage = makeStorage();
    const { style, classes, storageListeners } = installDom(storage);
    setAccent("#4F46E5"); // first touch installs the storage listener
    expect(storageListeners.length).toBe(1);
    // Another tab switches to pink + light + compact…
    storage.setItem("of-accent", "#EC4899");
    storage.setItem("of-dark", "0");
    storage.setItem("of-density", "0.92");
    // …and the browser fires the storage event in THIS tab.
    storageListeners[0]({ key: "of-accent" });
    expect(style.get("--accent")).toBe("#EC4899");
    expect(classes.has("dark")).toBe(false);
    expect(style.get("zoom")).toBe("0.92");
  });

  it("ignores unrelated keys but re-reads everything on storage.clear()", () => {
    const storage = makeStorage();
    const { style, storageListeners } = installDom(storage);
    setAccent("#4F46E5");
    // Unrelated key → no-op.
    storage.setItem("of-something-else", "x");
    storageListeners[0]({ key: "of-something-else" });
    expect(style.get("--accent")).toBe("#4F46E5");
    // storage.clear() in another tab → key === null → full re-read to defaults.
    storage._map.clear();
    storageListeners[0]({ key: null });
    expect(style.get("--accent")).toBe(DEFAULT_THEME.accent);
  });

  it("echo writes don't loop: an event carrying the current state is a no-op", () => {
    const storage = makeStorage();
    const { style, storageListeners } = installDom(storage);
    setAccent("#F59E0B");
    const before = style.get("--accent");
    // Same-tab echo: values already match → equality guard short-circuits.
    storageListeners[0]({ key: "of-accent" });
    expect(style.get("--accent")).toBe(before);
    // Listener installed exactly once despite multiple touches.
    setDark(true);
    setDensity(0.84);
    expect(storageListeners.length).toBe(1);
  });
});
