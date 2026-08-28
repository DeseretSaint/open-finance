/**
 * Next.js instrumentation — runs once when the server starts (standalone
 * server.js included). Starts the update scheduler so scheduled updates fire
 * even while no one is looking at the UI, and the email-digest scheduler so
 * users get their daily/weekly budget summaries.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Generate stable ENCRYPTION_KEY / AUTH_SECRET on first run if absent, so a
  // self-hosted operator isn't required to hand-provision secrets (and the app
  // no longer bricks itself when they aren't set). Must run before anything
  // reads env.
  try {
    const { bootstrapServerEnv } = await import("@/server/env-bootstrap");
    bootstrapServerEnv();
  } catch (e) {
    console.error("Env bootstrap failed:", e);
  }
  try {
    const { startUpdateScheduler, clearStaleRunning } = await import("@/server/domain/updates");
    const { getDb } = await import("@/server/db/adapter");
    const db = getDb();
    // A stale `update.running` flag from a previous process would otherwise
    // stick the banner on "updating…" forever and block every future update
    // (the detached script relaunches a fresh server, so a new boot provably
    // has no update in flight). Clear it before the scheduler starts.
    await clearStaleRunning(db).catch(() => {});
    const timer = startUpdateScheduler(db);
    if (timer) timer.unref();
  } catch (e) {
    console.error("Update scheduler failed to start:", e);
  }
  try {
    const { startEmailDigestScheduler } = await import("@/server/domain/email-digest");
    const { getDb } = await import("@/server/db/adapter");
    const timer = startEmailDigestScheduler(getDb());
    if (timer) timer.unref();
  } catch (e) {
    console.error("Email digest scheduler failed to start:", e);
  }
}
