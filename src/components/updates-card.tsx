"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { hasWindow } from "@/lib/browser-env";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

/** Settings → Updates: check, update now, schedule, stop-notifying, and the
 *  update-when-ready path (dismissed updates can be un-dismissed here). On
 *  builds that can't self-update (standalone APK) it offers a download link
 *  instead of the git-based in-place update. */
export function UpdatesCard() {
  const qc = useQueryClient();
  const native = isNativeApp();
  const [scheduledAt, setScheduledAt] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  function updaterPlugin() {
    // Native bridge globals are declared in src/lib/native-globals.d.ts.
    return window.Updater ?? null;
  }

  /** Native in-app update: grant install permission once, then download+install. */
  async function downloadAndInstall() {
    const st = status.data;
    const plugin = updaterPlugin();
    if (!plugin?.downloadAndInstall || !st?.apkUrl) {
      if (st?.latestUrl) window.open(st.latestUrl, "_blank");
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
        url: st.apkUrl,
        sha256: st.apkSha256 ?? null,
        fileName: `openfinance-${st.latestVersion}.apk`,
      });
      setInstallMsg("Downloaded — the installer should open now. Finish it to apply the update.");
    } catch (e) {
      setInstallMsg(e instanceof Error ? e.message : "Update failed — try again or download from the release page.");
    } finally {
      setInstalling(false);
    }
  }

  const status = useQuery({
    queryKey: ["updates"],
    queryFn: () => api.get<UpdateStatus>("/api/updates"),
    refetchInterval: 60_000,
  });
  const s = status.data;

  const act = useMutation({
    mutationFn: async (body: {
      action: "check" | "now" | "scheduled" | "dismiss" | "cancel" | "remind";
      scheduledAt?: string;
    }): Promise<{ status?: UpdateStatus; ok?: boolean }> =>
      body.action === "check"
        ? api.post<{ status: UpdateStatus }>("/api/updates")
        : api.post<{ ok?: boolean }>("/api/updates/decide", body),
    onSuccess: (data) => {
      // SAFETY: the /api/updates/decide response is { status?: UpdateStatus } per the route contract.
      const st = (data as { status?: UpdateStatus }).status;
      if (st) {
        setMsg(st.updateAvailable ? `Update available: v${st.latestVersion}` : "You're up to date.");
      } else {
        setMsg("Done.");
      }
      setErr(null);
      qc.invalidateQueries({ queryKey: ["updates"] });
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : "Failed.");
      qc.invalidateQueries({ queryKey: ["updates"] });
    },
  });

  const upcomingThreeAm = () => {
    const d = new Date();
    d.setHours(3, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(3)}:${pad(0)}`;
  };

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Updates</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        {native || s?.canSelfUpdate === false
          ? "This standalone build can't rebuild itself, so it points you to the newest release instead. Download the APK and install it over this app — no uninstall needed (the same signing key signs every build)."
          : "The hub checks GitHub releases (or UPDATE_CHECK_URL) for newer versions. Updating runs scripts/update.sh — git pull, rebuild, restart. Docker installs: set UPDATE_SCRIPT to a script that pulls the image."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge>v{s?.currentVersion ?? "…"}</Badge>
        {s?.latestVersion && (
          <span className="text-text-muted">
            {s.updateAvailable || s.dismissed === s.latestVersion ? (
              <>
                latest: <span className="font-medium">v{s.latestVersion}</span>
                {s.updateAvailable ? (
                  <span className="ml-1 text-emerald-600">· update available</span>
                ) : (
                  <span className="ml-1 text-text-muted">· you stopped notifications for this version</span>
                )}
              </>
            ) : (
              <>· up to date</>
            )}
          </span>
        )}
        {s?.running && <Badge className="bg-amber-500">updating…</Badge>}
        {s?.scheduledAt && (
          <span className="text-text-muted">
            · scheduled for <span className="font-medium">{new Date(s.scheduledAt).toLocaleString()}</span>
          </span>
        )}
      </div>

      {status.isError && !status.data && (
        <div role="alert" className="mt-3 rounded-xl bg-[var(--danger-soft)] px-4 py-2 text-sm font-medium text-danger">
          Couldn&apos;t load update status.
          <Button size="sm" variant="secondary" className="ml-2" disabled={status.isFetching} onClick={() => status.refetch()}>
            {status.isFetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => act.mutate({ action: "check" })} disabled={act.isPending}>
          Check for updates
        </Button>
        {s?.updateAvailable &&
          (s.canSelfUpdate && !native ? (
            <>
              <Button onClick={() => act.mutate({ action: "now" })} disabled={act.isPending}>
                Update now
              </Button>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={scheduledAt || upcomingThreeAm()}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => act.mutate({ action: "scheduled", scheduledAt: new Date(scheduledAt || upcomingThreeAm()).toISOString() })}
                  disabled={act.isPending}
                >
                  Schedule
                </Button>
              </div>
            </>
          ) : native ? (
            <Button
              onClick={downloadAndInstall}
              disabled={installing || !s.apkUrl}
              title={s.apkUrl ? "" : "Checking for the downloadable APK…"}
            >
              {installing ? "Updating…" : `Update now (v${s.latestVersion})`}
            </Button>
          ) : s.latestUrl ? (
            <a
              href={s.latestUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:brightness-110"
            >
              Download v{s.latestVersion}
            </a>
          ) : null)}
        {s?.dismissed === s?.latestVersion && s?.latestVersion && (
          <Button variant="ghost" onClick={() => act.mutate({ action: "remind" })} disabled={act.isPending}>
            Remind me about v{s.latestVersion}
          </Button>
        )}
        {s?.scheduledAt && (
          <Button variant="ghost" onClick={() => act.mutate({ action: "cancel" })} disabled={act.isPending}>
            Cancel schedule
          </Button>
        )}
        {s?.latestUrl && !native && (
          <a
            href={s.latestUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-text-muted underline underline-offset-2 hover:text-text"
          >
            Release notes
          </a>
        )}
        {s?.latestUrl && native && (
          <a
            href={s.latestUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-text-muted underline underline-offset-2 hover:text-text"
          >
            Release notes
          </a>
        )}
      </div>

      {msg && <p role="status" className="mt-3 text-sm text-emerald-600">{msg}</p>}
      {err && <p role="alert" className="mt-3 text-sm text-red-600">{err}</p>}
      {installMsg && <p className="mt-3 text-sm text-text-muted">{installMsg}</p>}
    </Card>
  );
}
