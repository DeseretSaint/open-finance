"use client";

/**
 * Session/hub storage for mobile (P8a): on device the session token + hub URL
 * live in Android Keystore-backed EncryptedSharedPreferences via the native
 * Keystore plugin; on desktop/web we fall back to localStorage (the PWA is
 * desktop-local and the browser's cookie already carries the session).
 */

type KeystorePlugin = {
  setSessionToken: (opts: { token: string }) => Promise<{ ok: boolean }>;
  getSessionToken: () => Promise<{ token: string | null }>;
  clearSessionToken: () => Promise<{ ok: boolean }>;
  setHubUrl: (opts: { url: string }) => Promise<{ ok: boolean }>;
  getHubUrl: (opts?: Record<string, never>) => Promise<{ url: string | null }>;
};

import { hasWindow } from "@/lib/browser-env";

function plugin(): KeystorePlugin | null {
  if (!hasWindow()) return null;
  // Native bridge globals are declared in src/lib/native-globals.d.ts.
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  // SAFETY: window.Keystore is the native bridge injected only on the Capacitor
  // Android runtime; its shape is exactly KeystorePlugin (declared in native-globals.d.ts).
  const p = window.Keystore as KeystorePlugin | undefined;
  return p ?? null;
}

export async function storeSessionToken(token: string): Promise<void> {
  const p = plugin();
  if (p) await p.setSessionToken({ token });
  else {
    try {
      localStorage.setItem("of-mobile-session", token);
    } catch {
      /* ignore */
    }
  }
}

export async function storeHubUrl(url: string): Promise<void> {
  const p = plugin();
  if (p) await p.setHubUrl({ url });
  else {
    try {
      localStorage.setItem("of-hub-url", url);
    } catch {
      /* ignore */
    }
  }
}

export async function getStoredHubUrl(): Promise<string | null> {
  const p = plugin();
  if (p) return (await p.getHubUrl()).url;
  try {
    return localStorage.getItem("of-hub-url");
  } catch {
    return null;
  }
}


