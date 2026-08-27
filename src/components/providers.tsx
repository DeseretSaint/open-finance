"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";

// Theme state lives in a single module-level store (src/lib/theme-store.ts)
// so the sidebar and settings page share one source of truth — independent
// useTheme() instances used to desync (a dark toggle re-applied a stale
// accent). Re-exported here so existing import paths keep working.
export { DENSITIES, useTheme } from "@/lib/theme-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }), []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
