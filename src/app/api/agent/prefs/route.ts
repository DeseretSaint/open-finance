import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAgentPrefsService, AGENT_TABS } from "@/server/domain/agent-prefs";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  tabs: z.array(z.enum(AGENT_TABS)).optional(),
  autoCategorize: z.boolean().optional(),
  global: z.boolean().optional(),
  globalWrite: z.boolean().optional(),
});

/** GET /api/agent/prefs — smart-categorization preference. */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const prefs = await createAgentPrefsService(getDb()).get(session.userId);
    return ok({ prefs });
  })(req, { params: Promise.resolve({}) });
}

/** PUT /api/agent/prefs — update the preference. */
export async function PUT(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(updateSchema, req);
    const prefs = await createAgentPrefsService(getDb()).update(session.userId, body);
    return ok({ prefs });
  })(req, { params: Promise.resolve({}) });
}
