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
  // Native bridge globals are declared in src/lib/native-globals.d.ts — no
  // casts needed; all handles are optional (absent on plain web/PWA).
  const cap = window.Capacitor;
  if (!cap?.registerPlugin) return; // plain web / PWA — no native bridge
  if (!window.PlaidProxy) window.PlaidProxy = cap.registerPlugin("PlaidProxy");
  if (!window.Keystore) window.Keystore = cap.registerPlugin<OfKeystorePlugin>("Keystore");
  if (!window.RemoteServer) window.RemoteServer = cap.registerPlugin<OfRemoteServerPlugin>("RemoteServer");
  if (!window.Updater) window.Updater = cap.registerPlugin<OfUpdaterPlugin>("Updater");
  // Remote-agent bridge: the native HTTP server calls this with the parsed
  // request; we dispatch it through the same solo router the webview uses.
  if (!window.__ofRemoteDispatch) {
    window.__ofRemoteDispatch = async (req: OfRemoteDispatchRequest) => {
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
  // Native bridge globals are declared in src/lib/native-globals.d.ts.
  const plugin = window.RemoteServer;
  if (!plugin?.status) return { available: false, listening: false };
  try {
    const s = await plugin.status();
    return { available: true, listening: s?.running === true };
  } catch {
    return { available: true, listening: false };
  }
}
