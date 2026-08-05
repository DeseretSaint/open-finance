import { NextRequest } from "next/server";
import { ok, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAccountsService } from "@/server/domain/accounts";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** Restore a soft-deleted account (and its transaction history). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const account = await createAccountsService(getDb()).restore(session.userId, id);
    return ok({ account });
  })(req, ctx);
}
