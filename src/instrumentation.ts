/**
 * Next.js instrumentation — runs once when the server starts (standalone
 * server.js included). Starts the update scheduler so scheduled updates fire
 * even while no one is looking at the UI, and the email-digest scheduler so
 * users get their daily/weekly budget summaries.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startUpdateScheduler } = await import("@/server/domain/updates");
    const { getDb } = await import("@/server/db/adapter");
    const db = getDb();
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
