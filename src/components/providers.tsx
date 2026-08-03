"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

const ACCENTS = [
  "#10B981", // emerald (default)
  "#6366F1", // indigo
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#EC4899", // pink
  "#0EA5E9", // sky
];

export function useTheme() {
  const [accent, setAccent] = useState<string>(() => {
    if (typeof window === "undefined") return "#10B981";
    return localStorage.getItem("of-accent") ?? "#10B981";
  });
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    // Dark is the default; only a stored "0" opts out.
    return localStorage.getItem("of-dark") !== "0";
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-foreground", "#ffffff");
    localStorage.setItem("of-accent", accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("of-dark", dark ? "1" : "0");
  }, [dark]);

  return { accent, setAccent, dark, setDark, accents: ACCENTS };
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }), []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
