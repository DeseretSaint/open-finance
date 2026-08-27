"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ensureNativePlugins } from "@/lib/native-plugins";
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

export function useTheme() {
  const [accent, setAccent] = useState<string>(() => {
    if (typeof window === "undefined") return "#10B981";
    return normalizeAccent(localStorage.getItem("of-accent"));
  });
  // One-time migration (2026-08-03): pre-dark-default builds (v1.2.0 era)
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    ensureNativePlugins();
    // stored of-dark="0" on this device; the "dark by default" releases since
    // respected that stale flag. If we've never migrated this install, a
    // stored "0" is treated as legacy → reset to dark. Future light-mode
    // choices (after the marker is set) are respected normally.
    let v = localStorage.getItem("of-dark");
    if (localStorage.getItem("of-dark-v2") === null) {
      if (v === "0") {
        v = "1";
        localStorage.setItem("of-dark", "1");
      }
      localStorage.setItem("of-dark-v2", "1");
    }
    // v3 (2026-08-04): Keaton's device ended up light — a stray Light-mode
    // tap after the v2 marker, so the migration no longer applied. Once more,
    // any pre-v3 "0" is treated as legacy → reset to dark.
    if (localStorage.getItem("of-dark-v3") === null) {
      if (localStorage.getItem("of-dark") === "0") {
        v = "1";
        localStorage.setItem("of-dark", "1");
      }
      localStorage.setItem("of-dark-v3", "1");
    }
    // Dark is the default; only a stored "0" opts out.
    return v !== "0";
  });
  // Issue #20: density is a 3-step scale (Cozy / Compact / Dense) applied as
  // uniform CSS zoom — the whole UI scales together so nothing overlaps.
  const [density, setDensity] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const stored = parseFloat(localStorage.getItem("of-density") ?? "");
    return DENSITIES.some((d) => d.value === stored) ? stored : 1;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    // WCAG AA: white-on-accent fails for the 6 light accents (2.15–3.76:1),
    // so each accent carries its own verified foreground. Accent-as-text
    // (links, active labels) needs a darkened/brightened variant per mode —
    // raw accents on white are 2.15–3.76:1, all below the 4.5:1 AA floor.
    document.documentElement.style.setProperty("--accent-foreground", accentForeground(accent));
    document.documentElement.style.setProperty("--accent-text", accentText(accent, dark));
    localStorage.setItem("of-accent", accent);
  }, [accent, dark]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("of-dark", dark ? "1" : "0");
  }, [dark]);

  useEffect(() => {
    // Deprecated legacy key: map old "compact on" → Dense so returning
    // users keep the tighter layout they chose.
    if (!localStorage.getItem("of-density") && localStorage.getItem("of-compact") === "1") {
      setDensity(0.84);
      localStorage.setItem("of-density", "0.84");
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("zoom", String(density));
    localStorage.setItem("of-density", String(density));
  }, [density]);

  return { accent, setAccent, dark, setDark, density, setDensity, accents: ACCENTS, densities: DENSITIES };
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }), []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
