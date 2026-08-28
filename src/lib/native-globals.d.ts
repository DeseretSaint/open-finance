/**
 * Native bridge globals (Capacitor webview).
 *
 * The Android bridge (MainActivity + cap sync) injects these handles onto the
 * webview's global object: the Capacitor runtime itself plus the dynamically
 * registered plugins the app reads (ensureNativePlugins() in
 * src/lib/native-plugins.ts bridges registerPlugin() results onto the global).
 * On plain web/PWA none of them exist — every consumer reads them via
 * optional chaining, so the declarations are all optional.
 *
 * Declaring them ONCE here as global `var`s (instead of repeating
 * `window as unknown as {...}` / `globalThis as unknown as {...}` at every
 * read site) keeps the native surface typed in one place and lets call sites
 * read `window.Capacitor` / `globalThis.Keystore` etc. with no assertion
 * chain. A global `var` is visible on both `window` and `globalThis`.
 */

import type { SoloResponse } from "@/lib/solo-router";

export {};

declare global {
  interface OfCapacitorBridge {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    /**
     * Generic so each registration site names the plugin shape it expects
     * (`cap.registerPlugin<OfUpdaterPlugin>("Updater")`) without a cast.
     */
    registerPlugin?: <T = unknown>(name: string) => T;
  }

  interface OfKeystorePlugin {
    setSessionToken?: (opts: { token: string }) => Promise<{ ok: boolean }>;
    getSessionToken?: () => Promise<{ token: string | null }>;
    clearSessionToken?: () => Promise<{ ok: boolean }>;
    setHubUrl?: (opts: { url: string }) => Promise<{ ok: boolean }>;
    getHubUrl: (opts?: Record<string, never>) => Promise<{ url: string | null }>;
  }

  interface OfRemoteServerPlugin {
    start?: (o: { port: number }) => Promise<void>;
    stop?: () => Promise<void>;
    status?: () => Promise<{ running: boolean } | null>;
  }

  interface OfUpdaterPlugin {
    downloadAndInstall?: (o: {
      url: string;
      sha256?: string | null;
      fileName?: string;
    }) => Promise<void>;
    canInstallUnknownApps?: () => Promise<{ canInstall: boolean }>;
    openInstallSettings?: () => Promise<void>;
  }

  interface OfRemoteDispatchRequest {
    method: string;
    path: string;
    query: string;
    body: unknown;
    headers?: Record<string, string>;
  }

  /** The Capacitor runtime (present only inside the native webview). */
  var Capacitor: OfCapacitorBridge | undefined;
  /** Keystore-backed session/hub storage plugin (native only). */
  var Keystore: OfKeystorePlugin | undefined;
  /** Native HTTP server plugin for remote agent access (native only). */
  var RemoteServer: OfRemoteServerPlugin | undefined;
  /** In-place APK updater plugin (native only). */
  var Updater: OfUpdaterPlugin | undefined;
  /** Native Plaid Link bridge (native only). */
  var PlaidProxy: unknown;
  /** Installed by ensureNativePlugins(): the native HTTP server's dispatch hook. */
  var __ofRemoteDispatch: ((req: OfRemoteDispatchRequest) => Promise<SoloResponse>) | undefined;
}
