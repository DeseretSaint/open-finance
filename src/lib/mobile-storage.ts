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
  getHubUrl: () => Promise<{ url: string | null }>;
};

function plugin(): KeystorePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const p = (window as unknown as Record<string, unknown>).Keystore as KeystorePlugin | undefined;
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

export async function getStoredSessionToken(): Promise<string | null> {
  const p = plugin();
  if (p) return (await p.getSessionToken()).token;
  try {
    return localStorage.getItem("of-mobile-session");
  } catch {
    return null;
  }
}

export async function clearStoredSessionToken(): Promise<void> {
  const p = plugin();
  if (p) await p.clearSessionToken();
  else {
    try {
      localStorage.removeItem("of-mobile-session");
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

/** Reconnect deep link: openfinance://reconnect → /pair on this hub. */
export function isReconnectDeepLink(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.location.href;
  return raw.startsWith("openfinance://reconnect");
}
