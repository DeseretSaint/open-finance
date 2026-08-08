import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createCsvImportService } from "@/server/domain/csv-import";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const importSchema = z.object({
  accountId: z.string().min(1, "Choose an account to import into."),
  contents: z.string().min(1, "Paste or upload a bank CSV file."),
});

/** POST /api/import/csv — import bank CSV transactions into an account (deduped). */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(importSchema, req);
    const result = await createCsvImportService(getDb()).importCsv(
      session.userId,
      body.accountId,
      body.contents
    );
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}

// GET unused — keep Next happy with the route contract.
export async function GET() {
  return new Response("Use POST to import a CSV.", { status: 405 });
}
