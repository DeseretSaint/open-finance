"use client";

/**
 * Mobile mode detection (P8b): the webview runs in one of two modes.
 *
 * - "connected": the APK loads a hub URL (CAP_SERVER_URL / stored hub URL) and
 *   talks to the hub's API over HTTP — the P8a flow.
 * - "solo": the webview loads the bundled app and runs the ENTIRE domain layer
 *   locally against a CapSqliteDb (see src/server/db/cap-sqlite.ts), with Plaid
 *   calls going through the native PlaidProxy plugin. No hub required.
 *
 * The deciding signals (checked in order):
 *   1. If a hub URL is stored on-device (Keystore plugin / localStorage) and
 *      the current origin matches it → connected.
 *   2. Otherwise, if we're running on a native platform with no server env →
 *      solo.
 *   3. On plain web (no Capacitor) → "connected" to whatever origin served us.
 */

export type MobileMode = "solo" | "connected";

import { hasWindow } from "@/lib/browser-env";

function nativeRuntime(): { Capacitor?: typeof globalThis.Capacitor; Keystore?: typeof globalThis.Keystore } {
  // Native bridge globals are declared in src/lib/native-globals.d.ts, so
  // globalThis.Capacitor / window.Capacitor are typed — no assertions needed.
  if (globalThis.Capacitor || globalThis.Keystore) return globalThis;
  if (hasWindow() && (window.Capacitor || window.Keystore)) return window;
  return { Capacitor: undefined, Keystore: undefined };
}

export function isNativePlatform(): boolean {
  const cap = nativeRuntime().Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * True when this bundle is a SOLO build (static export — the APK webview or a
 * GitHub Pages PWA), as opposed to the server/hub build. Inlined at build time
 * from MOBILE_EXPORT (see next.config.ts). A solo build running in a PLAIN
 * browser (no Capacitor) is a browser-solo PWA; a solo build in a native
 * webview is device-solo. The hub build is never solo.
 */
export function isSoloBuild(): boolean {
  return process.env.NEXT_PUBLIC_SOLO_BUILD === "1";
}

/** The hub URL the device has been paired to, if any (null = never paired). */
export async function getStoredHubUrl(): Promise<string | null> {
  const rt = nativeRuntime();
  if (isNativePlatform()) {
    const ks = rt.Keystore;
    if (!ks) return null;
    try {
      const { url } = await ks.getHubUrl({});
      return url || null;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem("of-hub-url");
  } catch {
    return null;
  }
}

/**
 * Resolve the current mode for the running webview.
 *
 * @param origin - window.location.origin at call time.
 * @param storedHubUrl - result of getStoredHubUrl() (injected for testability).
 */
export async function resolveMobileMode(
  origin: string,
  storedHubUrl: string | null
): Promise<MobileMode> {
  // Plain web (no Capacitor): solo only when this is a solo (static export)
  // build — the GitHub Pages PWA. The hub build stays connected to its server.
  if (!isNativePlatform()) return isSoloBuild() ? "solo" : "connected";

  // Native: solo unless we're pointed at (and paired to) a hub.
  if (storedHubUrl && origin === storedHubUrl) return "connected";
  return "solo";
}

/**
 * Synchronous quick check used by render paths that can't await.
 * True when:
 *  - native platform AND the webview is serving the BUNDLED app (origin
 *    hostname is localhost — Capacitor's default for webDir content); a paired
 *    hub has a real hostname/IP → not solo; OR
 *  - plain browser AND this is a solo (static export) build — the browser PWA
 *    runs the whole app locally against BrowserSqliteDb.
 */
export function isSoloCandidate(origin: string): boolean {
  if (isNativePlatform()) {
    try {
      const host = new URL(origin).hostname;
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      // Non-URL origin (e.g. capacitor://localhost on iOS) → bundled solo load.
      return true;
    }
  }
  return isSoloBuild();
}
