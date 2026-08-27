import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Solo-mode bridge self-heal guards (v0.3.42, commit e1517a0): the port-8787
 * agent bridge must survive process kills, reboots, and backgrounding. The
 * fix has five cooperating pieces across the Android native layer; none of it
 * is node-importable (Kotlin/Java/XML), so these source-level guards lock the
 * wiring exactly like tests/offline-sw.test.ts does for the service worker.
 *
 *  1. RemoteServerService: START_STICKY + socket re-bind on restart +
 *     dispatcher-recovery relaunch of MainActivity.
 *  2. RemoteServerBootReceiver: BOOT_COMPLETED restarts the service when the
 *     user had remote access enabled.
 *  3. AndroidManifest: stopWithTask=false, boot receiver + permission,
 *     specialUse FGS type.
 *  4. MainActivity.onPause: skips bridge.onPause() while the bridge is live
 *     (keeps the JS renderer answering requests when backgrounded).
 *  5. RemoteServerPlugin: persists the enabled flag the boot receiver and
 *     service self-heal both read; keeps the renderer IMPORTANT priority.
 */
const android = "../android/app/src/main/java/com/openfinance";
const serviceSrc = readFileSync(path.resolve(__dirname, `${android}/app/RemoteServerService.kt`), "utf8");
const bootSrc = readFileSync(path.resolve(__dirname, `${android}/app/RemoteServerBootReceiver.kt`), "utf8");
const mainSrc = readFileSync(path.resolve(__dirname, `${android}/app/MainActivity.java`), "utf8");
const pluginSrc = readFileSync(path.resolve(__dirname, `${android}/plugin/RemoteServerPlugin.kt`), "utf8");
const manifestSrc = readFileSync(
  path.resolve(__dirname, "../android/app/src/main/AndroidManifest.xml"),
  "utf8",
);

describe("solo bridge self-heal: service survives process kill", () => {
  it("returns START_STICKY so the OS relaunches the service after a kill", () => {
    expect(serviceSrc).toContain("return START_STICKY");
  });

  it("re-binds the 8787 socket on a sticky restart (serverSocket null check before accept loop)", () => {
    const rebind = serviceSrc.indexOf("if (serverSocket == null)");
    const accept = serviceSrc.indexOf("startAcceptLoop(port)");
    expect(rebind).toBeGreaterThan(-1);
    expect(accept).toBeGreaterThan(rebind);
  });

  it("recovers a dead dispatcher by relaunching MainActivity when remote access is enabled", () => {
    const heal = serviceSrc.indexOf("if (dispatcher == null)");
    expect(heal).toBeGreaterThan(-1);
    expect(serviceSrc).toContain('getSharedPreferences("remote_server"');
    expect(serviceSrc).toContain('getBoolean("enabled", false)');
    expect(serviceSrc).toContain("startActivity(launch)");
    // The relaunch must stay inside the enabled-pref guard, not fire unconditionally.
    const enabledGuard = serviceSrc.indexOf('getBoolean("enabled", false)');
    expect(enabledGuard).toBeGreaterThan(heal);
    expect(serviceSrc.indexOf("startActivity(launch)")).toBeGreaterThan(enabledGuard);
  });
});

describe("solo bridge self-heal: reboot recovery", () => {
  it("boot receiver acts only on BOOT_COMPLETED and only when remote access was enabled", () => {
    expect(bootSrc).toContain("Intent.ACTION_BOOT_COMPLETED");
    expect(bootSrc).toContain('getBoolean("enabled", false)');
    const actionCheck = bootSrc.indexOf("Intent.ACTION_BOOT_COMPLETED");
    const enabledCheck = bootSrc.indexOf('getBoolean("enabled", false)');
    const start = bootSrc.indexOf("startForegroundService");
    expect(actionCheck).toBeGreaterThan(-1);
    expect(enabledCheck).toBeGreaterThan(actionCheck);
    expect(start).toBeGreaterThan(enabledCheck);
  });

  it("boot receiver restarts the service on port 8787", () => {
    expect(bootSrc).toContain('putExtra("port", 8787)');
    expect(bootSrc).toContain("RemoteServerService::class.java");
  });

  it("manifest registers the boot receiver with BOOT_COMPLETED + permission", () => {
    expect(manifestSrc).toContain(".RemoteServerBootReceiver");
    expect(manifestSrc).toContain("android.intent.action.BOOT_COMPLETED");
    expect(manifestSrc).toContain("android.permission.RECEIVE_BOOT_COMPLETED");
  });
});

describe("solo bridge self-heal: keepalive while backgrounded", () => {
  it("service is stopWithTask=false + specialUse FGS (no 6h dataSync cap)", () => {
    expect(manifestSrc).toContain('android:stopWithTask="false"');
    expect(manifestSrc).toContain('android:foregroundServiceType="specialUse"');
  });

  it("MainActivity.onPause skips bridge.onPause() while the bridge is live", () => {
    expect(mainSrc).toContain("RemoteServerService.isRunning()");
    expect(mainSrc).toContain("deliberately do NOT call bridge.onPause()");
    // The bridge-freeze call must remain conditional, never unconditional.
    expect(mainSrc).toMatch(/if\s*\(\s*bridge\s*!=\s*null\s*\)\s*bridge\.onPause\(\)/);
  });

  it("plugin keeps the renderer IMPORTANT priority + persists the enabled flag both directions", () => {
    expect(pluginSrc).toContain("RENDERER_PRIORITY_IMPORTANT");
    expect(pluginSrc).toContain('putBoolean("enabled", true)');
    expect(pluginSrc).toContain('putBoolean("enabled", false)');
  });
});
