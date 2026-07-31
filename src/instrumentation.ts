/**
 * Next.js instrumentation — runs once when the server starts (standalone
 * server.js included). Starts the update scheduler so scheduled updates fire
 * even while no one is looking at the UI.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startUpdateScheduler } = await import("@/server/domain/updates");
    const { getDb } = await import("@/server/db/adapter");
    const timer = startUpdateScheduler(getDb());
    if (timer) timer.unref();
  } catch (e) {
    console.error("Update scheduler failed to start:", e);
  }
}
