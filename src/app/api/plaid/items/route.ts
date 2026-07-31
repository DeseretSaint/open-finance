import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createPlaidService } from "@/server/plaid/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const items = await createPlaidService(getDb()).listItems(session.userId);
    return ok({ items });
  })(req, { params: Promise.resolve({}) });
}
