import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { apiErrors } from "@/lib/api";
import { getDb, type Db } from "@/server/db/adapter";

/**
 * Update notifications (P10 follow-up): the hub checks for a newer release,
 * the user is asked now / scheduled (default 3am) / stop-notifying, and
 * applying runs a fixed script (never arbitrary input — the script path comes
 * from env, not the client).
 */

const STATE_PREFIX = "update.";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string | null;
  updateAvailable: boolean;
  dismissed: string | null;
  scheduledAt: string | null;
  running: boolean;
  /** How the check is sourced: github-api (public repo) or custom URL. */
  source: string;
  /** Whether a self-update script exists on disk (desktop/hub). False on the
   *  standalone mobile/APK build, where the app can't rebuild itself. */
  canSelfUpdate: boolean;
}

export function currentVersion(): string {
  try {
    // The Next build inlines npm_package_version; fall back to package.json.
    const v = process.env.npm_package_version;
    if (v) return v;
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Compare semver strings; a > b. Handles v-prefixes, partials, and
 * pre-release tails (1.2.0-beta.1 < 1.2.0). Numeric segments win over
 * pre-release tails per semver.
 */
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
  // Same core: no pre-release > pre-release; otherwise compare tail segments.
  if (pa.length === 0 && pb.length > 0) return true;
  if (pa.length > 0 && pb.length === 0) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const xn = parseInt(x, 10);
    const yn = parseInt(y, 10);
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) return xn > yn;
    return x > y; // lexicographic for non-numeric tails
  }
  return false;
}

const UPDATE_SCRIPT_ENV = "UPDATE_SCRIPT"; // read lazily in apply() so tests can override
const UPDATE_CHECK_URL = process.env.UPDATE_CHECK_URL ?? ""; // e.g. a static JSON {version, url}

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

export function createUpdatesService(db: Db = getDb()) {
  return {
    /** Fetch the latest release info; never throws on network failure. */
    async check(): Promise<{ latestVersion: string | null; latestUrl: string | null; source: string }> {
      let latestVersion: string | null = null;
      let latestUrl: string | null = null;
      let source = "none";
      try {
        if (UPDATE_CHECK_URL) {
          source = "custom-url";
          const res = await fetch(UPDATE_CHECK_URL, { signal: AbortSignal.timeout(10_000) });
          if (res.ok) {
            // SAFETY: I/O parse boundary — operator-controlled update-check URL; only two
            // optional fields are read and each is null-coalesced, so a malformed payload
            // degrades to "no update" rather than throwing.
            const data = (await res.json()) as { version?: string; url?: string };
            latestVersion = data.version ?? null;
            latestUrl = data.url ?? null;
          }
        } else {
          // GitHub latest-release API (works once the repo is public).
          source = "github-api";
          const res = await fetch("https://api.github.com/repos/DeseretSaint/open-finance/releases/latest", {
            headers: { accept: "application/vnd.github+json", "user-agent": "open-finance-updater" },
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            // SAFETY: I/O parse boundary — GitHub releases API response; only optional
            // string fields are read, each null-coalesced / regex-stripped below, so a
            // malformed payload degrades to "no update" rather than throwing.
            const data = (await res.json()) as { tag_name?: string; html_url?: string };
            latestVersion = (data.tag_name ?? "").replace(/^v/i, "");
            latestUrl = data.html_url ?? null;
          } else if (res.status === 404) {
            source = "private-or-no-releases";
          }
        }
      } catch {
        /* offline or unreachable — keep last known */
      }
      if (latestVersion) {
        await setState(db, "latest_version", latestVersion);
        await setState(db, "latest_url", latestUrl);
      }
      return { latestVersion, latestUrl, source };
    },

    async status(): Promise<UpdateStatus> {
      const [latestVersion, latestUrl, dismissed, scheduledAt, running] = await Promise.all([
        getState(db, "latest_version"),
        getState(db, "latest_url"),
        getState(db, "dismissed"),
        getState(db, "scheduled_at"),
        getState(db, "running"),
      ]);
      const scriptPath = process.env[UPDATE_SCRIPT_ENV] ?? "scripts/update.sh";
      const fs = await import("node:fs");
      const canSelfUpdate = fs.existsSync(path.resolve(process.cwd(), scriptPath));
      return {
        currentVersion: currentVersion(),
        latestVersion,
        latestUrl,
        updateAvailable: !!latestVersion && isNewerVersion(latestVersion, currentVersion()) && dismissed !== latestVersion,
        dismissed,
        scheduledAt,
        running: running === "1",
        source: UPDATE_CHECK_URL ? "custom-url" : "github-api",
        canSelfUpdate,
      };
    },

    /** "Stop notifying me about this update" — dismiss the current latest. */
    async dismiss(): Promise<void> {
      const latest = await getState(db, "latest_version");
      if (!latest) throw apiErrors.badRequest("No update to dismiss.");
      await setState(db, "dismissed", latest);
      await setState(db, "scheduled_at", null);
    },

    /** Re-enable notifications for the dismissed version (Settings → Updates). */
    async remind(): Promise<void> {
      await setState(db, "dismissed", null);
    },

    /** Schedule the update for a specific time (default: upcoming 3am). */
    async schedule(when: Date): Promise<void> {
      const latest = await getState(db, "latest_version");
      if (!latest) throw apiErrors.badRequest("No update to schedule.");
      if (Number.isNaN(when.getTime())) throw apiErrors.badRequest("Invalid schedule time.");
      await setState(db, "scheduled_at", when.toISOString());
      await setState(db, "dismissed", null);
    },

    /** Cancel a scheduled update. */
    async cancelSchedule(): Promise<void> {
      await setState(db, "scheduled_at", null);
    },

    /** Apply the update by running the fixed script, detached. */
    async apply(): Promise<{ started: boolean; script: string }> {
      const running = await getState(db, "running");
      if (running === "1") throw apiErrors.conflict("An update is already running.");
      const scriptPath = process.env[UPDATE_SCRIPT_ENV] ?? "scripts/update.sh";
      const script = path.resolve(process.cwd(), scriptPath);
      // The script must exist; env-controlled, never client input.
      const fs = await import("node:fs");
      if (!fs.existsSync(script)) {
        throw apiErrors.badRequest(`Update script not found (${scriptPath}). Set UPDATE_SCRIPT or update manually.`);
      }
      await setState(db, "running", "1");
      await setState(db, "scheduled_at", null);
      await setState(db, "dismissed", null);

      // Detached so the server restart doesn't kill the update mid-flight.
      // SAFETY: `detached`/`stdio` are SpawnOptions fields that execFile forwards to
      // spawn at runtime but its ExecFileOptions type omits; the cast restores the
      // exact runtime behavior with no other options changed.
      const child = execFile(script, [], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, OPEN_FINANCE_UPDATE: "1" },
      } as never);
      child.unref();
      return { started: true, script: scriptPath };
    },

    /** Called by the update script on completion (or by the scheduler). */
    async markDone(): Promise<void> {
      await setState(db, "running", null);
      await setState(db, "scheduled_at", null);
    },
  };
}

