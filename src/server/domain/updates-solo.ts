import { apiErrors } from "@/lib/api-error";
import type { Db } from "@/server/db/types";

/**
 * Solo (on-device) update checks — browser-safe twin of the server's
 * updates service. The APK cannot rebuild itself, so:
 *   - check():      fetch the GitHub latest release (works in the webview;
 *                   api.github.com is CORS-open), store into app_state
 *   - status():     same shape as the server (UpdateStatus) with
 *                   canSelfUpdate: false — the banner/panel already render
 *                   the "Download new version" path for that case
 *   - decide:       only dismiss / remind / cancel are supported on-device;
 *                   now / scheduled are rejected (no update script)
 *
 * Version comparison reuses the pure semver helper from the server module
 * (no node imports in that file path — safe for the browser bundle).
 */

const STATE_PREFIX = "update.";
const GITHUB_LATEST = "https://api.github.com/repos/DeseretSaint/open-finance/releases/latest";

async function getState(db: Db, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM app_state WHERE key = ?", STATE_PREFIX + key);
  return row?.value ?? null;
}

async function setState(db: Db, key: string, value: string | null): Promise<void> {
  const now = new Date().toISOString();
  if (value === null) {
    await db.run("DELETE FROM app_state WHERE key = ?", STATE_PREFIX + key);
  } else {
    await db.run(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      STATE_PREFIX + key,
      value,
      now
    );
  }
}

export interface SoloUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string | null;
  apkUrl: string | null;
  apkSha256: string | null;
  updateAvailable: boolean;
  dismissed: string | null;
  scheduledAt: string | null;
  running: boolean;
  source: string;
  canSelfUpdate: false;
}

export function createSoloUpdatesService(db: Db) {
  return {
    /** Force a re-check against GitHub's latest release (never throws). */
    async check(): Promise<{ found: boolean; status: SoloUpdateStatus }> {
      let latestVersion: string | null = null;
      let latestUrl: string | null = null;
      let apkUrl: string | null = null;
      let apkSha256: string | null = null;
      try {
        const res = await fetch(GITHUB_LATEST, {
          headers: { accept: "application/vnd.github+json", "user-agent": "open-finance-updater" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          // SAFETY: I/O parse boundary — GitHub releases API response; every field read
          // below is optional-chained or null-coalesced (tag_name ?? "", assets ?? [],
          // releaseApk?.browser_download_url), so a malformed payload degrades to
          // "no update found" rather than throwing.
          const data = (await res.json()) as {
            tag_name?: string;
            html_url?: string;
            assets?: Array<{ name?: string; browser_download_url?: string }>;
          };
          latestVersion = (data.tag_name ?? "").replace(/^v/i, "");
          latestUrl = data.html_url ?? null;
          const assets = data.assets ?? [];
          const releaseApk = assets.find((a) => a.name === "app-release.apk");
          apkUrl = releaseApk?.browser_download_url ?? null;
          if (apkUrl) {
            // Best-effort: fetch the release's SHA256SUMS asset.
            try {
              const sumsAsset = assets.find((a) => a.name === "SHA256SUMS");
              const sumsUrl = sumsAsset?.browser_download_url;
              if (sumsUrl) {
                const sumsRes = await fetch(sumsUrl, {
                  headers: { accept: "application/vnd.github+json", "user-agent": "open-finance-updater" },
                  signal: AbortSignal.timeout(8_000),
                });
                if (sumsRes.ok) {
                  const text = await sumsRes.text();
                  // The release APK checksum line looks like:
                  //   <64-hex>  ./release/app-release.apk
                  const match = text.match(/([0-9a-f]{64})\s+\S*app-release\.apk/);
                  apkSha256 = match?.[1]?.toLowerCase() ?? null;
                }
              }
            } catch {
              /* checksum optional */
            }
          }
        }
      } catch {
        /* offline or unreachable — keep last known */
      }
      if (latestVersion) {
        await setState(db, "latest_version", latestVersion);
        await setState(db, "latest_url", latestUrl);
        await setState(db, "apk_url", apkUrl);
        await setState(db, "apk_sha256", apkSha256);
      }
      return { found: !!latestVersion, status: await this.status() };
    },

    async status(): Promise<SoloUpdateStatus> {
      const [latestVersion, latestUrl, apkUrl, apkSha256, dismissed, scheduledAt, running] = await Promise.all([
        getState(db, "latest_version"),
        getState(db, "latest_url"),
        getState(db, "apk_url"),
        getState(db, "apk_sha256"),
        getState(db, "dismissed"),
        getState(db, "scheduled_at"),
        getState(db, "running"),
      ]);
      const current = soloCurrentVersion();
      return {
        currentVersion: current,
        latestVersion,
        latestUrl,
        apkUrl,
        apkSha256,
        updateAvailable: !!latestVersion && isNewerVersion(latestVersion, current) && dismissed !== latestVersion,
        dismissed,
        scheduledAt,
        running: running === "1",
        source: "github-api",
        canSelfUpdate: false,
      };
    },

    async dismiss(): Promise<void> {
      const latest = await getState(db, "latest_version");
      if (!latest) throw apiErrors.badRequest("No update to dismiss.");
      await setState(db, "dismissed", latest);
      await setState(db, "scheduled_at", null);
    },

    async remind(): Promise<void> {
      await setState(db, "dismissed", null);
    },

    async cancelSchedule(): Promise<void> {
      await setState(db, "scheduled_at", null);
    },

    /** Not available on the standalone build — the UI uses the release URL instead. */
    async rejectInPlace(): Promise<never> {
      throw apiErrors.badRequest(
        "This standalone build can't update itself — download the new version from the release page instead."
      );
    },
  };
}

/**
 * The version inlined into the bundle at build time
 * (see next.config.ts env.NEXT_PUBLIC_APP_VERSION). The static export has no
 * process.env at runtime, so Next replaces this constant during the build.
 */
export function soloCurrentVersion(): string {
  try {
    return process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Semver compare (same logic as the server; kept here so the browser bundle
 *  never imports node:fs / node:child_process). */
export function isNewerVersion(a: string, b: string): boolean {
  const core = (v: string): number[] =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pre = (v: string): string[] => {
    const parts = v.replace(/^v/i, "").split("-");
    return parts.length > 1 ? parts[1].split(".") : [];
  };

  const ca = core(a);
  const cb = core(b);
  const len = Math.max(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const x = ca[i] ?? 0;
    const y = cb[i] ?? 0;
    if (x !== y) return x > y;
  }
  const pa = pre(a);
  const pb = pre(b);
  if (pa.length === 0 && pb.length > 0) return true;
  if (pa.length > 0 && pb.length === 0) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const xn = parseInt(x, 10);
    const yn = parseInt(y, 10);
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) return xn > yn;
    return x > y;
  }
  return false;
}
