import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { apiErrors } from "@/lib/api-error";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { autoCategorize } from "@/server/domain/categorizer";
import { createAgentPrefsService } from "@/server/domain/agent-prefs";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/**
 * "Apply" for smart categorization: requires a connected agent + the feature
 * enabled, then runs the app-side categorizer over the backlog (same rules
 * the agent would use) so categorization actually starts immediately.
 */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const db = getDb();

    const connected = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked = 0",
      session.userId
    );
    if (!connected || connected.n === 0) {
      throw apiErrors.badRequest("No agent connected — wire one in the Agents tab first.");
    }

    const prefs = await createAgentPrefsService(db).get(session.userId);
    if (!prefs.autoCategorize) {
      throw apiErrors.badRequest("Smart categorization is off — enable it above, then apply.");
    }

    const result = await autoCategorize(db, session.userId, prefs.categorizeBacklogMonths);
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}