/**
 * Clear a stale `update.running` flag at server boot. `apply()` sets
 * `running = "1"` and relies on the detached update script to clear it via
 * `markDone()` — but the script never calls back (it kills this server and
 * launches a *new* one on success, or rolls back and relaunches on failure),
 * so the flag is never reset in-process. Left alone, it would make the banner
 * report "updating…" forever and block every future `apply()` (including
 * scheduled ones) with a conflict error. A freshly-started process provably
 * has no update subprocess mid-flight, so clearing on boot is always safe.
 * Intentionally does NOT touch `scheduled_at` — a pending schedule must
 * survive a restart.
 */
export async function clearStaleRunning(db: Db = getDb()): Promise<void> {
  await setState(db, "running", null);
}

/**
 * Scheduler: runs once a minute; fires a scheduled update when due. The server
 * process may restart during the update — the script is detached, and
 * `running` state survives in the DB so the banner shows progress.
 */
export function startUpdateScheduler(db: Db = getDb()): NodeJS.Timeout | null {
  if (process.env.DISABLE_UPDATE_SCHEDULER === "1") return null;
  return setInterval(async () => {
    try {
      const svc = createUpdatesService(db);
      const scheduledAt = await (async () => {
        const row = await db.get<{ value: string }>("SELECT value FROM app_state WHERE key = 'update.scheduled_at'");
        return row?.value ?? null;
      })();
      const running = await (async () => {
        const row = await db.get<{ value: string }>("SELECT value FROM app_state WHERE key = 'update.running'");
        return row?.value === "1";
      })();
      if (!scheduledAt || running) return;
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        await svc.apply().catch(() => {});
      }
    } catch {
      /* scheduler must never crash the process */
    }
  }, 60_000);
}

/** Default schedule time: the upcoming 3am (local server time). */
export function upcomingThreeAm(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(3, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}
