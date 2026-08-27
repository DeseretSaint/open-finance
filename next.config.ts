import type { NextConfig } from "next";
import path from "node:path";
import withSerwistInit from "@serwist/next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
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
 * Disabled entirely for the mobile export (P8b solo webview).
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production" || process.env.MOBILE_EXPORT === "1",
  reloadOnOnline: true,
  register: false, // we register manually, gated to localhost (see app/layout.tsx)
});

/**
 * MOBILE_EXPORT=1 → P8b solo webview build:
 *  - output: "export" (static site — no Node server on the phone)
 *  - distDir: dist/mobile (cap-sqlite webDir for the APK)
 * The build script (build-mobile.mjs) hides src/app/api first, since export
 * mode refuses route handlers — the solo router answers /api/* in-process.
 * Otherwise → the server build (standalone hub) with the full API surface.
 */
const isMobileExport = process.env.MOBILE_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isMobileExport ? "export" : "standalone",
  ...(isMobileExport
    ? { distDir: "dist/mobile", images: { unoptimized: true } }
    : { outputFileTracingRoot: path.join(__dirname) }),
  serverExternalPackages: ["better-sqlite3"],
  // Inlined at build time (browser bundle has no process.env at runtime).
  // Used by the solo updates service for the "current version" comparison.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "0.0.0",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSerwist(nextConfig);
