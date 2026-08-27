"use client";

/**
 * Dashboard layout preference: which sections show, in what order.
 *
 * Persisted in localStorage (parity with every other display pref — accent,
 * dark, density, include-pending; there is no server settings store). The
 * agent-managed widgets row and the review widget stay pinned at the top and
 * are not part of the layout; they have their own inline removal.
 */
import { useCallback, useEffect, useState } from "react";

export const DASHBOARD_WIDGET_IDS = ["balance", "stats", "budgets", "recent"] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export interface DashboardLayout {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
}

const STORAGE_KEY = ["of", "dashboard", "layout"].join("-");

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  order: [...DASHBOARD_WIDGET_IDS],
  hidden: [],
};

function isWidgetId(v: unknown): v is DashboardWidgetId {
  return typeof v === "string" && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(v);
}

/**
 * Normalize an unknown parsed value into a valid layout: drop unknown ids,
 * dedupe, append any known ids the stored value is missing (future-proof —
 * a new widget added later shows up at the end instead of vanishing).
 */
export function normalizeDashboardLayout(value: unknown): DashboardLayout {
  const fallback = (): DashboardLayout => ({
    order: [...DEFAULT_DASHBOARD_LAYOUT.order],
    hidden: [...DEFAULT_DASHBOARD_LAYOUT.hidden],
  });
  if (typeof value !== "object" || value === null) return fallback();
  const raw = value as { order?: unknown; hidden?: unknown };
  if (!Array.isArray(raw.order) || !Array.isArray(raw.hidden)) return fallback();

  const order: DashboardWidgetId[] = [];
  const seen = new Set<DashboardWidgetId>();
  for (const id of raw.order) {
    if (isWidgetId(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  const hidden: DashboardWidgetId[] = [];
  for (const id of raw.hidden) {
    if (isWidgetId(id) && !hidden.includes(id)) hidden.push(id);
  }
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) order.push(id);
  }
  return { order, hidden };
}

export function readDashboardLayout(): DashboardLayout {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DASHBOARD_LAYOUT;
    return normalizeDashboardLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

function writeLayout(layout: DashboardLayout) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

/** Move a widget up/down in the order; no-op at the bounds. Pure. */
export function moveWidget(layout: DashboardLayout, id: DashboardWidgetId, dir: -1 | 1): DashboardLayout {
  const i = layout.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.order.length) return layout;
  const order = [...layout.order];
  const [moved] = order.splice(i, 1);
  order.splice(j, 0, moved);
  return { order, hidden: layout.hidden };
}

/** Toggle a widget's visibility. Pure. */
export function toggleWidgetHidden(layout: DashboardLayout, id: DashboardWidgetId): DashboardLayout {
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((h) => h !== id)
    : [...layout.hidden, id];
  return { order: layout.order, hidden };
}

export function useDashboardLayout(): {
  layout: DashboardLayout;
  move: (id: DashboardWidgetId, dir: -1 | 1) => void;
  toggleHidden: (id: DashboardWidgetId) => void;
  reset: () => void;
} {
  // Default on first paint; the stored layout applies in an effect so the
  // server-rendered HTML and the first client render always match.
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_DASHBOARD_LAYOUT);
  useEffect(() => {
    setLayout(readDashboardLayout());
  }, []);

  const move = useCallback((id: DashboardWidgetId, dir: -1 | 1) => {
    setLayout((prev) => {
      const next = moveWidget(prev, id, dir);
      if (next !== prev) writeLayout(next);
      return next;
    });
  }, []);

  const toggleHidden = useCallback((id: DashboardWidgetId) => {
    setLayout((prev) => {
      const next = toggleWidgetHidden(prev, id);
      writeLayout(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next = {
      order: [...DEFAULT_DASHBOARD_LAYOUT.order],
      hidden: [...DEFAULT_DASHBOARD_LAYOUT.hidden],
    };
    writeLayout(next);
    setLayout(next);
  }, []);

  return { layout, move, toggleHidden, reset };
}
