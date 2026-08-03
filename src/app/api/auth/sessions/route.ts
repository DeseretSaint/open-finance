import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { createAuthService, requireSession } from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const auth = createAuthService(getDb());
    const sessions = await auth.listSessions(session.userId);
    return ok({
      sessions: sessions.map((s) => ({
        id: s.id,
        device_label: s.device_label,
        created_at: s.created_at,
        expires_at: s.expires_at,
        last_seen_at: s.last_seen_at,
        current: s.id === session.id,
      })),
    });
  })(req, { params: Promise.resolve({}) });
}
