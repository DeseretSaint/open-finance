"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { hasWindow } from "@/lib/browser-env";
import { Button } from "@/components/ui/button";

interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string | null;
  apkUrl?: string | null;
  apkSha256?: string | null;
  updateAvailable: boolean;
  dismissed: string | null;
  scheduledAt: string | null;
  running: boolean;
  source: string;
  canSelfUpdate: boolean;
}

function isNativeApp(): boolean {
  // Native bridge globals are declared in src/lib/native-globals.d.ts.
  return hasWindow() && !!window.Capacitor?.isNativePlatform?.();
}

function updaterPlugin() {
  // Native bridge globals are declared in src/lib/native-globals.d.ts.
  return window.Updater ?? null;
}

/**
 * Update notification banner (app shell): when a newer release exists, ask
 * now / schedule (default upcoming 3am) / stop notifying. Scheduled or
 * running states collapse to a slim status row. Settings → Updates has the
 * full panel (including update-when-ready).
 *
 * On builds that can't self-update (standalone APK / no update script), the
 * in-place "Update now"/"Schedule" are replaced with a "Download new version"
 * action that opens the release — fetch + install the APK by hand.
 */
export function UpdateBanner() {
  const qc = useQueryClient();
  const native = isNativeApp();
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["updates"],
    queryFn: () => api.get<UpdateStatus>("/api/updates"),
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: (body: { action: "now" | "scheduled" | "dismiss" | "cancel"; scheduledAt?: string }) =>
      api.post("/api/updates/decide", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["updates"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["updates"] }),
  });

  /** Native in-app update: grant install permission once, then download+install. */
  async function downloadAndInstall() {
    const s = status.data;
    const plugin = updaterPlugin();
    if (!plugin?.downloadAndInstall || !s?.apkUrl) {
      // Fall back to the release page if no native installer / APK URL.
      if (s?.latestUrl) window.open(s.latestUrl, "_blank");
      return;
    }
    setInstalling(true);
    setInstallMsg(null);
    try {
      if (plugin.canInstallUnknownApps) {
        const perm = await plugin.canInstallUnknownApps();
        if (!perm.canInstall && plugin.openInstallSettings) {
          setInstallMsg("Allow Open Finance to install apps, then tap Update again.");
          await plugin.openInstallSettings();
          setInstalling(false);
          return;
        }
      }
      await plugin.downloadAndInstall({
        url: s.apkUrl,
        sha256: s.apkSha256 ?? null,
        fileName: `openfinance-${s.latestVersion}.apk`,
      });
      setInstallMsg("Downloaded — the installer should open now. Finish it to apply the update.");
    } catch (e) {
      setInstallMsg(e instanceof Error ? e.message : "Update failed — try again or download from the release page.");
    } finally {
      setInstalling(false);
    }
  }

  const s = status.data;
  if (!s || (!s.updateAvailable && !s.scheduledAt && !s.running)) return null;

  // scheduling flow: pick a time (default 3am), then confirm
  if (scheduledFor !== null) {
    return (
      <div className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span>
            Schedule update <span className="font-medium">v{s.latestVersion}</span> for:
          </span>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              defaultValue={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            />
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate({ action: "scheduled", scheduledAt: new Date(scheduledFor).toISOString() });
                setScheduledFor(null);
              }}
            >
              Schedule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setScheduledFor(null)}>
              Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // running / scheduled → slim status
  if (s.running) {
    return (
      <div className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Updating to v{s.latestVersion ?? ""}… the app will restart shortly.
      </div>
    );
  }
  if (s.scheduledAt) {
    return (
      <div className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span>
            Update to <span className="font-medium">v{s.latestVersion}</span> scheduled for{" "}
            <span className="font-medium">{new Date(s.scheduledAt).toLocaleString()}</span>.
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ action: "now" })}>
              Update now
            </Button>
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ action: "cancel" })}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // update available → ask (self-update) or point to the new version (standalone)
  const selfUpdate = s.canSelfUpdate && !native;
  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span>
          Open Finance <span className="font-medium">v{s.latestVersion}</span> is available (you&apos;re on v
          {s.currentVersion}).
        </span>
        <div className="flex items-center gap-2">
          {selfUpdate ? (
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ action: "now" })}>
              Update now
            </Button>
          ) : native ? (
            <Button size="sm" onClick={downloadAndInstall} disabled={installing}>
              {installing ? "Downloading…" : "Download & install"}
            </Button>
          ) : s.latestUrl ? (
            <a
              href={s.latestUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground transition-colors hover:brightness-110"
            >
              Download new version
            </a>
          ) : null}
          {installMsg && <span className="text-xs text-text-muted">{installMsg}</span>}
          {selfUpdate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setScheduledFor(upcomingThreeAmLocal())}
            >
              Schedule (3am)
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ action: "dismiss" })}>
            Stop notifying
          </Button>
        </div>
      </div>
    </div>
  );
}

function upcomingThreeAmLocal(): string {
  const d = new Date();
  d.setHours(3, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  // datetime-local needs local, not UTC
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(3)}:${pad(0)}`;
}
