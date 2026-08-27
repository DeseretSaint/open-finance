import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGET_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  moveWidget,
  normalizeDashboardLayout,
  readDashboardLayout,
  toggleWidgetHidden,
} from "@/lib/dashboard-pref";

// Node environment — stub window/localStorage for the read path.
function makeStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
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

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("normalizeDashboardLayout", () => {
  it("drops unknown ids", () => {
    const out = normalizeDashboardLayout({
      order: ["balance", "bogus", "stats", "budgets", "recent"],
      hidden: ["nope"],
    });
    expect(out.order).toEqual(["balance", "stats", "budgets", "recent"]);
    expect(out.hidden).toEqual([]);
  });

  it("appends missing ids at the end (future-proof)", () => {
    const out = normalizeDashboardLayout({ order: ["recent"], hidden: [] });
    expect(out.order).toEqual(["recent", "balance", "stats", "budgets"]);
  });

  it("dedupes repeated ids", () => {
    const out = normalizeDashboardLayout({
      order: ["stats", "stats", "balance", "balance", "budgets", "recent"],
      hidden: ["budgets", "budgets"],
    });
    expect(out.order).toEqual(["stats", "balance", "budgets", "recent"]);
    expect(out.hidden).toEqual(["budgets"]);
  });

  it("malformed JSON-ish values fall back to the default layout", () => {
    for (const bad of [null, 42, "balance", [], { order: "x", hidden: [] }, { order: [] }]) {
      const out = normalizeDashboardLayout(bad);
      expect(out.order).toEqual([...DASHBOARD_WIDGET_IDS]);
      expect(out.hidden).toEqual([]);
    }
  });
});

describe("readDashboardLayout (localStorage)", () => {
  it("returns the default when nothing is stored", () => {
    (globalThis as Record<string, unknown>).window = { localStorage: makeStorage() };
    expect(readDashboardLayout()).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it("reads and normalizes a stored layout", () => {
    const storage = makeStorage({
      "of-dashboard-layout": JSON.stringify({ order: ["stats", "balance"], hidden: ["recent"] }),
    });
    (globalThis as Record<string, unknown>).window = { localStorage: storage };
    const out = readDashboardLayout();
    expect(out.order).toEqual(["stats", "balance", "budgets", "recent"]);
    expect(out.hidden).toEqual(["recent"]);
  });

  it("malformed stored JSON falls back to the default", () => {
    const storage = makeStorage({ "of-dashboard-layout": "{not json" });
    (globalThis as Record<string, unknown>).window = { localStorage: storage };
    expect(readDashboardLayout()).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });
});

describe("moveWidget / toggleWidgetHidden", () => {
  it("moves a widget up and down", () => {
    const l = { ...DEFAULT_DASHBOARD_LAYOUT };
    const down = moveWidget(l, "balance", 1);
    expect(down.order).toEqual(["stats", "balance", "budgets", "recent"]);
    const up = moveWidget(down, "balance", -1);
    expect(up.order).toEqual([...DASHBOARD_WIDGET_IDS]);
  });

  it("is a no-op at the bounds", () => {
    const l = { ...DEFAULT_DASHBOARD_LAYOUT };
    expect(moveWidget(l, "balance", -1)).toBe(l);
    expect(moveWidget(l, "recent", 1)).toBe(l);
  });

  it("toggles hidden on and off", () => {
    const l = { ...DEFAULT_DASHBOARD_LAYOUT };
    const hidden = toggleWidgetHidden(l, "stats");
    expect(hidden.hidden).toEqual(["stats"]);
    const shown = toggleWidgetHidden(hidden, "stats");
    expect(shown.hidden).toEqual([]);
  });
});

describe("dashboard page wiring (source guard)", () => {
  const src = readFileSync(join(__dirname, "..", "src", "app", "(app)", "dashboard", "page.tsx"), "utf8");

  it("uses the layout hook and renders by layout order", () => {
    expect(src).toContain("useDashboardLayout()");
    expect(src).toContain("layout.order.filter");
    expect(src).toContain("layout.hidden.includes(id)");
  });

  it("exposes Customize controls with aria labels and a reset", () => {
    expect(src).toContain("Customize");
    expect(src).toContain("Reset layout");
    expect(src).toMatch(/aria-label=\{.*Move/);
    expect(src).toMatch(/aria-label=\{.*(Hide|Show)/);
  });

  it("keeps AgentWidgets and ReviewWidget pinned outside the layout", () => {
    expect(src).toContain('<AgentWidgets tab="dashboard" />');
    expect(src).toContain("<ReviewWidget />");
    expect(src).not.toContain('WIDGET_LABELS["review"]');
  });
});
