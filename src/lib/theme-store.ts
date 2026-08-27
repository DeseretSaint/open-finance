"use client";

// Single source of truth for the accent / dark / density theme.
//
// Why this exists: useTheme() used to hold its own useState per consumer
// (sidebar.tsx and settings/page.tsx each called it independently). Each
// instance carried its OWN accent/dark copy, and the [accent, dark] effect
// that writes --accent/--accent-foreground/--accent-text re-fired whenever
// EITHER changed — so toggling dark in the sidebar re-applied the sidebar's
// STALE accent over whatever the settings panel had just picked. Visual state
// diverged from localStorage until a reload.
//
// The fix is a module-level store: every consumer reads and writes the SAME
// state via useSyncExternalStore, and one applyTheme() writes all the CSS
// vars + localStorage together, so a dark toggle can never resurrect an old
// accent.

import { useEffect, useSyncExternalStore } from "react";
import { ensureNativePlugins } from "@/lib/native-plugins";
import { hasDocument, hasWindow } from "@/lib/browser-env";
import {
  ACCENTS,
  accentForeground,
  accentText,
  normalizeAccent,
} from "@/lib/accents";

export const DENSITIES = [
  { label: "Cozy", value: 1.0 },
  { label: "Compact", value: 0.92 },
  { label: "Dense", value: 0.84 },
] as const;

export interface ThemeState {
  accent: string;
  dark: boolean;
  density: number;
}

export const DEFAULT_THEME: ThemeState = {
  accent: "#10B981",
  dark: true,
  density: 1,
};

let state: ThemeState = DEFAULT_THEME;
let initialized = false;
const listeners = new Set<() => void>();

// One-time dark-mode migrations (kept in sync with the pre-hydration inline
// script in app/layout.tsx). Pre-dark-default installs stored of-dark="0";
// each marker treats a stale "0" as legacy and resets it to dark.
function migrateDark(storage: Storage): void {
  let v = storage.getItem("of-dark");
  if (storage.getItem("of-dark-v2") === null) {
    if (v === "0") {
      v = "1";
      storage.setItem("of-dark", "1");
    }
    storage.setItem("of-dark-v2", "1");
  }
  if (storage.getItem("of-dark-v3") === null) {
    if (storage.getItem("of-dark") === "0") {
      v = "1";
      storage.setItem("of-dark", "1");
    }
    storage.setItem("of-dark-v3", "1");
  }
}

function readStored(): ThemeState {
  if (!hasWindow()) return DEFAULT_THEME;
  const storage = window.localStorage;
  migrateDark(storage);
  const dark = storage.getItem("of-dark") !== "0";

  let density = 1;
  const storedDensity = parseFloat(storage.getItem("of-density") ?? "");
  if (DENSITIES.some((d) => d.value === storedDensity)) density = storedDensity;
  // Deprecated legacy key: map old "compact on" → Dense so returning users
  // keep the tighter layout they chose.
  if (!storage.getItem("of-density") && storage.getItem("of-compact") === "1") {
    density = 0.84;
    storage.setItem("of-density", "0.84");
  }

  return { accent: normalizeAccent(storage.getItem("of-accent")), dark, density };
}

// Cross-tab sync: when ANOTHER tab changes one of the theme keys, adopt its
// value so open tabs never diverge until reload. Installed once; the equality
// guard in syncFromStorage makes echo writes no-ops (setItem with an
// unchanged value doesn't re-dispatch, and the guard stops any loop anyway).
const SYNCED_KEYS = ["of-accent", "of-dark", "of-density"];
let storageSyncInstalled = false;

function syncFromStorage(): void {
  if (!hasWindow()) return;
  const next = readStored();
  if (
    next.accent === state.accent &&
    next.dark === state.dark &&
    next.density === state.density
  ) {
    return;
  }
  state = next;
  applyTheme();
  for (const l of listeners) l();
}

function ensureStorageSync(): void {
  if (storageSyncInstalled || !hasWindow()) return;
  if (!("addEventListener" in window)) return;
  storageSyncInstalled = true;
  window.addEventListener("storage", (e: StorageEvent) => {
    // key === null means storage.clear() in another tab → re-read everything.
    if (e.key === null || SYNCED_KEYS.includes(e.key)) syncFromStorage();
  });
}

// Load stored prefs into the store exactly once. Pure with respect to the DOM
// (reads/writes localStorage only) so it is safe to call during render.
function ensureLoaded(): ThemeState {
  if (!initialized) {
    initialized = true;
    if (hasWindow()) {
      ensureNativePlugins();
      state = readStored();
      ensureStorageSync();
    }
  }
  return state;
}

// Write every CSS var + the dark class + localStorage from the CURRENT state
// in one pass. Idempotent; safe to call from setters and from an effect.
export function applyTheme(): void {
  ensureLoaded();
  if (!hasDocument()) return;
  const root = document.documentElement;
  const fg = accentForeground(state.accent);
  const text = accentText(state.accent, state.dark);
  root.style.setProperty("--accent", state.accent);
  // WCAG AA: each accent carries its own verified foreground (white-on-accent
  // fails for the 6 light accents), plus a per-mode accent-as-text variant.
  root.style.setProperty("--accent-foreground", fg);
  root.style.setProperty("--accent-text", text);
  root.classList.toggle("dark", state.dark);
  root.style.setProperty("zoom", String(state.density));
  if (hasWindow()) {
    const storage = window.localStorage;
    storage.setItem("of-accent", state.accent);
    storage.setItem("of-dark", state.dark ? "1" : "0");
    storage.setItem("of-density", String(state.density));
    // Pre-hydration replay blob: the inline script in app/layout.tsx applies
    // these exact values before first paint so non-default users (custom
    // accent and/or density != 1) don't FOUC the CSS defaults. Written from
    // the same computed values just set on the DOM — the blob can never
    // drift from the runtime contrast logic (no math duplicated inline).
    storage.setItem(
      "of-theme-css",
      JSON.stringify({ a: state.accent, f: fg, t: text, z: state.density }),
    );
  }
}

function patch(p: Partial<ThemeState>): void {
  ensureLoaded();
  state = { ...state, ...p };
  applyTheme();
  for (const l of listeners) l();
}

export function setAccent(accent: string): void {
  patch({ accent: normalizeAccent(accent) });
}

export function setDark(dark: boolean): void {
  patch({ dark });
}

export function setDensity(density: number): void {
  patch({ density });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeState {
  return ensureLoaded();
}

function getServerSnapshot(): ThemeState {
  return DEFAULT_THEME;
}

/**
 * Theme hook. Keeps the exact shape the settings page and sidebar already
 * consume; the difference is every caller now shares one store, so a change
 * in one place is seen (and applied) consistently everywhere.
 *
 * useSyncExternalStore renders with the server snapshot during SSR/hydration
 * (avoiding the hydration mismatch the old useState-initializer localStorage
 * reads risked) and switches to the stored values on the client.
 */
export function useTheme() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Apply after hydration: the server snapshot renders defaults, the client
  // snapshot carries the stored prefs — make sure they hit the DOM.
  useEffect(() => {
    applyTheme();
  }, [snap]);
  return {
    accent: snap.accent,
    setAccent,
    dark: snap.dark,
    setDark,
    density: snap.density,
    setDensity,
    accents: ACCENTS,
    densities: DENSITIES,
  };
}

// Test-only: reset module state so each test starts clean.
export function __resetThemeForTest(): void {
  state = DEFAULT_THEME;
  initialized = false;
  storageSyncInstalled = false;
  listeners.clear();
}
