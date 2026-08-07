import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createTransactionsService } from "@/server/domain/transactions";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  userCategoryId: z.string().nullable(),
});

/** Batch-confirm categories for the "review" queue (one-tap review). Session only + CSRF. */
export async function PATCH(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(batchSchema, req);
    const updated = await createTransactionsService(getDb()).batchCategorize(session.userId, body.ids, body.userCategoryId);
    return noContent();
  })(req, { params: Promise.resolve({}) });
}
