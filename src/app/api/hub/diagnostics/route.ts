import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { detectHub } from "@/server/detect/detect";
import { env } from "@/lib/env";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** Hub diagnostics card: current mode/URL, bind, tailscale up/down, LAN IPs. */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const db = getDb();
    const settings = await db.get<{ hub_mode: number; hub_url: string | null }>(
      "SELECT hub_mode, hub_url FROM user_settings WHERE user_id = ?",
      session.userId
    );
    const detected = await detectHub();
    return ok({
      mode: settings?.hub_mode ? "hub" : "solo",
      savedUrl: settings?.hub_url ?? null,
      bindAddress: env.BIND_ADDRESS,
      publicUrl: env.PUBLIC_URL,
      lanIps: detected.lanIps,
      tailscale: detected.tailscale,
      tailscaleUp: detected.tailscale !== null,
    });
  })(req, { params: Promise.resolve({}) });
}
