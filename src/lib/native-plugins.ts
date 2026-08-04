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
export function ensureNativePlugins(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  const cap = (w as { Capacitor?: { registerPlugin?: (name: string) => unknown } }).Capacitor;
  if (!cap?.registerPlugin) return; // plain web / PWA — no native bridge
  if (!w.PlaidProxy) w.PlaidProxy = cap.registerPlugin("PlaidProxy");
  if (!w.Keystore) w.Keystore = cap.registerPlugin("Keystore");
}
