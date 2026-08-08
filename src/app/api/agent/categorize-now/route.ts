import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { apiErrors } from "@/lib/api-error";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { autoCategorize } from "@/server/domain/categorizer";
import { createAgentPrefsService } from "@/server/domain/agent-prefs";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/**
 * "Apply" for smart categorization: runs the app-side categorizer over the
 * backlog (same rules the agent would use) so categorization starts immediately.
 *
 * NOTE: smart categorization is purely local — it uses the user's own category
 * rules and does NOT require a connected agent. The original guard required an
 * agent_tokens row, but solo phones store the agent token in app_state
 * (remote.agent.token), so the guard returned 400 and the button silently did
 * nothing. We only require the autoCategorize pref to be enabled.
 */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const db = getDb();

    const prefs = await createAgentPrefsService(db).get(session.userId);
    if (!prefs.autoCategorize) {
      throw apiErrors.badRequest("Smart categorization is off — enable it above, then apply.");
    }

    const result = await autoCategorize(db, session.userId, prefs.categorizeBacklogMonths);
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}
