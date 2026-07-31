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

interface NativeRuntime {
  Capacitor?: { isNativePlatform?: () => boolean };
  Keystore?: {
    getHubUrl: (opts: Record<string, never>) => Promise<{ url: string | null }>;
  };
}

function nativeRuntime(): NativeRuntime {
  const g = globalThis as unknown as NativeRuntime;
  if (g?.Capacitor || g?.Keystore) return g;
  if (typeof window !== "undefined") return window as unknown as NativeRuntime;
  return {};
}

export function isNativePlatform(): boolean {
  const cap = nativeRuntime().Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** The hub URL the device has been paired to, if any (null = never paired). */
export async function getStoredHubUrl(): Promise<string | null> {
  const rt = nativeRuntime();
  if (isNativePlatform()) {
    if (!rt.Keystore) return null;
    try {
      const { url } = await rt.Keystore.getHubUrl({});
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
  // Plain web (no Capacitor): whatever served us is the server. Not solo.
  if (!isNativePlatform()) return "connected";

  // Native: solo unless we're pointed at (and paired to) a hub.
  if (storedHubUrl && origin === storedHubUrl) return "connected";
  return "solo";
}

/** Synchronous quick check used by render paths that can't await. */
export function isSoloCandidate(origin: string): boolean {
  if (!isNativePlatform()) return false;
  // Native + origin is not an http(s) hub → bundled solo load.
  return !/^https?:\/\//.test(origin);
}
