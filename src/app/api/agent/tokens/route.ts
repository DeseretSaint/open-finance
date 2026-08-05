import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAgentTokenService } from "@/server/authz/tokens";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  preset: z.enum(["read-only", "read-all", "read-write", "custom"]).optional(),
  scopes: z.array(z.string()).optional(),
  accountIds: z.array(z.string()).nullable().optional(),
  uiTabs: z.array(z.string()).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  followSettings: z.boolean().optional(),
});

/** User session: list agent tokens (never the raw token — prefix + scopes only). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const agents = await createAgentTokenService(getDb()).list(session.userId);
    return ok({ agents });
  })(req, { params: Promise.resolve({}) });
}

/** User session: create an agent token. The raw token is shown exactly once. */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const { token, agent } = await createAgentTokenService(getDb()).create(session.userId, body);
    return ok({ token, agent }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
