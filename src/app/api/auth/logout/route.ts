import { NextRequest } from "next/server";
import { noContent, route } from "@/lib/api";
import { createAuthService, requireSession } from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    await createAuthService(getDb()).revokeSession(session.id, session.userId);
    const res = noContent();
    res.cookies.set("of_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  })(req, { params: Promise.resolve({}) });
}
