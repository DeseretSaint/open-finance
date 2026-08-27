"use client";

/**
 * Bridges the native Capacitor plugins onto the window handles the app reads:
 *   - native.ts (server/plaid) reads `globalThis.PlaidProxy`
 *   - mobile-storage.ts reads `window.Keystore`
 * Both are registered natively in MainActivity, but Capacitor only exposes
 * them via Capacitor.registerPlugin() — nothing ever assigned the window
 * handles, so PlaidProxy threw "plugin unavailable" even inside the real APK
 * (and Keystore silently fell back to localStorage, masking the same gap).
 *
 * Safe to call anywhere: on plain web/PWA there is no Capacitor bridge and
 * this is a no-op.
 */
import { hasWindow } from "@/lib/browser-env";

export function ensureNativePlugins(): void {
  if (!hasWindow()) return;
  // SAFETY: window hosts dynamically-registered native plugins; read it as a loose record.
  const w = window as unknown as Record<string, unknown>;
  // SAFETY: Capacitor.registerPlugin is the native bridge entry point; read it off the window record.
  const cap = (w as { Capacitor?: { registerPlugin?: (name: string) => unknown } }).Capacitor;
  if (!cap?.registerPlugin) return; // plain web / PWA — no native bridge
  if (!w.PlaidProxy) w.PlaidProxy = cap.registerPlugin("PlaidProxy");
  if (!w.Keystore) w.Keystore = cap.registerPlugin("Keystore");
  if (!w.RemoteServer) w.RemoteServer = cap.registerPlugin("RemoteServer");
  if (!w.Updater) w.Updater = cap.registerPlugin("Updater");
  // Remote-agent bridge: the native HTTP server calls this with the parsed
  // request; we dispatch it through the same solo router the webview uses.
  if (!w.__ofRemoteDispatch) {
    w.__ofRemoteDispatch = async (req: { method: string; path: string; query: string; body: unknown; headers?: Record<string, string> }) => {
      const { soloDispatch } = await import("@/lib/solo-router");
      const url = new URL(req.path + (req.query ? `?${req.query}` : ""), "http://solo.local");
      return soloDispatch({
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        body: req.body === null || req.body === undefined ? undefined : req.body,
        headers: req.headers,
      });
    };
  }
}

/**
 * Returns whether the native remote HTTP server is available and listening.
 * `available` is false on plain web/PWA (no bridge registered); `listening` is
 * the live server state on the device. Returns nulls if it can't be probed.
 */
export async function getRemoteServerStatus(): Promise<{ available: boolean; listening: boolean }> {
  if (!hasWindow()) return { available: false, listening: false };
  // SAFETY: window hosts the native RemoteServer plugin with an optional status probe.
  const w = window as unknown as {
    RemoteServer?: { start?: unknown; status?: () => Promise<{ running: boolean } | null> };
  };
  const plugin = w.RemoteServer;
  if (!plugin?.status) return { available: false, listening: false };
  try {
    const s = await plugin.status();
    return { available: true, listening: s?.running === true };
  } catch {
    return { available: true, listening: false };
  }
}
