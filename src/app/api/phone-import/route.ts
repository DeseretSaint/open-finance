import { NextRequest } from "next/server";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";
import { createPhoneImportService } from "@/server/domain/phone-import";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  pin: z.string().regex(/^\d{4,12}$/),
  contents: z.string().min(100).max(50_000_000),
});

/** Additive import from a standalone phone backup. Never deletes hub data. */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(schema, req).catch(() => {
      throw apiErrors.badRequest("Choose a phone backup and enter its device PIN.");
    });
    return ok(await createPhoneImportService(getDb()).importBackup(session.userId, body.pin, body.contents));
  })(req, { params: Promise.resolve({}) });
}
