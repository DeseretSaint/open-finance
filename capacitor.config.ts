import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Open Finance mobile app (P8a connected + P8b solo).
 *
 * The webview loads either:
 *   - CONNECTED: CAP_SERVER_URL is set at build time → the webview loads the
 *     hub's URL (P8a QR pairing, device lock, Reconnect deep link).
 *   - SOLO (in progress, P8b): CAP_SERVER_URL unset → the webview loads the
 *     bundled app (webDir) and runs fully on-device against a local
 *     CapSqliteDb; Plaid via the native PlaidProxy plugin + LinkKit.
 *
 * webDir must exist at `cap sync` time. `.next/static` is produced by
 * `pnpm build`; the solo static export (dist/mobile) lands with the P8b solo
 * build (scripts/build-mobile.mjs). cleartext stays on for user-entered
 * LAN/Tailscale hub hosts; docs steer to Tailscale/TLS.
 */
const config: CapacitorConfig = {
  appId: "com.openfinance.app",
  appName: "Open Finance",
  webDir: process.env.CAP_WEB_DIR ?? ".next/static",
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
