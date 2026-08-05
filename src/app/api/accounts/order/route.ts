import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAccountsService } from "@/server/domain/accounts";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

/** Reorder accounts — user session only. Static segment so it wins over /api/accounts/[id]. */
export async function PUT(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(reorderSchema, req);
    await createAccountsService(getDb()).reorder(session.userId, body.orderedIds);
    return ok({ ok: true });
  })(req, { params: Promise.resolve({}) });
}
