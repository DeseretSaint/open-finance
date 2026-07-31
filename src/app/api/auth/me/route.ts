import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, route } from "@/lib/api";
import {
  createAuthService,
  requireCsrf,
  requireSession,
} from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    return ok({ user: session.user });
  })(req, { params: Promise.resolve({}) });
}

const patchSchema = z.object({ display_name: z.string().min(1).max(50) });

export async function PATCH(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(patchSchema, req);
    const user = await createAuthService(getDb()).updateDisplayName(session.userId, body.display_name);
    return ok({ user });
  })(req, { params: Promise.resolve({}) });
}

export async function DELETE(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    await createAuthService(getDb()).deleteUser(session.userId);
    const res = noContent();
    res.cookies.set("of_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  })(req, { params: Promise.resolve({}) });
}
