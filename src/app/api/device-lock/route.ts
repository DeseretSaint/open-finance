import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createDeviceLockService } from "@/server/domain/device-lock";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** Device-lock state for the mobile UI (configured/biometric/locked). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const state = await createDeviceLockService(getDb()).state(session.userId);
    return ok(state);
  })(req, { params: Promise.resolve({}) });
}
