import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { detectHub, preferredHubUrl } from "@/server/detect/detect";

export const runtime = "nodejs";

/** Connection Assistant eyes: LAN IPs + Tailscale (best-effort, no root, no secrets). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    await requireSession(req);
    const result = await detectHub();
    return ok({ ...result, preferredUrl: preferredHubUrl(result) });
  })(req, { params: Promise.resolve({}) });
}
