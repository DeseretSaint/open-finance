import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createPermissionService } from "@/server/authz/permission-requests";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** User session: permission-request inbox (pending by default). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const status = (req.nextUrl.searchParams.get("status") as "pending" | "granted" | "denied" | undefined) ?? "pending";
    const requests = await createPermissionService(getDb()).listForUser(session.userId, status);
    return ok({ requests });
  })(req, { params: Promise.resolve({}) });
}
