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
    ].join("; "),
  },
];

/**
 * PWA is desktop-local only (service workers need a secure context, so the
 * launcher opens localhost). Hub/web/LAN/Tailscale never register the SW.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  reloadOnOnline: true,
  register: false, // we register manually, gated to localhost (see app/layout.tsx)
});

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSerwist(nextConfig);
