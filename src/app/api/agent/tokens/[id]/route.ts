import { NextRequest } from "next/server";
import { noContent, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAgentTokenService } from "@/server/authz/tokens";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** User session: revoke or delete an agent token. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createAgentTokenService(getDb()).remove(session.userId, id);
    return noContent();
  })(req, ctx);
}
