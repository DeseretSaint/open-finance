"use client";

import { useEffect } from "react";

/**
 * Register the service worker ONLY on localhost (desktop-local PWA). Service
 * workers need a secure context, so hub/web/LAN/Tailscale never register one —
 * offline reads there come from app-level cache instead (see master plan §16).
 */
export function SwRegistration() {
  useEffect(() => {
    const host = window.location.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (!isLocalhost) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW is best-effort; the app works fine without it.
    });
  }, []);
  return null;
}
