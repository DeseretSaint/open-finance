"use client";

import { useEffect } from "react";
import { basePath, withBase } from "@/lib/browser-env";

/**
 * Register the service worker on localhost (desktop-local PWA) AND on the
 * GitHub Pages PWA build (basePath set → served over HTTPS from
 * deseretsaint.github.io). Service workers need a secure context, so
 * hub/web/LAN/Tailscale (plain http) never register one — offline reads there
 * come from app-level cache instead (see master plan §16).
 */
export function SwRegistration() {
  useEffect(() => {
    const host = window.location.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    const isPages = basePath() !== "" && host.endsWith(".github.io");
    if (!isLocalhost && !isPages) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(withBase("/sw.js")).catch(() => {
      // SW is best-effort; the app works fine without it.
    });
  }, []);
  return null;
}
