import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const applySchema = z.object({
  mode: z.enum(["solo", "hub"]),
  url: z.string().url().optional().or(z.literal("")),
});

/** Switch solo ↔ hub mode (a Settings action, not env editing). Persists to user_settings. */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(applySchema, req);
    const db = getDb();
    await db.run(
      `INSERT INTO user_settings (user_id, hub_mode, hub_url, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET hub_mode = excluded.hub_mode, hub_url = excluded.hub_url, updated_at = excluded.updated_at`,
      session.userId,
      body.mode === "hub" ? 1 : 0,
      body.url || null,
      new Date().toISOString()
    );
    return ok({ mode: body.mode, url: body.url || null, note: "Restart the app for the new bind address to take effect." });
  })(req, { params: Promise.resolve({}) });
}
