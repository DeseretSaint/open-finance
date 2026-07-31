import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Open Finance mobile app (P8a connected + P8b solo).
 *
 * The APK bundles the app locally (webDir) and the webview decides mode at
 * runtime (src/lib/mobile-mode.ts):
 *   - No stored hub URL → SOLO: the app runs fully on-device against a local
 *     CapSqliteDb, Plaid via the native PlaidProxy plugin (LinkKit for Link).
 *   - Stored hub URL (paired via QR) → CONNECTED: the app talks to the hub's
 *     API over HTTP.
 *
 * CAP_SERVER_URL is only used to force a connected-only build (CI smoke /
 * internal testing); the distributed APK omits it so the webview loads the
 * bundled app. cleartext stays on for user-entered LAN/Tailscale hub hosts;
 * docs steer to Tailscale/TLS.
 */
const config: CapacitorConfig = {
  appId: "com.openfinance.app",
  appName: "Open Finance",
  webDir: "dist/mobile", // bundled solo app (static export, see scripts/build-mobile.mjs)
  server: process.env.CAP_SERVER_URL
    ? { url: process.env.CAP_SERVER_URL, cleartext: true }
    : { cleartext: true },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
