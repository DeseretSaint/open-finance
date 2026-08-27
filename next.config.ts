import type { NextConfig } from "next";
import path from "node:path";
import withSerwistInit from "@serwist/next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // HSTS: app requires HTTPS for secure session cookies (isHttps gate), so pin
  // it. No includeSubDomains/preload — keeps lockout risk low for self-hosters
  // who mix http (LAN) + https (Tailscale) origins. Browsers ignore HSTS on
  // plain-http responses, so localhost/LAN http is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.plaid.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' https://sandbox.plaid.com https://development.plaid.com https://production.plaid.com",
      "frame-src https://cdn.plaid.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

/**
 * PWA is desktop-local only (service workers need a secure context, so the
 * launcher opens localhost). Hub/web/LAN/Tailscale never register the SW.
 * Disabled for the APK mobile export (the native webview caches on its own),
 * but ENABLED for the GitHub Pages PWA build (PAGES=1) so the web app is
 * installable + offline-capable like a normal PWA.
 */
const isPages = process.env.PAGES === "1";
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable:
    process.env.NODE_ENV !== "production" ||
    (process.env.MOBILE_EXPORT === "1" && !isPages),
  reloadOnOnline: true,
  register: false, // we register manually, gated (see app/layout.tsx)
});

/**
 * MOBILE_EXPORT=1 → P8b solo webview build:
 *  - output: "export" (static site — no Node server on the phone)
 *  - distDir: dist/mobile (cap-sqlite webDir for the APK)
 * The build script (build-mobile.mjs) hides src/app/api first, since export
 * mode refuses route handlers — the solo router answers /api/* in-process.
 * Otherwise → the server build (standalone hub) with the full API surface.
 *
 * PAGES=1 (with MOBILE_EXPORT=1) → GitHub Pages PWA build: same static export,
 * plus a basePath (PAGES_BASE_PATH, e.g. "/open-finance") and a service worker.
 */
const isMobileExport = process.env.MOBILE_EXPORT === "1";
const pagesBasePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: isMobileExport ? "export" : "standalone",
  ...(isMobileExport
    ? { distDir: "dist/mobile", images: { unoptimized: true } }
    : { outputFileTracingRoot: path.join(__dirname) }),
  // GitHub Pages serves the export from a subpath (/<repo>/). basePath +
  // assetPrefix make Next emit and reference every asset under that prefix.
  ...(pagesBasePath ? { basePath: pagesBasePath, assetPrefix: pagesBasePath } : {}),
  serverExternalPackages: ["better-sqlite3"],
  // Inlined at build time (browser bundle has no process.env at runtime).
  // NEXT_PUBLIC_APP_VERSION: used by the solo updates service for version compare.
  // NEXT_PUBLIC_SOLO_BUILD: "1" in static exports → plain-browser solo PWA mode.
  // NEXT_PUBLIC_BASE_PATH: runtime basePath (locating sql-wasm.wasm, sw.js).
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "0.0.0",
    NEXT_PUBLIC_SOLO_BUILD: isMobileExport ? "1" : "0",
    NEXT_PUBLIC_BASE_PATH: pagesBasePath,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSerwist(nextConfig);
