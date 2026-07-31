import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Connected-mode mobile app (P8a). The webview loads the hub from CAP_SERVER_URL
 * (defaults to localhost for desktop dev; the APK reads it from native config
 * at build time). Pairing + session + device lock are handled by the web app
 * and the native Keystore plugin (src/android/…).
 */
const config: CapacitorConfig = {
  appId: "com.openfinance.app",
  appName: "Open Finance",
  webDir: ".next/static", // placeholder — the connected build loads a remote URL
  server: {
    url: process.env.CAP_SERVER_URL ?? "http://localhost:3000",
    cleartext: true, // user-entered hub hosts (LAN/Tailscale http); docs steer to Tailscale/TLS
  },
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
