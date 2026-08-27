"use client";

import { hasWindow } from "@/lib/browser-env";

/** Foreground/active-session transaction refresh for standalone mode. */
let timer: number | null = null;
let running = false;

export async function syncSoloNow(): Promise<{ ok: boolean; error?: string } | null> {
  if (running || !hasWindow()) return null;
  running = true;
  try {
    const { isSoloCandidate } = await import("@/lib/mobile-mode");
    if (!isSoloCandidate(window.location.origin)) return null;
    // Use the same API client as the app. In solo mode it dispatches through
    // solo-router; a raw fetch would hit the static-export WebView origin,
    // where no /api/transactions/sync route exists.
    const { api } = await import("@/lib/api-client");
    const res = await api.post<{ results: Array<{ ok: boolean; error?: string }> }>("/api/transactions/sync");
    // Notify the UI so mounted queries (Activity tab, accounts, summary) can
    // refetch — previously the DB updated but the screen stayed stale.
    const failed = (res?.results ?? []).filter((r) => !r.ok);
    const outcome = { ok: failed.length === 0, error: failed.length > 0 ? `Sync errors: ${failed.map((f) => f.error ?? "unknown").join("; ")}` : undefined };
    window.dispatchEvent(new CustomEvent("of:data-synced", { detail: outcome }));
    return outcome;
  } catch (e) {
    const outcome = { ok: false, error: e instanceof Error ? e.message : "Sync failed." };
    window.dispatchEvent(new CustomEvent("of:data-synced", { detail: outcome }));
    return outcome;
  } finally {
    running = false;
  }
}

export function startSoloAutoSync(): () => void {
  if (!hasWindow()) return () => {};
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
