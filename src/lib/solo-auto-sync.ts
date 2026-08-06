"use client";

/** Foreground/active-session transaction refresh for standalone mode. */
let timer: number | null = null;
let running = false;

export async function syncSoloNow(): Promise<void> {
  if (running || typeof window === "undefined") return;
  running = true;
  try {
    const { isSoloCandidate } = await import("@/lib/mobile-mode");
    if (!isSoloCandidate(window.location.origin)) return;
    // Use the same API client as the app. In solo mode it dispatches through
    // solo-router; a raw fetch would hit the static-export WebView origin,
    // where no /api/transactions/sync route exists.
    const { api } = await import("@/lib/api-client");
    await api.post("/api/transactions/sync");
  } finally {
    running = false;
  }
}

export function startSoloAutoSync(): () => void {
  if (typeof window === "undefined") return () => {};
  void syncSoloNow();
  const onVisibility = () => {
    if (document.visibilityState === "visible") void syncSoloNow();
  };
  document.addEventListener("visibilitychange", onVisibility);
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void syncSoloNow();
  }, 15 * 60 * 1000);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
}
